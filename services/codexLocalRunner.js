const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const codexToolService = require('./codexToolService');
const logger = require('../utils/logger');
const {
  buildRemoteShellCommand,
  buildSshArgs,
  getRemoteCodexInvocation,
  getRemoteTempDir,
  getSshBinary,
  getSshDestination,
  quotePosixShellArg,
} = require('./codexSsh');

const execFileAsync = promisify(execFile);
const PROFILE_ENV_SHELL_SCRIPT = [
  'set -a',
  '. "$1"',
  'codex_env_status=$?',
  'set +a',
  '[ "$codex_env_status" -eq 0 ] || exit "$codex_env_status"',
  'shift',
  'exec "$@"',
].join('; ');

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

function isRemoteSshTarget(target) {
  return target && target.type === 'remote-ssh-linux';
}

function createLocalOutputPath(turnId) {
  return path.join(
    path.resolve(__dirname, '..', 'tmp_data'),
    `codex-last-message-${turnId}-${randomUUID()}.txt`
  );
}

function createRemoteOutputPath(target, turnId) {
  const tempDir = getRemoteTempDir(target && target.connection);
  const trimmedTempDir = tempDir.endsWith('/') && tempDir !== '/' ? tempDir.slice(0, -1) : tempDir;
  return `${trimmedTempDir}/codex-last-message-${turnId}-${randomUUID()}.txt`;
}

function normalizeProfileEnvironmentFile(value) {
  const envFile = String(value || '~/.codex/lentmiien.env').trim();
  if (envFile === '~' || envFile.startsWith('~/') || path.posix.isAbsolute(envFile)) {
    return envFile;
  }
  throw new Error('CODEX_RUNPOD_PROFILE_ENV_FILE must be an absolute path or start with ~/.');
}

function resolveLocalProfileEnvironmentFile(value) {
  const envFile = normalizeProfileEnvironmentFile(value);
  if (envFile === '~') {
    return os.homedir();
  }
  if (envFile.startsWith('~/')) {
    return path.join(os.homedir(), envFile.slice(2));
  }
  return envFile;
}

function quoteRemoteProfileEnvironmentFile(value) {
  const envFile = normalizeProfileEnvironmentFile(value);
  if (envFile === '~') {
    return '"$HOME"';
  }
  if (envFile.startsWith('~/')) {
    return `"$HOME"${quotePosixShellArg(`/${envFile.slice(2)}`)}`;
  }
  return quotePosixShellArg(envFile);
}

function buildProfileEnvironmentShellScript(commandText, environmentFileExpression) {
  return [
    'set -a',
    `. ${environmentFileExpression}`,
    'codex_env_status=$?',
    'set +a',
    '[ "$codex_env_status" -eq 0 ] || exit "$codex_env_status"',
    `exec ${commandText}`,
  ].join('; ');
}

function buildCodexArgs({ turn, session, workspace, outputPath, ollamaProfile }) {
  const modelProvider = codexToolService.getTurnModelProvider(turn);
  const providerProfile = codexToolService.getModelProviderCodexProfile(modelProvider);
  const effectiveProfile = providerProfile || (modelProvider === 'ollama'
    ? (ollamaProfile || turn.profile || '')
    : (turn.profile || ''));
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

  if (modelProvider === 'ollama') {
    args.push('--oss');
  }
  if (turn.model && !providerProfile) {
    args.push('-m', turn.model);
  }
  if (effectiveProfile) {
    args.push('-p', effectiveProfile);
  }
  if (turn.reasoningEffort && !providerProfile) {
    args.push('-c', `model_reasoning_effort="${turn.reasoningEffort}"`);
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

  return { args, isFollowup, effectiveProfile };
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

  buildCommand({ turn, session, workspace, target }) {
    const config = this.getConfig();
    const remote = isRemoteSshTarget(target);
    const modelProvider = codexToolService.getTurnModelProvider(turn);
    const needsProfileEnvironment = codexToolService.modelProviderNeedsProfileEnvironment(modelProvider);
    const outputPath = remote ? createRemoteOutputPath(target, turn._id) : createLocalOutputPath(turn._id);
    const {
      args: codexArgs,
      isFollowup,
      effectiveProfile,
    } = buildCodexArgs({
      turn,
      session,
      workspace,
      outputPath,
      ollamaProfile: config.ollamaProfile,
    });

    if (remote) {
      const connection = target.connection || {};
      const executionConnection = needsProfileEnvironment && !String(connection.shell || '').trim()
        ? { ...connection, shell: config.runpodProfileShell }
        : connection;
      const remoteCodexInvocation = getRemoteCodexInvocation(connection);
      const codexCommandText = [...remoteCodexInvocation, ...codexArgs]
        .map(quotePosixShellArg)
        .join(' ');
      const remoteScript = needsProfileEnvironment
        ? buildProfileEnvironmentShellScript(
          codexCommandText,
          quoteRemoteProfileEnvironmentFile(config.runpodProfileEnvFile)
        )
        : `exec ${codexCommandText}`;
      const remoteCommand = buildRemoteShellCommand(
        remoteScript,
        executionConnection
      );
      const sshArgs = buildSshArgs(connection, remoteCommand);
      const destination = getSshDestination(connection);

      return {
        binary: getSshBinary(connection),
        args: sshArgs,
        cwd: path.resolve(__dirname, '..'),
        outputPath,
        outputLocation: 'remote',
        remoteRead: {
          binary: getSshBinary(connection),
          args: buildSshArgs(
            connection,
            buildRemoteShellCommand(
              `if [ -f ${quotePosixShellArg(outputPath)} ]; then cat ${quotePosixShellArg(outputPath)}; rm -f ${quotePosixShellArg(outputPath)}; fi`,
              connection
            )
          ),
        },
        timeoutMs: config.timeoutMs,
        commandSummary: {
          binary: getSshBinary(connection),
          args: sshArgs,
          cwd: workspace.rootPath,
          outputLocation: 'remote',
          remoteCodexCommand: remoteCodexInvocation,
          sshDestination: destination,
          targetType: target.type,
          resume: isFollowup,
          permissionMode: turn.permissionMode,
          modelProvider,
          modelProviderLabel: codexToolService.getModelProviderLabel(modelProvider),
          profileEnvironmentFile: needsProfileEnvironment ? config.runpodProfileEnvFile : '',
          oss: modelProvider === 'ollama',
          model: turn.model || '',
          profile: effectiveProfile,
          reasoningEffort: turn.reasoningEffort || '',
        },
      };
    }

    const localLaunch = needsProfileEnvironment
      ? {
        binary: config.runpodProfileShell,
        args: [
          '-c',
          PROFILE_ENV_SHELL_SCRIPT,
          'codex-runpod-profile',
          resolveLocalProfileEnvironmentFile(config.runpodProfileEnvFile),
          config.binaryPath,
          ...codexArgs,
        ],
      }
      : { binary: config.binaryPath, args: codexArgs };

    return {
      binary: localLaunch.binary,
      args: localLaunch.args,
      cwd: workspace.rootPath,
      outputPath,
      outputLocation: 'local',
      timeoutMs: config.timeoutMs,
      commandSummary: {
        binary: config.binaryPath,
        args: codexArgs,
        cwd: workspace.rootPath,
        outputLocation: 'local',
        resume: isFollowup,
        permissionMode: turn.permissionMode,
        modelProvider,
        modelProviderLabel: codexToolService.getModelProviderLabel(modelProvider),
        profileEnvironmentFile: needsProfileEnvironment ? config.runpodProfileEnvFile : '',
        oss: modelProvider === 'ollama',
        model: turn.model || '',
        profile: effectiveProfile,
        reasoningEffort: turn.reasoningEffort || '',
      },
    };
  }

  async readFinalResponse(command, assistantMessages) {
    if (command.outputLocation === 'remote') {
      try {
        const result = await execFileAsync(command.remoteRead.binary, command.remoteRead.args, {
          timeout: 15000,
          maxBuffer: 1024 * 1024 * 5,
        });
        return String(result.stdout || '').trim();
      } catch (_error) {
        return assistantMessages.join('\n\n');
      }
    }

    try {
      return await fs.promises.readFile(command.outputPath, 'utf8');
    } catch (_error) {
      return assistantMessages.join('\n\n');
    }
  }

  async runTurn({ turn, session, workspace, target, onEvent, onCommand, isCancellationRequested }) {
    const command = this.buildCommand({ turn, session, workspace, target });
    const runnerConfig = this.getConfig();
    const completionExitGraceMs = Number.isFinite(runnerConfig.completionExitGraceMs)
      ? Math.max(1, runnerConfig.completionExitGraceMs)
      : 2000;
    if (command.outputLocation !== 'remote') {
      await fs.promises.mkdir(path.dirname(command.outputPath), { recursive: true });
    }
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
    let completionExitTimer = null;
    // Codex can finish authoritatively before its wrapper emits close.
    let terminalCompletionSeen = false;
    let completionGraceExpired = false;
    let resolveCompletionGraceExpired;
    const completionGraceExpiredPromise = new Promise((resolve) => {
      resolveCompletionGraceExpired = resolve;
    });
    let streamChain = Promise.resolve();
    let pendingStreamTaskCount = 0;
    let scheduleCompletionFallback = () => {};

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
        const isTerminalCompletion = eventType === 'turn.completed';
        if (isTerminalCompletion) {
          terminalCompletionSeen = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          if (cancelInterval) {
            clearInterval(cancelInterval);
            cancelInterval = null;
          }
          scheduleCompletionFallback();
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

    const cleanupOperationalTimers = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (cancelInterval) clearInterval(cancelInterval);
      if (killTimer) clearTimeout(killTimer);
    };

    const clearCompletionExitTimer = () => {
      if (completionExitTimer) {
        clearTimeout(completionExitTimer);
        completionExitTimer = null;
      }
    };

    return new Promise((resolve) => {
      let settled = false;
      const enqueueStreamWork = (task) => {
        pendingStreamTaskCount += 1;
        streamChain = streamChain
          .then(task)
          .catch((error) => {
            childError = childError || error;
          })
          .finally(() => {
            pendingStreamTaskCount -= 1;
          });
      };
      const finish = async (result) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupOperationalTimers();

        let finalStreamEventPending = false;
        const drainStreamWork = async () => {
          await streamChain;
          if (stdoutRemainder.trim()) {
            const finalStdoutLine = stdoutRemainder;
            stdoutRemainder = '';
            finalStreamEventPending = true;
            try {
              await handleJsonLine(finalStdoutLine);
            } finally {
              finalStreamEventPending = false;
            }
          }
          if (stderrRemainder.trim()) {
            const finalStderrLine = stderrRemainder;
            stderrRemainder = '';
            finalStreamEventPending = true;
            try {
              await emit({
                stream: 'stderr',
                eventType: 'stderr.line',
                text: clipText(finalStderrLine, this.getConfig().maxEventTextChars),
                severity: 'warning',
              });
            } finally {
              finalStreamEventPending = false;
            }
          }
        };
        // Do not let a completed turn remain running because its final event write never settles.
        let streamDrained = await Promise.race([
          drainStreamWork()
            .then(() => true)
            .catch((error) => {
              childError = childError || error;
              return true;
            }),
          completionGraceExpiredPromise.then(() => false),
        ]);
        if (!streamDrained && pendingStreamTaskCount === 0 && !finalStreamEventPending &&
          !stdoutRemainder.trim() && !stderrRemainder.trim()) {
          streamDrained = true;
        }
        clearCompletionExitTimer();
        if (!streamDrained) {
          logger.warning('Codex event stream did not drain after turn.completed; finalizing from the terminal event', {
            category: 'codex_tool',
            metadata: {
              turnId: String(turn._id),
              pendingStreamTaskCount,
              finalStreamEventPending,
              completionExitGraceMs,
            },
          }).catch(() => {});
        }

        let finalResponse = '';
        try {
          finalResponse = await this.readFinalResponse(command, assistantMessages);
        } catch (error) {
          childError = childError || error;
          finalResponse = assistantMessages.join('\n\n');
        }
        if (command.outputLocation !== 'remote') {
          fs.promises.unlink(command.outputPath).catch(() => {});
        }

        const durationMs = Date.now() - startedAt;
        const stderrText = stderrChunks.join('').trim();
        const status = terminalCompletionSeen
          ? 'succeeded'
          : cancelled
            ? 'cancelled'
            : timedOut
              ? 'timed_out'
              : result.exitCode === 0
                ? 'succeeded'
                : 'failed';
        resolve({
          ...result,
          status,
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

      scheduleCompletionFallback = () => {
        if (completionGraceExpired || completionExitTimer) {
          return;
        }
        completionExitTimer = setTimeout(() => {
          completionExitTimer = null;
          completionGraceExpired = true;
          resolveCompletionGraceExpired();
          if (settled) {
            return;
          }
          logger.warning('Codex process did not exit after turn.completed; finalizing from the terminal event', {
            category: 'codex_tool',
            metadata: {
              turnId: String(turn._id),
              processId: child.pid || null,
              outputLocation: command.outputLocation,
              completionExitGraceMs,
            },
          }).catch(() => {});
          if (child.exitCode === null && child.signalCode === null) {
            try {
              child.kill('SIGKILL');
            } catch (_error) {
              // The process may already be gone even when Node has not emitted close.
            }
          }
          finish({
            exitCode: child.exitCode,
            exitSignal: child.signalCode || '',
            errorMessage: childError ? childError.message : '',
          }).catch(() => {});
        }, completionExitGraceMs);
      };

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
        finish({
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
