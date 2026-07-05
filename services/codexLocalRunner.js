const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');

const codexToolService = require('./codexToolService');

function clipText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 18)}\n[output truncated]`;
}

function appendJsonTextFragments(value, fragments) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (typeof value.text === 'string' && value.text.trim()) {
    fragments.push(value.text);
  }
  if (typeof value.content === 'string' && value.content.trim()) {
    fragments.push(value.content);
  }
  if (Array.isArray(value.content)) {
    value.content.forEach((entry) => appendJsonTextFragments(entry, fragments));
  }
  if (value.message) {
    appendJsonTextFragments(value.message, fragments);
  }
}

function extractAssistantText(event) {
  const type = event && (event.type || event.event || event.payload?.type);
  if (!String(type || '').includes('agent') && !String(type || '').includes('assistant')) {
    return '';
  }
  const fragments = [];
  appendJsonTextFragments(event.payload || event, fragments);
  return fragments.join('\n').trim();
}

function extractCodexThreadId(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  if (event.type === 'session_meta') {
    return String(payload.session_id || payload.id || event.session_id || event.id || '').trim();
  }
  return String(
    payload.session_id ||
    payload.codex_session_id ||
    payload.thread_id ||
    payload.conversation_id ||
    event.session_id ||
    event.codex_session_id ||
    event.thread_id ||
    event.conversation_id ||
    ''
  ).trim();
}

function extractUsage(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return event.usage || payload.usage || payload.token_usage || null;
}

class CodexLocalRunner {
  constructor(config = {}) {
    this.config = config;
  }

  getConfig() {
    return {
      ...codexToolService.getRuntimeConfig(),
      ...this.config,
    };
  }

  buildCommand({ turn, session, workspace }) {
    const config = this.getConfig();
    const outputPath = path.join(
      path.resolve(__dirname, '..', 'tmp_data'),
      `codex-last-message-${turn._id}-${randomUUID()}.txt`
    );
    const args = [
      'exec',
      '--json',
      '--color',
      'never',
      '--cd',
      workspace.rootPath,
      '-o',
      outputPath,
    ];

    if (turn.model) {
      args.push('-m', turn.model);
    }
    if (turn.profile) {
      args.push('-p', turn.profile);
    }
    if (turn.permissionMode === 'yolo') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--sandbox', turn.permissionMode || 'read-only');
    }

    const isFollowup = String(turn.kind || '').startsWith('followup_');
    if (isFollowup) {
      args.push('resume', session.codexThreadId, '-');
    } else {
      args.push('-');
    }

    return {
      binary: config.binaryPath,
      args,
      cwd: workspace.rootPath,
      outputPath,
      timeoutMs: config.timeoutMs,
      commandSummary: {
        binary: config.binaryPath,
        args,
        cwd: workspace.rootPath,
        resume: isFollowup,
        permissionMode: turn.permissionMode,
        model: turn.model || '',
        profile: turn.profile || '',
      },
    };
  }

  async runTurn({ turn, session, workspace, onEvent, onCommand, isCancellationRequested }) {
    const command = this.buildCommand({ turn, session, workspace });
    await fs.promises.mkdir(path.dirname(command.outputPath), { recursive: true });
    if (typeof onCommand === 'function') {
      await onCommand(command.commandSummary);
    }

    const startedAt = Date.now();
    const assistantMessages = [];
    const stderrChunks = [];
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let codexThreadId = '';
    let usage = null;
    let timedOut = false;
    let cancelled = false;
    let childError = null;
    let killTimer = null;
    let cancelInterval = null;
    let timeoutHandle = null;
    let streamChain = Promise.resolve();

    const emit = async (event) => {
      if (typeof onEvent === 'function') {
        await onEvent(event);
      }
    };

    const handleJsonLine = async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        const eventType = parsed.type || parsed.event || parsed.payload?.type || 'codex.event';
        const nextThreadId = extractCodexThreadId(parsed);
        if (nextThreadId) {
          codexThreadId = nextThreadId;
        }
        const nextUsage = extractUsage(parsed);
        if (nextUsage) {
          usage = nextUsage;
        }
        const assistantText = extractAssistantText(parsed);
        if (assistantText) {
          assistantMessages.push(assistantText);
        }
        await emit({
          stream: 'stdout-json',
          eventType,
          payload: parsed,
          text: '',
          severity: eventType === 'error' ? 'error' : 'info',
        });
      } catch (_error) {
        await emit({
          stream: 'stdout',
          eventType: 'stdout.line',
          text: clipText(line, this.getConfig().maxEventTextChars),
          severity: 'info',
        });
      }
    };

    const handleStdoutChunk = async (chunk) => {
      stdoutRemainder += chunk.toString('utf8');
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() || '';
      for (const line of lines) {
        await handleJsonLine(line);
      }
    };

    const handleStderrChunk = async (chunk) => {
      stderrRemainder += chunk.toString('utf8');
      stderrChunks.push(chunk.toString('utf8'));
      const lines = stderrRemainder.split(/\r?\n/);
      stderrRemainder = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        await emit({
          stream: 'stderr',
          eventType: 'stderr.line',
          text: clipText(line, this.getConfig().maxEventTextChars),
          severity: 'warning',
        });
      }
    };

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (cancelInterval) clearInterval(cancelInterval);
      if (killTimer) clearTimeout(killTimer);
    };

    return new Promise((resolve) => {
      let settled = false;
      const enqueueStreamWork = (task) => {
        streamChain = streamChain
          .then(task)
          .catch((error) => {
            childError = childError || error;
          });
      };
      const finish = async (result) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        await streamChain;
        if (stdoutRemainder.trim()) {
          await handleJsonLine(stdoutRemainder);
        }
        if (stderrRemainder.trim()) {
          await emit({
            stream: 'stderr',
            eventType: 'stderr.line',
            text: clipText(stderrRemainder, this.getConfig().maxEventTextChars),
            severity: 'warning',
          });
        }

        let finalResponse = '';
        try {
          finalResponse = await fs.promises.readFile(command.outputPath, 'utf8');
        } catch (_error) {
          finalResponse = assistantMessages.join('\n\n');
        }
        fs.promises.unlink(command.outputPath).catch(() => {});

        const durationMs = Date.now() - startedAt;
        const stderrText = stderrChunks.join('').trim();
        resolve({
          ...result,
          finalResponse: String(finalResponse || '').trim(),
          codexThreadId,
          usage,
          durationMs,
          errorMessage: result.errorMessage || clipText(stderrText || childError?.message || '', 1800),
          commandSummary: command.commandSummary,
        });
      };

      const child = spawn(command.binary, command.args, {
        cwd: command.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const terminate = (reason) => {
        if (reason === 'timeout') {
          timedOut = true;
        }
        if (reason === 'cancelled') {
          cancelled = true;
        }
        if (!child.killed) {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL');
            }
          }, 10000);
          if (killTimer.unref) killTimer.unref();
        }
      };

      timeoutHandle = setTimeout(() => {
        terminate('timeout');
      }, command.timeoutMs);
      if (timeoutHandle.unref) timeoutHandle.unref();

      cancelInterval = setInterval(async () => {
        if (cancelled || timedOut) {
          return;
        }
        try {
          if (typeof isCancellationRequested === 'function' && await isCancellationRequested()) {
            terminate('cancelled');
          }
        } catch (_error) {
          // A failed cancellation poll should not interrupt the Codex process.
        }
      }, 2000);
      if (cancelInterval.unref) cancelInterval.unref();

      child.stdout.on('data', (chunk) => {
        enqueueStreamWork(() => handleStdoutChunk(chunk));
      });
      child.stderr.on('data', (chunk) => {
        enqueueStreamWork(() => handleStderrChunk(chunk));
      });
      child.on('error', (error) => {
        childError = error;
      });
      child.on('close', (exitCode, signal) => {
        const status = cancelled
          ? 'cancelled'
          : timedOut
            ? 'timed_out'
            : exitCode === 0
              ? 'succeeded'
              : 'failed';
        finish({
          status,
          exitCode,
          exitSignal: signal || '',
          errorMessage: childError ? childError.message : '',
        }).catch(() => {});
      });

      try {
        child.stdin.end(`${turn.prompt}\n`);
      } catch (error) {
        childError = childError || error;
      }
    });
  }
}

module.exports = CodexLocalRunner;
