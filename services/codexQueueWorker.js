const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const CodexWorkspaceLock = require('../models/codex_workspace_lock');
const CodexTurn = require('../models/codex_turn');
const CodexEvent = require('../models/codex_event');
const CodexTurnMessage = require('../models/codex_turn_message');
const CodexSession = require('../models/codex_session');
const codexToolService = require('./codexToolService');
const CodexLocalRunner = require('./codexLocalRunner');
const CodexOllamaReservation = require('./codexOllamaReservation');
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

function clipVerboseText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  const marker = '\n[output truncated]\n';
  const available = Math.max(0, maxLength - marker.length);
  const headLength = Math.ceil(available * 0.55);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`;
}

const PAYLOAD_KEY_PRIORITY = Object.freeze([
  'type', 'id', 'status', 'threadId', 'thread_id', 'turnId', 'turn_id',
  'deliveryStatus', 'ownerId', 'phase', 'command', 'cwd', 'exitCode', 'exit_code',
  'durationMs', 'duration_ms', 'error', 'failure', 'server', 'tool', 'namespace', 'readOnlyHint',
  'commandActions', 'command_actions', 'changes', 'action', 'item',
]);
const PAYLOAD_VERBOSE_KEY_PATTERN = /(?:aggregated.?output|content|delta|diff|error|output|prompt|result|stderr|stdout|text)$/i;
const PAYLOAD_SECRET_KEY_PATTERN = /(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)$/i;

function orderedPayloadKeys(value) {
  const priority = new Map(PAYLOAD_KEY_PRIORITY.map((key, index) => [key, index]));
  return Object.keys(value).sort((left, right) => {
    const leftPriority = priority.has(left) ? priority.get(left) : PAYLOAD_KEY_PRIORITY.length;
    const rightPriority = priority.has(right) ? priority.get(right) : PAYLOAD_KEY_PRIORITY.length;
    const leftVerbose = PAYLOAD_VERBOSE_KEY_PATTERN.test(left) ? 1 : 0;
    const rightVerbose = PAYLOAD_VERBOSE_KEY_PATTERN.test(right) ? 1 : 0;
    return leftPriority - rightPriority || leftVerbose - rightVerbose;
  });
}

function compactPayloadFallback(payload, maxLength) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const nested = source.payload && typeof source.payload === 'object' ? source.payload : {};
  const item = source.item && typeof source.item === 'object'
    ? source.item
    : (nested.item && typeof nested.item === 'object' ? nested.item : null);
  const result = { truncated: true };
  ['threadId', 'thread_id', 'turnId', 'turn_id', 'deliveryStatus', 'ownerId', 'status', 'message']
    .forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
    });
  if (item) {
    result.item = {};
    [
      'type', 'id', 'status', 'phase', 'command', 'cwd', 'exitCode', 'exit_code',
      'durationMs', 'duration_ms', 'server', 'tool', 'namespace', 'readOnlyHint',
      'commandActions', 'command_actions', 'changes', 'action', 'appContext', 'source',
      'pluginId', 'scriptPath',
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(item, key)) result.item[key] = item[key];
    });
    const verboseKey = ['aggregatedOutput', 'aggregated_output', 'output', 'result', 'text', 'prompt']
      .find((key) => Object.prototype.hasOwnProperty.call(item, key));
    if (verboseKey) {
      result.item[verboseKey] = clipVerboseText(
        item[verboseKey],
        Math.max(100, Math.floor(maxLength / 3))
      );
    }
  }
  const serialized = JSON.stringify(result);
  if (serialized.length <= maxLength) return result;
  if (result.item) {
    delete result.item.commandActions;
    delete result.item.command_actions;
    delete result.item.changes;
    delete result.item.result;
    delete result.item.output;
    delete result.item.aggregatedOutput;
    delete result.item.aggregated_output;
    result.item.truncated = true;
  }
  return result;
}

function sanitizePayload(payload, maxLength) {
  if (!payload || typeof payload !== 'object') {
    return payload || {};
  }

  const budget = {
    remaining: Math.max(100, maxLength - 300),
    truncated: false,
    truncatedFields: [],
  };
  const visit = (value, key = '', fieldPath = key, depth = 0) => {
    if (PAYLOAD_SECRET_KEY_PATTERN.test(key)) {
      return '[redacted]';
    }
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
      budget.remaining -= 12;
      return value;
    }
    if (typeof value === 'string') {
      const preferredLimit = PAYLOAD_VERBOSE_KEY_PATTERN.test(key)
        ? Math.max(100, Math.min(6000, Math.floor(maxLength / 2)))
        : Math.max(80, Math.min(2000, Math.floor(maxLength / 4)));
      const allowed = Math.max(40, Math.min(preferredLimit, budget.remaining));
      const clipped = PAYLOAD_VERBOSE_KEY_PATTERN.test(key)
        ? clipVerboseText(value, allowed)
        : clipText(value, allowed);
      budget.remaining = Math.max(0, budget.remaining - clipped.length - key.length - 6);
      if (clipped.length < String(value).length) {
        budget.truncated = true;
        budget.truncatedFields.push(fieldPath);
      }
      return clipped;
    }
    if (depth >= 10 || budget.remaining <= 40) {
      budget.truncated = true;
      budget.truncatedFields.push(fieldPath);
      return '[nested data truncated]';
    }
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 100);
      const result = [];
      for (let index = 0; index < limit && budget.remaining > 40; index += 1) {
        result.push(visit(value[index], key, `${fieldPath}[${index}]`, depth + 1));
      }
      if (result.length < value.length) {
        budget.truncated = true;
        budget.truncatedFields.push(fieldPath);
        result.push(`[${value.length - result.length} entries truncated]`);
      }
      return result;
    }
    const result = {};
    const keys = orderedPayloadKeys(value);
    for (const childKey of keys) {
      if (budget.remaining <= 40) {
        budget.truncated = true;
        budget.truncatedFields.push(fieldPath || 'payload');
        break;
      }
      result[childKey] = visit(
        value[childKey],
        childKey,
        fieldPath ? `${fieldPath}.${childKey}` : childKey,
        depth + 1
      );
    }
    return result;
  };

  try {
    const cloned = visit(payload, '', '', 0);
    if (budget.truncated) {
      cloned.truncated = true;
      cloned.truncatedFields = Array.from(new Set(budget.truncatedFields.filter(Boolean))).slice(0, 30);
    }
    if (JSON.stringify(cloned).length <= maxLength) return cloned;
    return compactPayloadFallback(cloned, maxLength);
  } catch (_error) {
    return {
      truncated: true,
      text: String(payload).slice(0, maxLength),
    };
  }
}

class CodexQueueWorker {
  constructor(options = {}) {
    this.workerId = `codex-worker-${process.pid}-${randomUUID()}`;
    this.runner = options.runner || new CodexLocalRunner();
    this.ollamaReservation = options.ollamaReservation || new CodexOllamaReservation();
    this.databaseReady = options.databaseReady || (() => true);
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

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
    await this.releaseOllamaReservationIfIdle();
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
      ollamaReservation: this.ollamaReservation.getStatus(),
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
      }, { returnDocument: 'after' }).exec();
      await CodexWorkspaceLock.deleteMany({ turnId: turn._id }).exec();
      await this.failOutstandingAdditionalMessages(
        turn._id,
        'The Codex worker stopped before this message could be delivered.'
      );
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
    if (!this.started || !config.workerEnabled || this.tickInFlight || !this.databaseReady()) {
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
      await this.releaseOllamaReservationIfIdle();
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

      try {
        await codexToolService.assertModelProviderAvailable(
          codexToolService.getTurnModelProvider(queuedTurn)
        );
      } catch (error) {
        await this.blockTurn(queuedTurn, error.message || 'The selected model provider is unavailable.');
        logger.warning('Codex turn blocked because its model provider is unavailable', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(queuedTurn._id),
            modelProvider: codexToolService.getTurnModelProvider(queuedTurn),
          },
        });
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
      }, { returnDocument: 'after' }).exec();

      if (!claimedTurn) {
        await this.releaseLock(lock);
        continue;
      }

      this.activeTurns.set(String(claimedTurn._id), {
        workspaceId: String(claimedTurn.workspaceId),
        modelProvider: codexToolService.getTurnModelProvider(claimedTurn),
        startedAt: now,
        processStarted: false,
        acceptingMessages: true,
        codexThreadId: '',
        codexTurnId: '',
        deliveryPromise: null,
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
    }, { returnDocument: 'after' }).exec();
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

  async hasPendingOllamaTurns(excludeTurnId = '') {
    const query = {
      modelProvider: 'ollama',
      status: { $in: ['queued', 'running'] },
    };
    if (excludeTurnId) {
      query._id = { $ne: String(excludeTurnId) };
    }
    return Boolean(await CodexTurn.exists(query).exec());
  }

  async reserveOllamaGpu(turn) {
    const reservation = await this.ollamaReservation.reserve();
    logger.notice('Reserved AI Gateway GPU for Codex Ollama turn', {
      category: 'codex_tool',
      metadata: {
        workerId: this.workerId,
        turnId: String(turn._id),
        service: reservation.service || 'ollama',
        idleTimeoutSec: reservation.idleTimeoutSec || this.ollamaReservation.getStatus().idleTimeoutSec,
      },
    });
    return reservation;
  }

  async releaseOllamaReservationIfIdle(excludeTurnId = '') {
    if (!this.ollamaReservation.getStatus().held) {
      return false;
    }
    if (await this.hasPendingOllamaTurns(excludeTurnId)) {
      return false;
    }
    try {
      const result = await this.ollamaReservation.release();
      if (result.released && result.initiated !== false) {
        logger.notice('Released AI Gateway GPU after Codex Ollama queue drained', {
          category: 'codex_tool',
          metadata: { workerId: this.workerId },
        });
      }
      return result.released;
    } catch (error) {
      this.lastError = error.message;
      logger.warning('Failed to release AI Gateway GPU after Codex Ollama turn', {
        category: 'codex_tool',
        metadata: {
          workerId: this.workerId,
          error: error.message,
        },
      });
      return false;
    }
  }

  async recordAdditionalMessageEvent(active, turnMessage, deliveryStatus) {
    if (!active || typeof active.onEvent !== 'function' || !turnMessage) {
      return;
    }
    const delivered = deliveryStatus === 'delivered';
    try {
      const result = await active.onEvent({
        stream: 'system',
        eventType: delivered ? 'user.message.sent' : 'user.message.failed',
        payload: {
          item: {
            type: 'user_message',
            text: String(turnMessage.message || ''),
          },
          deliveryStatus,
          ownerId: String(active.turn.createdBy?.id || ''),
        },
        text: '',
        severity: delivered ? 'info' : 'error',
        hiddenByDefault: false,
      });
      if (result && result.stored) {
        await CodexTurn.updateOne(
          { _id: active.turn._id },
          { $set: { eventCount: result.count } }
        ).exec();
      }
    } catch (error) {
      logger.error('Codex additional message detail could not be recorded', {
        category: 'codex_tool',
        metadata: {
          workerId: this.workerId,
          turnId: String(active.turn._id),
          messageId: String(turnMessage._id),
          errorName: error?.name || 'Error',
        },
      });
    }
  }

  async deliverPendingAdditionalMessages(turnId) {
    const active = this.activeTurns.get(String(turnId));
    if (!active || !active.acceptingMessages || !active.processStarted ||
      !active.codexThreadId || !active.codexTurnId) {
      return false;
    }
    if (active.deliveryPromise) {
      return active.deliveryPromise;
    }

    const deliveryPromise = this.deliverPendingAdditionalMessagesNow(active);
    active.deliveryPromise = deliveryPromise;
    try {
      return await deliveryPromise;
    } finally {
      if (active.deliveryPromise === deliveryPromise) {
        active.deliveryPromise = null;
      }
    }
  }

  async deliverPendingAdditionalMessagesNow(active) {
    const config = this.getConfig();
    const messages = await CodexTurnMessage.find({
      turnId: String(active.turn._id),
      status: 'queued',
    })
      .sort({ queuedAt: 1 })
      .limit(config.maxAdditionalMessagesPerTurn)
      .lean()
      .exec();
    let deliveredCount = 0;

    for (const message of messages) {
      if (!active.acceptingMessages) {
        break;
      }
      const deliveryStartedAt = new Date();
      const claimedMessage = await CodexTurnMessage.findOneAndUpdate({
        _id: message._id,
        turnId: String(active.turn._id),
        status: 'queued',
      }, {
        $set: {
          status: 'delivering',
          workerId: this.workerId,
          deliveryStartedAt,
          errorMessage: '',
        },
      }, { returnDocument: 'after' }).lean().exec();
      if (!claimedMessage) {
        continue;
      }

      try {
        await this.runner.sendAdditionalMessage({
          turn: active.turn,
          workspace: active.workspace,
          target: active.target,
          threadId: active.codexThreadId,
          expectedTurnId: active.codexTurnId,
          messageId: claimedMessage._id,
          message: claimedMessage.message,
        });
      } catch (error) {
        const failedAt = new Date();
        await CodexTurnMessage.updateOne({
          _id: claimedMessage._id,
          status: 'delivering',
          workerId: this.workerId,
        }, {
          $set: {
            status: 'failed',
            failedAt,
            errorMessage: 'Codex did not accept the additional message.',
          },
        }).exec();
        await this.recordAdditionalMessageEvent(active, claimedMessage, 'failed');
        logger.warning('Codex additional message delivery failed', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(active.turn._id),
            messageId: String(claimedMessage._id),
            errorName: error?.name || 'Error',
            errorCode: error?.code || null,
          },
        });
        continue;
      }

      await CodexTurnMessage.updateOne({
        _id: claimedMessage._id,
        status: 'delivering',
        workerId: this.workerId,
      }, {
        $set: {
          status: 'delivered',
          deliveredAt: new Date(),
          errorMessage: '',
        },
      }).exec().catch((error) => {
        logger.error('Codex additional message delivery status could not be saved', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(active.turn._id),
            messageId: String(claimedMessage._id),
            errorName: error?.name || 'Error',
          },
        });
      });
      await this.recordAdditionalMessageEvent(active, claimedMessage, 'delivered');
      deliveredCount += 1;
    }

    return deliveredCount > 0;
  }

  async failQueuedAdditionalMessages(active, errorMessage) {
    const messages = await CodexTurnMessage.find({
      turnId: String(active.turn._id),
      status: 'queued',
    }).sort({ queuedAt: 1 }).lean().exec();

    for (const message of messages) {
      const failedMessage = await CodexTurnMessage.findOneAndUpdate({
        _id: message._id,
        status: 'queued',
      }, {
        $set: {
          status: 'failed',
          workerId: this.workerId,
          failedAt: new Date(),
          errorMessage,
        },
      }, { returnDocument: 'after' }).lean().exec();
      if (failedMessage) {
        await this.recordAdditionalMessageEvent(active, failedMessage, 'failed');
      }
    }
  }

  async failOutstandingAdditionalMessages(turnId, errorMessage) {
    await CodexTurnMessage.updateMany({
      turnId: String(turnId),
      status: { $in: ['queued', 'delivering'] },
    }, {
      $set: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage,
      },
    }).exec();
  }

  async runClaimedTurn(turn, workspace, target, lock) {
    const config = this.getConfig();
    let nextEventSeq = 1;
    let storedEventCount = 0;
    let eventCapReached = false;
    let heartbeatInterval = null;
    let additionalMessageInterval = null;
    let eventWriteChain = Promise.resolve();
    const usesOllama = codexToolService.getTurnModelProvider(turn) === 'ollama';

    const session = await CodexSession.findById(turn.sessionId).lean().exec();
    const storeEvent = async (event) => {
      const isAdditionalUserMessage = event?.payload?.item?.type === 'user_message';
      if (storedEventCount >= config.maxEventsPerTurn && !isAdditionalUserMessage) {
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
        return { stored: false, count: storedEventCount };
      }
      await this.recordEvent(turn, nextEventSeq, event);
      nextEventSeq += 1;
      storedEventCount += 1;
      return { stored: true, count: storedEventCount };
    };
    const onEvent = (event) => {
      const operation = eventWriteChain.then(() => storeEvent(event));
      eventWriteChain = operation.catch(() => {});
      return operation;
    };
    const active = this.activeTurns.get(String(turn._id)) || {};
    Object.assign(active, {
      turn,
      session,
      workspace,
      target,
      onEvent,
      codexThreadId: String(turn.codexThreadIdSeen || session?.codexThreadId || ''),
      codexTurnId: '',
      processStarted: false,
      acceptingMessages: true,
      deliveryPromise: null,
      messagePollErrorReported: false,
    });
    this.activeTurns.set(String(turn._id), active);

    const onCommand = async (commandSummary) => {
      await CodexTurn.updateOne({ _id: turn._id }, { $set: { commandSummary } }).exec();
      await onEvent({
        stream: 'system',
        eventType: 'process.started',
        payload: commandSummary,
        text: 'Codex process started.',
        severity: 'info',
      });
      active.processStarted = true;
    };
    const onThreadId = async (threadId) => {
      active.codexThreadId = String(threadId || '');
      if (!active.codexThreadId) {
        return;
      }
      try {
        await Promise.all([
          CodexTurn.updateOne({ _id: turn._id, status: 'running' }, {
            $set: { codexThreadIdSeen: active.codexThreadId },
          }).exec(),
          CodexSession.updateOne({
            _id: turn.sessionId,
            codexThreadId: { $in: [null, ''] },
          }, {
            $set: { codexThreadId: active.codexThreadId },
          }).exec(),
        ]);
      } catch (error) {
        logger.error('Codex thread id could not be persisted while the turn was running', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(turn._id),
            errorName: error?.name || 'Error',
          },
        });
      }
    };
    const onTurnStarted = async ({ threadId, turnId }) => {
      active.codexThreadId = String(threadId || active.codexThreadId || '');
      active.codexTurnId = String(turnId || '');
      if (active.codexTurnId) {
        pollAdditionalMessages();
      }
    };
    const isCancellationRequested = async () => {
      const currentTurn = await CodexTurn.findById(turn._id).select({ cancelRequestedAt: 1, status: 1 }).lean().exec();
      return Boolean(currentTurn && (currentTurn.cancelRequestedAt || currentTurn.status === 'cancelled'));
    };
    const pollAdditionalMessages = () => {
      this.deliverPendingAdditionalMessages(turn._id)
        .then(() => {
          active.messagePollErrorReported = false;
        })
        .catch((error) => {
          this.lastError = error.message;
          if (!active.messagePollErrorReported) {
            active.messagePollErrorReported = true;
            logger.warning('Codex additional message polling failed', {
              category: 'codex_tool',
              metadata: {
                workerId: this.workerId,
                turnId: String(turn._id),
                errorName: error?.name || 'Error',
              },
            });
          }
        });
    };
    const stopAdditionalMessageDelivery = async () => {
      active.acceptingMessages = false;
      if (additionalMessageInterval) {
        clearInterval(additionalMessageInterval);
        additionalMessageInterval = null;
      }
      if (active.deliveryPromise) {
        await active.deliveryPromise.catch(() => {});
      }
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
    additionalMessageInterval = setInterval(pollAdditionalMessages, config.additionalMessagePollMs);
    if (additionalMessageInterval.unref) {
      additionalMessageInterval.unref();
    }

    try {
      if (usesOllama) {
        await onEvent({
          stream: 'system',
          eventType: 'gpu.reservation.requested',
          text: 'Waiting for the AI Gateway Ollama GPU reservation.',
          severity: 'info',
        });
        const reservation = await this.reserveOllamaGpu(turn);
        await onEvent({
          stream: 'system',
          eventType: 'gpu.reservation.acquired',
          payload: {
            service: reservation.service || 'ollama',
            idleTimeoutSec: reservation.idleTimeoutSec || this.ollamaReservation.getStatus().idleTimeoutSec,
          },
          text: 'AI Gateway Ollama GPU reservation acquired.',
          severity: 'info',
        });
      }
      const result = await this.runner.runTurn({
        turn,
        session,
        workspace,
        target,
        onEvent,
        onCommand,
        onThreadId,
        onTurnStarted,
        isCancellationRequested,
      });
      await stopAdditionalMessageDelivery();

      const completedAt = new Date();
      const finalResponse = result.finalResponse || '';
      const codexThreadId = result.codexThreadId || active.codexThreadId || null;
      const updatedTurn = await CodexTurn.findByIdAndUpdate(turn._id, {
        $set: {
          status: result.status,
          finalResponse,
          responsePreview: codexToolService.previewFromText(finalResponse),
          codexThreadIdSeen: codexThreadId,
          commandSummary: result.commandSummary || {},
          exitCode: result.exitCode,
          exitSignal: result.exitSignal || '',
          errorMessage: result.errorMessage || '',
          usage: result.usage || {},
          eventCount: storedEventCount,
          completedAt,
          durationMs: result.durationMs,
        },
      }, { returnDocument: 'after' }).exec();

      await this.failQueuedAdditionalMessages(
        active,
        'The Codex turn finished before this message could be delivered.'
      ).catch((error) => {
        logger.error('Queued Codex messages could not be finalized after turn completion', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(turn._id),
            errorName: error?.name || 'Error',
          },
        });
      });
      await onEvent({
        stream: 'system',
        eventType: `turn.${result.status}`,
        text: result.status === 'succeeded' ? 'Codex turn completed.' : (result.errorMessage || `Codex turn ended with status ${result.status}.`),
        severity: result.status === 'succeeded' ? 'info' : 'error',
      });
      updatedTurn.eventCount = storedEventCount;
      await CodexTurn.updateOne({ _id: turn._id }, { $set: { eventCount: storedEventCount } }).exec();

      if (codexThreadId) {
        await CodexSession.updateOne({
          _id: turn.sessionId,
          codexThreadId: { $in: [null, ''] },
        }, {
          $set: { codexThreadId },
        }).exec();
      }
      await codexToolService.updateSessionAfterTurn(updatedTurn);
    } catch (error) {
      await stopAdditionalMessageDelivery();
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
      }, { returnDocument: 'after' }).exec();
      await this.failQueuedAdditionalMessages(
        active,
        'The Codex turn failed before this message could be delivered.'
      ).catch((messageError) => {
        logger.error('Queued Codex messages could not be finalized after turn failure', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(turn._id),
            errorName: messageError?.name || 'Error',
          },
        });
      });
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
      await stopAdditionalMessageDelivery();
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      await this.failOutstandingAdditionalMessages(
        turn._id,
        'The Codex turn ended before this message could be delivered.'
      ).catch((error) => {
        this.lastError = error.message;
        logger.error('Outstanding Codex messages could not be finalized', {
          category: 'codex_tool',
          metadata: {
            workerId: this.workerId,
            turnId: String(turn._id),
            errorName: error?.name || 'Error',
          },
        });
      });
      this.activeTurns.delete(String(turn._id));
      if (usesOllama) {
        await this.releaseOllamaReservationIfIdle(turn._id);
      }
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

module.exports = new CodexQueueWorker({
  databaseReady: () => mongoose.connection.readyState === 1,
});
module.exports.CodexQueueWorker = CodexQueueWorker;
