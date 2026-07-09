const { randomUUID } = require('crypto');

const CodexWorkspaceLock = require('../models/codex_workspace_lock');
const CodexTurn = require('../models/codex_turn');
const CodexEvent = require('../models/codex_event');
const CodexSession = require('../models/codex_session');
const codexToolService = require('./codexToolService');
const CodexLocalRunner = require('./codexLocalRunner');
const logger = require('../utils/logger');

function addMilliseconds(date, ms) {
  return new Date(date.getTime() + ms);
}

function clipText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 18)}\n[output truncated]`;
}

function sanitizePayload(payload, maxLength) {
  if (!payload || typeof payload !== 'object') {
    return payload || {};
  }
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= maxLength) {
      return payload;
    }
    return {
      truncated: true,
      jsonPreview: serialized.slice(0, maxLength),
    };
  } catch (_error) {
    return {
      truncated: true,
      text: String(payload).slice(0, maxLength),
    };
  }
}

class CodexQueueWorker {
  constructor() {
    this.workerId = `codex-worker-${process.pid}-${randomUUID()}`;
    this.runner = new CodexLocalRunner();
    this.started = false;
    this.tickInFlight = false;
    this.activeTurns = new Map();
    this.interval = null;
    this.lastTickAt = null;
    this.lastError = '';
  }

  getConfig() {
    return codexToolService.getRuntimeConfig();
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    const config = this.getConfig();
    if (!config.workerEnabled) {
      logger.notice('Codex queue worker disabled by configuration', {
        category: 'codex_tool',
        metadata: { workerId: this.workerId },
      });
      return;
    }

    this.recoverInterruptedTurns().catch((error) => {
      this.lastError = error.message;
      logger.warning('Codex worker startup recovery failed', {
        category: 'codex_tool',
        metadata: { workerId: this.workerId, error: error.message },
      });
    });

    this.interval = setInterval(() => {
      this.tick().catch((error) => {
        this.lastError = error.message;
        logger.error('Codex worker tick failed', {
          category: 'codex_tool',
          metadata: { workerId: this.workerId, error },
        });
      });
    }, config.pollIntervalMs);
    if (this.interval.unref) {
      this.interval.unref();
    }

    this.tick().catch((error) => {
      this.lastError = error.message;
      logger.error('Initial Codex worker tick failed', {
        category: 'codex_tool',
        metadata: { workerId: this.workerId, error },
      });
    });
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
  }

  getStatus() {
    const config = this.getConfig();
    return {
      workerId: this.workerId,
      started: this.started,
      enabled: config.workerEnabled,
      activeCount: this.activeTurns.size,
      activeTurnIds: Array.from(this.activeTurns.keys()),
      globalConcurrency: config.globalConcurrency,
      pollIntervalMs: config.pollIntervalMs,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
    };
  }

  async recoverInterruptedTurns() {
    await codexToolService.ensureDefaultData();
    const now = new Date();
    await CodexWorkspaceLock.deleteMany({ expiresAt: { $lte: now } }).exec();
    const runningTurns = await CodexTurn.find({ status: 'running' }).lean().exec();
    for (const turn of runningTurns) {
      const lock = await CodexWorkspaceLock.findOne({ turnId: turn._id }).lean().exec();
      if (lock && lock.expiresAt && new Date(lock.expiresAt) > now) {
        continue;
      }
      const completedAt = new Date();
      const durationMs = turn.startedAt ? completedAt.getTime() - new Date(turn.startedAt).getTime() : null;
      const updatedTurn = await CodexTurn.findByIdAndUpdate(turn._id, {
        $set: {
          status: 'failed',
          completedAt,
          durationMs,
          errorMessage: 'Codex worker stopped before this turn completed.',
        },
      }, { new: true }).exec();
      await CodexWorkspaceLock.deleteMany({ turnId: turn._id }).exec();
      await this.recordEvent(updatedTurn, 1, {
        stream: 'system',
        eventType: 'worker.recovered_orphaned_turn',
        text: 'Turn was marked failed during worker startup recovery.',
        severity: 'warning',
      });
      await codexToolService.updateSessionAfterTurn(updatedTurn);
    }
  }

  async tick() {
    const config = this.getConfig();
    if (!this.started || !config.workerEnabled || this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    this.lastTickAt = new Date();
    try {
      await CodexWorkspaceLock.deleteMany({ expiresAt: { $lte: new Date() } }).exec();
      while (this.activeTurns.size < config.globalConcurrency) {
        const started = await this.claimAndRunOne();
        if (!started) {
          break;
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  async claimAndRunOne() {
    const queuedTurns = await CodexTurn.find({ status: 'queued' })
      .sort({ queuedAt: 1 })
      .limit(25)
      .lean()
      .exec();

    for (const queuedTurn of queuedTurns) {
      if (this.activeTurns.has(String(queuedTurn._id))) {
        continue;
      }
      if (Array.from(this.activeTurns.values()).some((active) => active.workspaceId === String(queuedTurn.workspaceId))) {
        continue;
      }

      let bundle;
      try {
        bundle = await codexToolService.getWorkspaceBundle(queuedTurn.workspaceId);
      } catch (error) {
        await this.blockTurn(queuedTurn, error.message || 'Workspace is unavailable.');
        continue;
      }

      const lock = await this.acquireLock(queuedTurn).catch((error) => {
        if (codexToolService.isWorkspaceLockConflictError(error)) {
          return null;
        }
        throw error;
      });
      if (!lock) {
        continue;
      }

      const now = new Date();
      const claimedTurn = await CodexTurn.findOneAndUpdate({
        _id: queuedTurn._id,
        status: 'queued',
      }, {
        $set: {
          status: 'running',
          startedAt: now,
          errorMessage: '',
        },
      }, { new: true }).exec();

      if (!claimedTurn) {
        await this.releaseLock(lock);
        continue;
      }

      this.activeTurns.set(String(claimedTurn._id), {
        workspaceId: String(claimedTurn.workspaceId),
        startedAt: now,
      });

      this.runClaimedTurn(claimedTurn, bundle.workspace, bundle.target, lock).catch((error) => {
        this.lastError = error.message;
        logger.error('Codex turn execution failed unexpectedly', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(claimedTurn._id),
            error,
          },
        });
      });
      return true;
    }

    return false;
  }

  async acquireLock(turn) {
    const config = this.getConfig();
    const now = new Date();
    return CodexWorkspaceLock.create({
      workspaceId: String(turn.workspaceId),
      turnId: String(turn._id),
      workerId: this.workerId,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: addMilliseconds(now, config.lockTtlMs),
    });
  }

  async releaseLock(lock) {
    if (!lock) {
      return;
    }
    await CodexWorkspaceLock.deleteOne({
      workspaceId: lock.workspaceId,
      turnId: lock.turnId,
      workerId: lock.workerId,
    }).exec();
  }

  async blockTurn(turn, message) {
    const completedAt = new Date();
    const updatedTurn = await CodexTurn.findOneAndUpdate({
      _id: turn._id,
      status: 'queued',
    }, {
      $set: {
        status: 'blocked',
        completedAt,
        errorMessage: message,
      },
    }, { new: true }).exec();
    if (!updatedTurn) {
      return;
    }
    await this.recordEvent(updatedTurn, 1, {
      stream: 'system',
      eventType: 'turn.blocked',
      text: message,
      severity: 'error',
    });
    await codexToolService.updateSessionAfterTurn(updatedTurn);
  }

  async runClaimedTurn(turn, workspace, target, lock) {
    const config = this.getConfig();
    let nextEventSeq = 1;
    let storedEventCount = 0;
    let eventCapReached = false;
    let heartbeatInterval = null;

    const session = await CodexSession.findById(turn.sessionId).lean().exec();
    const onEvent = async (event) => {
      if (storedEventCount >= config.maxEventsPerTurn) {
        if (!eventCapReached) {
          eventCapReached = true;
          await this.recordEvent(turn, nextEventSeq, {
            stream: 'system',
            eventType: 'events.truncated',
            text: `Event storage limit reached at ${config.maxEventsPerTurn} events.`,
            severity: 'warning',
          });
          nextEventSeq += 1;
          storedEventCount += 1;
        }
        return;
      }
      await this.recordEvent(turn, nextEventSeq, event);
      nextEventSeq += 1;
      storedEventCount += 1;
    };
    const onCommand = async (commandSummary) => {
      await CodexTurn.updateOne({ _id: turn._id }, { $set: { commandSummary } }).exec();
      await onEvent({
        stream: 'system',
        eventType: 'process.started',
        payload: commandSummary,
        text: 'Codex process started.',
        severity: 'info',
      });
    };
    const isCancellationRequested = async () => {
      const currentTurn = await CodexTurn.findById(turn._id).select({ cancelRequestedAt: 1, status: 1 }).lean().exec();
      return Boolean(currentTurn && (currentTurn.cancelRequestedAt || currentTurn.status === 'cancelled'));
    };

    heartbeatInterval = setInterval(() => {
      const now = new Date();
      CodexWorkspaceLock.updateOne({
        _id: lock._id,
        turnId: String(turn._id),
        workerId: this.workerId,
      }, {
        $set: {
          heartbeatAt: now,
          expiresAt: addMilliseconds(now, config.lockTtlMs),
        },
      }).exec().catch((error) => {
        this.lastError = error.message;
      });
    }, config.heartbeatMs);
    if (heartbeatInterval.unref) {
      heartbeatInterval.unref();
    }

    try {
      const result = await this.runner.runTurn({
        turn,
        session,
        workspace,
        target,
        onEvent,
        onCommand,
        isCancellationRequested,
      });

      const completedAt = new Date();
      const finalResponse = result.finalResponse || '';
      const updatedTurn = await CodexTurn.findByIdAndUpdate(turn._id, {
        $set: {
          status: result.status,
          finalResponse,
          responsePreview: codexToolService.previewFromText(finalResponse),
          codexThreadIdSeen: result.codexThreadId || null,
          commandSummary: result.commandSummary || {},
          exitCode: result.exitCode,
          exitSignal: result.exitSignal || '',
          errorMessage: result.errorMessage || '',
          usage: result.usage || {},
          eventCount: storedEventCount,
          completedAt,
          durationMs: result.durationMs,
        },
      }, { new: true }).exec();

      await onEvent({
        stream: 'system',
        eventType: `turn.${result.status}`,
        text: result.status === 'succeeded' ? 'Codex turn completed.' : (result.errorMessage || `Codex turn ended with status ${result.status}.`),
        severity: result.status === 'succeeded' ? 'info' : 'error',
      });
      updatedTurn.eventCount = storedEventCount;
      await CodexTurn.updateOne({ _id: turn._id }, { $set: { eventCount: storedEventCount } }).exec();

      if (result.codexThreadId) {
        await CodexSession.updateOne({
          _id: turn.sessionId,
          codexThreadId: { $in: [null, ''] },
        }, {
          $set: { codexThreadId: result.codexThreadId },
        }).exec();
      }
      await codexToolService.updateSessionAfterTurn(updatedTurn);
    } catch (error) {
      const completedAt = new Date();
      const durationMs = turn.startedAt ? completedAt.getTime() - new Date(turn.startedAt).getTime() : null;
      const updatedTurn = await CodexTurn.findByIdAndUpdate(turn._id, {
        $set: {
          status: 'failed',
          completedAt,
          durationMs,
          errorMessage: error.message || 'Codex turn failed unexpectedly.',
          eventCount: storedEventCount,
        },
      }, { new: true }).exec();
      await onEvent({
        stream: 'system',
        eventType: 'turn.failed',
        text: error.message || 'Codex turn failed unexpectedly.',
        severity: 'error',
      });
      updatedTurn.eventCount = storedEventCount;
      await CodexTurn.updateOne({ _id: turn._id }, { $set: { eventCount: storedEventCount } }).exec();
      await codexToolService.updateSessionAfterTurn(updatedTurn);
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      this.activeTurns.delete(String(turn._id));
      await this.releaseLock(lock).catch((error) => {
        this.lastError = error.message;
      });
    }
  }

  async recordEvent(turn, seq, event) {
    const config = this.getConfig();
    const turnId = String(turn._id);
    await CodexEvent.create({
      turnId,
      sessionId: String(turn.sessionId),
      workspaceId: String(turn.workspaceId),
      seq,
      eventType: String(event.eventType || 'event').slice(0, 160),
      stream: event.stream || 'system',
      payload: sanitizePayload(event.payload || {}, config.maxEventTextChars),
      text: clipText(event.text || '', config.maxEventTextChars),
      severity: event.severity || 'info',
      hiddenByDefault: event.hiddenByDefault !== false,
    }).catch((error) => {
      if (error && error.code === 11000) {
        return null;
      }
      throw error;
    });
  }
}

module.exports = new CodexQueueWorker();
