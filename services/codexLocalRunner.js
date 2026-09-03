const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const codexToolService = require('./codexToolService');
const logger = require('../utils/logger');
const {
  buildRemoteShellCommand,
  buildSshArgs,
  getRemoteCodexInvocation,
  getSshBinary,
  getSshDestination,
  quotePosixShellArg,
} = require('./codexSsh');

const PROFILE_ENV_SHELL_SCRIPT = [
  'set -a',
  '. "$1"',
  'codex_env_status=$?',
  'set +a',
  '[ "$codex_env_status" -eq 0 ] || exit "$codex_env_status"',
  'shift',
  'exec "$@"',
].join('; ');
const APP_SERVER_CLIENT_INFO = Object.freeze({
  name: 'lentmiien_site',
  title: 'Lentmiien Codex worker',
  version: '1.0.0',
});
const OPTED_OUT_NOTIFICATION_METHODS = Object.freeze([
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'item/plan/delta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'turn/diff/updated',
]);
const ITEM_TYPE_MAP = Object.freeze({
  agentMessage: 'agent_message',
  collabAgentToolCall: 'collab_agent_tool_call',
  commandExecution: 'command_execution',
  contextCompaction: 'context_compaction',
  dynamicToolCall: 'dynamic_tool_call',
  fileChange: 'file_change',
  functionCallOutput: 'function_call_output',
  imageGeneration: 'image_generation',
  imageView: 'image_view',
  mcpToolCall: 'mcp_tool_call',
  plan: 'reasoning',
  reasoning: 'reasoning',
  sleep: 'sleep',
  subAgentActivity: 'sub_agent_activity',
  userMessage: 'user_message',
  webSearch: 'web_search',
});

function clipText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 18)}\n[output truncated]`;
}

function isRemoteSshTarget(target) {
  return target && target.type === 'remote-ssh-linux';
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

function getTurnLaunchSettings(turn, ollamaProfile) {
  const modelProvider = codexToolService.getTurnModelProvider(turn);
  const providerProfile = codexToolService.getModelProviderCodexProfile(modelProvider);
  const effectiveProfile = providerProfile || (modelProvider === 'ollama'
    ? (ollamaProfile || turn.profile || '')
    : (turn.profile || ''));
  return {
    effectiveProfile,
    model: providerProfile ? '' : String(turn.model || ''),
    modelProvider,
    reasoningEffort: providerProfile ? '' : String(turn.reasoningEffort || ''),
  };
}

function buildAppServerArgs({ turn, workspace, ollamaProfile }) {
  const settings = getTurnLaunchSettings(turn, ollamaProfile);
  const args = [];

  if (settings.modelProvider === 'ollama') {
    args.push('--oss');
  }
  if (settings.model) {
    args.push('-m', settings.model);
  }
  if (settings.effectiveProfile) {
    args.push('-p', settings.effectiveProfile);
  }
  if (settings.reasoningEffort) {
    args.push('-c', `model_reasoning_effort="${settings.reasoningEffort}"`);
  }
  args.push('-C', workspace.rootPath);
  if (turn.permissionMode === 'yolo') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', turn.permissionMode || 'read-only');
  }
  // Stdio is App Server's default transport. Some Codex builds advertise
  // --stdio in help but reject the redundant flag, so rely on the default.
  args.push('app-server');

  return { args, settings };
}

function sandboxModeForTurn(turn) {
  return turn.permissionMode === 'yolo'
    ? 'danger-full-access'
    : (turn.permissionMode || 'read-only');
}

function textFromUserContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((entry) => entry && entry.type === 'text')
    .map((entry) => String(entry.text || ''))
    .filter(Boolean)
    .join('\n');
}

function normalizeAppServerItem(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const normalizedType = ITEM_TYPE_MAP[item.type] || String(item.type || 'item');
  const normalized = { ...item, type: normalizedType };

  if (item.type === 'userMessage') {
    normalized.text = textFromUserContent(item.content);
  } else if (item.type === 'reasoning') {
    normalized.text = [...(item.summary || []), ...(item.content || [])]
      .map((entry) => String(entry || ''))
      .filter(Boolean)
      .join('\n\n');
  } else if (item.type === 'plan') {
    normalized.text = String(item.text || '');
  }
  return normalized;
}

function normalizePlanPayload(params) {
  return {
    ...params,
    item: {
      type: 'todo_list',
      items: (Array.isArray(params?.plan) ? params.plan : []).map((entry) => ({
        text: String(entry?.step || ''),
        completed: entry?.status === 'completed',
      })),
    },
  };
}

function slimTurn(turn) {
  if (!turn || typeof turn !== 'object') {
    return turn || {};
  }
  return {
    id: turn.id || '',
    status: turn.status || '',
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    error: turn.error || null,
  };
}

function normalizeNotificationPayload(method, params) {
  const payload = params && typeof params === 'object' ? params : {};
  if ((method === 'item/completed' || method === 'item/started') && payload.item) {
    return { ...payload, item: normalizeAppServerItem(payload.item) };
  }
  if (method === 'turn/plan/updated') {
    return normalizePlanPayload(payload);
  }
  if (method === 'turn/completed' || method === 'turn/started') {
    return { ...payload, turn: slimTurn(payload.turn) };
  }
  return payload;
}

function eventTypeFromMethod(method) {
  return String(method || 'codex/event').replaceAll('/', '.');
}

function tokenBreakdown(value) {
  const usage = value && typeof value === 'object' ? value : {};
  return {
    input_tokens: Number(usage.inputTokens) || 0,
    cached_input_tokens: Number(usage.cachedInputTokens) || 0,
    output_tokens: Number(usage.outputTokens) || 0,
    reasoning_output_tokens: Number(usage.reasoningOutputTokens) || 0,
    total_tokens: Number(usage.totalTokens) || 0,
  };
}

function createProtocolError(method, rpcError) {
  const error = new Error(`Codex app server rejected ${method}.`);
  error.code = rpcError?.code || 'CODEX_RPC_ERROR';
  return error;
}

class CodexLocalRunner {
  constructor(config = {}) {
    this.config = config;
    this.activeRuns = new Map();
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
    const needsProfileEnvironment = codexToolService.modelProviderNeedsProfileEnvironment(
      codexToolService.getTurnModelProvider(turn)
    );
    const { args: codexArgs, settings } = buildAppServerArgs({
      turn,
      workspace,
      ollamaProfile: config.ollamaProfile,
    });
    const isFollowup = String(turn.kind || '').startsWith('followup_');
    const summary = {
      binary: config.binaryPath,
      args: codexArgs,
      cwd: workspace.rootPath,
      operation: 'app-server',
      resume: isFollowup,
      permissionMode: turn.permissionMode,
      modelProvider: settings.modelProvider,
      modelProviderLabel: codexToolService.getModelProviderLabel(settings.modelProvider),
      profileEnvironmentFile: needsProfileEnvironment ? config.runpodProfileEnvFile : '',
      oss: settings.modelProvider === 'ollama',
      model: settings.model,
      profile: settings.effectiveProfile,
      reasoningEffort: settings.reasoningEffort,
    };

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
      const remoteCommand = buildRemoteShellCommand(remoteScript, executionConnection);
      const sshArgs = buildSshArgs(connection, remoteCommand);

      return {
        binary: getSshBinary(connection),
        args: sshArgs,
        cwd: path.resolve(__dirname, '..'),
        timeoutMs: config.timeoutMs,
        settings,
        commandSummary: {
          ...summary,
          binary: getSshBinary(connection),
          args: sshArgs,
          outputLocation: 'remote',
          remoteCodexCommand: remoteCodexInvocation,
          sshDestination: getSshDestination(connection),
          targetType: target.type,
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
      timeoutMs: config.timeoutMs,
      settings,
      commandSummary: {
        ...summary,
        outputLocation: 'local',
        targetType: target?.type || 'local',
      },
    };
  }

  async sendAdditionalMessage({ turn, message, messageId }) {
    const active = this.activeRuns.get(String(turn?._id || ''));
    if (!active || !active.accepting || !active.threadId || !active.turnId) {
      const unavailableError = new Error('Codex did not accept the additional message.');
      unavailableError.code = 'TURN_NOT_STEERABLE';
      throw unavailableError;
    }

    try {
      const result = await active.sendRequest('turn/steer', {
        threadId: active.threadId,
        expectedTurnId: active.turnId,
        input: [{ type: 'text', text: String(message || '') }],
        ...(messageId ? { clientUserMessageId: String(messageId) } : {}),
      }, this.getConfig().additionalMessageTimeoutMs);
      if (String(result?.turnId || '') !== active.turnId) {
        throw createProtocolError('turn/steer', { code: 'TURN_ID_MISMATCH' });
      }
      return {
        accepted: true,
        commandSummary: {
          operation: 'turn.steer',
          transport: 'app-server-stdio',
        },
      };
    } catch (error) {
      const deliveryError = new Error('Codex did not accept the additional message.');
      deliveryError.code = error?.code || 'CODEX_STEER_FAILED';
      throw deliveryError;
    }
  }

  async runTurn({
    turn,
    session,
    workspace,
    target,
    onEvent,
    onCommand,
    onThreadId,
    onTurnStarted,
    isCancellationRequested,
  }) {
    const command = this.buildCommand({ turn, session, workspace, target });
    const runnerConfig = this.getConfig();
    const completionExitGraceMs = Number.isFinite(runnerConfig.completionExitGraceMs)
      ? Math.max(1, runnerConfig.completionExitGraceMs)
      : 2000;
    const requestTimeoutMs = runnerConfig.additionalMessageTimeoutMs || 15000;
    if (typeof onCommand === 'function') {
      await onCommand(command.commandSummary);
    }

    const startedAt = Date.now();
    const runKey = String(turn._id);
    const stderrChunks = [];
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let codexThreadId = '';
    let codexTurnId = '';
    let finalAssistantMessage = '';
    let usage = null;
    let timedOut = false;
    let cancelled = false;
    let childError = null;
    let terminalTurn = null;
    let childClosed = false;
    let timeoutHandle = null;
    let cancelInterval = null;
    let killTimer = null;
    let interruptFallbackTimer = null;
    let terminalFallbackTimer = null;
    let requestSequence = 0;
    let streamChain = Promise.resolve();
    let pendingStreamTaskCount = 0;
    const pendingRequests = new Map();

    return new Promise((resolve) => {
      let settled = false;
      let finishing = false;
      let child;
      let terminalDeadlineExpired = false;
      let resolveTerminalDeadline;
      const terminalDeadline = new Promise((deadlineResolve) => {
        resolveTerminalDeadline = deadlineResolve;
      });

      const emit = async (event) => {
        if (typeof onEvent === 'function') {
          await onEvent(event);
        }
      };

      const clearRequest = (id) => {
        const pending = pendingRequests.get(String(id));
        if (!pending) {
          return null;
        }
        pendingRequests.delete(String(id));
        clearTimeout(pending.timer);
        return pending;
      };

      const writeMessage = (message) => {
        if (!child?.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
          throw new Error('Codex app server input is unavailable.');
        }
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const sendRequest = (method, params, timeoutMs = requestTimeoutMs) => {
        requestSequence += 1;
        const id = requestSequence;
        return new Promise((requestResolve, requestReject) => {
          const timer = setTimeout(() => {
            const pending = clearRequest(id);
            if (!pending) {
              return;
            }
            const error = new Error(`Codex app server did not respond to ${method}.`);
            error.code = 'CODEX_RPC_TIMEOUT';
            requestReject(error);
          }, timeoutMs);
          if (timer.unref) {
            timer.unref();
          }
          pendingRequests.set(String(id), {
            method,
            reject: requestReject,
            resolve: requestResolve,
            timer,
          });
          try {
            writeMessage({ method, id, params });
          } catch (error) {
            clearRequest(id);
            requestReject(error);
          }
        });
      };

      const sendNotification = (method, params = {}) => {
        writeMessage({ method, params });
      };

      const reportThreadId = async (threadId) => {
        const nextThreadId = String(threadId || '').trim();
        if (!nextThreadId || nextThreadId === codexThreadId) {
          return;
        }
        codexThreadId = nextThreadId;
        if (typeof onThreadId === 'function') {
          await onThreadId(nextThreadId);
        }
      };

      const reportTurnStarted = async (turnId) => {
        const nextTurnId = String(turnId || '').trim();
        if (!nextTurnId) {
          return;
        }
        if (nextTurnId === codexTurnId && this.activeRuns.has(runKey)) {
          return;
        }
        codexTurnId = nextTurnId;
        const active = {
          accepting: true,
          sendRequest,
          threadId: codexThreadId,
          turnId: codexTurnId,
        };
        this.activeRuns.set(runKey, active);
        if (typeof onTurnStarted === 'function') {
          await onTurnStarted({ threadId: codexThreadId, turnId: codexTurnId });
        }
      };

      const captureAssistantMessage = (item) => {
        if (item?.type !== 'agentMessage' || !String(item.text || '').trim()) {
          return;
        }
        const text = String(item.text).trim();
        if (item.phase === 'final_answer' || !finalAssistantMessage || item.phase !== 'commentary') {
          finalAssistantMessage = text;
        }
      };

      const scheduleTerminalFallback = () => {
        if (terminalFallbackTimer || terminalDeadlineExpired) {
          return;
        }
        terminalFallbackTimer = setTimeout(() => {
          terminalFallbackTimer = null;
          terminalDeadlineExpired = true;
          resolveTerminalDeadline();
          finish({
            exitCode: child?.exitCode ?? null,
            exitSignal: child?.signalCode || '',
          }).catch(() => {});
        }, completionExitGraceMs);
      };

      const handleNotification = async (method, params) => {
        if (method === 'thread/started') {
          await reportThreadId(params?.thread?.id);
        }
        if (method === 'turn/started') {
          await reportThreadId(params?.threadId);
          if (!codexTurnId) {
            await reportTurnStarted(params?.turn?.id);
          }
        }
        if (method === 'thread/tokenUsage/updated') {
          const total = params?.tokenUsage?.total;
          if (total && typeof total === 'object') {
            // Preserve Codex's cumulative thread total. The service layer
            // derives per-turn deltas for resumed threads when presenting cost.
            usage = tokenBreakdown(total);
          }
        }
        if (method === 'item/completed') {
          captureAssistantMessage(params?.item);
          if (params?.item?.type === 'userMessage') {
            return;
          }
        }
        if (method === 'item/started' || OPTED_OUT_NOTIFICATION_METHODS.includes(method)) {
          return;
        }
        if (method === 'turn/completed') {
          terminalTurn = params?.turn || {};
          const finalItem = Array.isArray(terminalTurn.items)
            ? terminalTurn.items.findLast((item) => item?.type === 'agentMessage')
            : null;
          captureAssistantMessage(finalItem);
          const active = this.activeRuns.get(runKey);
          if (active) {
            active.accepting = false;
          }
          scheduleTerminalFallback();
        }

        const eventType = eventTypeFromMethod(method);
        const terminalFailed = method === 'turn/completed' && params?.turn?.status === 'failed';
        const eventIsWarning = /(?:error|failed|warning)/i.test(method);
        await emit({
          stream: 'stdout-json',
          eventType,
          payload: normalizeNotificationPayload(method, params),
          text: '',
          severity: terminalFailed ? 'error' : (eventIsWarning ? 'warning' : 'info'),
        });

        if (method === 'turn/completed') {
          setImmediate(() => {
            finish({
              exitCode: child?.exitCode ?? null,
              exitSignal: child?.signalCode || '',
            }).catch(() => {});
          });
        }
      };

      const handleJsonLine = async (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) {
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch (_error) {
          await emit({
            stream: 'stdout',
            eventType: 'stdout.line',
            text: clipText(line, runnerConfig.maxEventTextChars),
            severity: 'info',
          });
          return;
        }

        if (Object.prototype.hasOwnProperty.call(parsed, 'id') && !parsed.method) {
          const pending = clearRequest(parsed.id);
          if (!pending) {
            return;
          }
          if (parsed.error) {
            pending.reject(createProtocolError(pending.method, parsed.error));
          } else {
            pending.resolve(parsed.result || {});
          }
          return;
        }

        if (parsed.method && Object.prototype.hasOwnProperty.call(parsed, 'id')) {
          await emit({
            stream: 'stdout-json',
            eventType: 'app_server.unsupported_request',
            payload: { method: parsed.method },
            text: 'Codex requested an interactive response that this worker does not support.',
            severity: 'warning',
          });
          writeMessage({
            id: parsed.id,
            error: { code: -32601, message: 'Unsupported client request.' },
          });
          return;
        }

        if (parsed.method) {
          await handleNotification(parsed.method, parsed.params || {});
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
        const text = chunk.toString('utf8');
        stderrRemainder += text;
        stderrChunks.push(text);
        const lines = stderrRemainder.split(/\r?\n/);
        stderrRemainder = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            await emit({
              stream: 'stderr',
              eventType: 'stderr.line',
              text: clipText(line, runnerConfig.maxEventTextChars),
              severity: 'warning',
            });
          }
        }
      };

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

      const rejectPendingRequests = () => {
        pendingRequests.forEach((pending) => {
          clearTimeout(pending.timer);
          const error = new Error('Codex app server connection closed.');
          error.code = 'CODEX_RPC_CLOSED';
          pending.reject(error);
        });
        pendingRequests.clear();
      };

      const closeChild = () => {
        if (!child || childClosed) {
          return;
        }
        try {
          if (!child.stdin.destroyed && !child.stdin.writableEnded) {
            child.stdin.end();
          }
        } catch (_error) {
          // The transport may already be closed.
        }
        if (child.exitCode === null && child.signalCode === null && !child.killed) {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL');
            }
          }, 10000);
          if (killTimer.unref) {
            killTimer.unref();
          }
        }
      };

      const drainStream = async () => {
        if (terminalDeadlineExpired) {
          return false;
        }
        const drain = streamChain.then(() => true).catch((error) => {
          childError = childError || error;
          return true;
        });
        if (terminalTurn) {
          return Promise.race([drain, terminalDeadline.then(() => false)]);
        }
        return Promise.race([
          drain,
          new Promise((drainResolve) => {
            const timer = setTimeout(() => drainResolve(false), completionExitGraceMs);
            if (timer.unref) timer.unref();
          }),
        ]);
      };

      const finish = async (result = {}) => {
        if (settled || finishing) {
          return;
        }
        finishing = true;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (cancelInterval) clearInterval(cancelInterval);
        if (terminalFallbackTimer) clearTimeout(terminalFallbackTimer);
        if (killTimer) clearTimeout(killTimer);
        if (interruptFallbackTimer) clearTimeout(interruptFallbackTimer);
        const active = this.activeRuns.get(runKey);
        if (active) active.accepting = false;
        this.activeRuns.delete(runKey);

        const streamDrained = await drainStream();
        if (!streamDrained && terminalTurn) {
          Promise.resolve(logger.warning(
            'Codex event stream did not drain after turn.completed; finalizing from the terminal event',
            {
              category: 'codex_tool',
              metadata: {
                turnId: runKey,
                pendingStreamTaskCount,
                completionExitGraceMs,
              },
            }
          )).catch(() => {});
        }

        rejectPendingRequests();
        closeChild();
        const terminalStatus = terminalTurn?.status || '';
        const status = timedOut
          ? 'timed_out'
          : cancelled || terminalStatus === 'interrupted'
            ? 'cancelled'
            : terminalStatus === 'completed'
              ? 'succeeded'
              : 'failed';
        const stderrText = stderrChunks.join('').trim();
        const terminalError = terminalTurn?.error?.message || '';
        resolve({
          exitCode: result.exitCode ?? child?.exitCode ?? null,
          exitSignal: result.exitSignal || child?.signalCode || '',
          status,
          finalResponse: finalAssistantMessage,
          codexThreadId,
          usage,
          durationMs: Date.now() - startedAt,
          errorMessage: status === 'succeeded'
            ? ''
            : clipText(terminalError || stderrText || childError?.message || '', 1800),
          commandSummary: command.commandSummary,
        });
      };

      const requestInterrupt = (reason) => {
        if (reason === 'timeout') timedOut = true;
        if (reason === 'cancelled') cancelled = true;
        const active = this.activeRuns.get(runKey);
        if (active) active.accepting = false;
        if (codexThreadId && codexTurnId && !childClosed) {
          sendRequest('turn/interrupt', {
            threadId: codexThreadId,
            turnId: codexTurnId,
          }, requestTimeoutMs).catch((error) => {
            childError = childError || error;
            closeChild();
          });
          interruptFallbackTimer = setTimeout(() => {
            closeChild();
            finish({
              exitCode: child?.exitCode ?? null,
              exitSignal: child?.signalCode || '',
            }).catch(() => {});
          }, 10000);
          if (interruptFallbackTimer.unref) {
            interruptFallbackTimer.unref();
          }
          return;
        }
        closeChild();
      };

      try {
        child = spawn(command.binary, command.args, {
          cwd: command.cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        childError = error;
        finish({ exitCode: null, exitSignal: '' }).catch(() => {});
        return;
      }

      timeoutHandle = setTimeout(() => requestInterrupt('timeout'), command.timeoutMs);
      if (timeoutHandle.unref) timeoutHandle.unref();
      cancelInterval = setInterval(async () => {
        if (cancelled || timedOut || terminalTurn) {
          return;
        }
        try {
          if (typeof isCancellationRequested === 'function' && await isCancellationRequested()) {
            requestInterrupt('cancelled');
          }
        } catch (_error) {
          // A failed cancellation poll should not interrupt the Codex process.
        }
      }, 2000);
      if (cancelInterval.unref) cancelInterval.unref();

      child.stdout.on('data', (chunk) => enqueueStreamWork(() => handleStdoutChunk(chunk)));
      child.stderr.on('data', (chunk) => enqueueStreamWork(() => handleStderrChunk(chunk)));
      if (typeof child.stdin.on === 'function') {
        child.stdin.on('error', (error) => {
          childError = childError || error;
        });
      }
      child.on('error', (error) => {
        childError = childError || error;
      });
      child.on('close', (exitCode, signal) => {
        childClosed = true;
        finish({ exitCode, exitSignal: signal || '' }).catch(() => {});
      });

      const startProtocol = async () => {
        await sendRequest('initialize', {
          clientInfo: APP_SERVER_CLIENT_INFO,
          capabilities: {
            optOutNotificationMethods: OPTED_OUT_NOTIFICATION_METHODS,
          },
        });
        sendNotification('initialized');

        const threadParams = {
          cwd: workspace.rootPath,
          approvalPolicy: 'never',
          sandbox: sandboxModeForTurn(turn),
          ...(command.settings.model ? { model: command.settings.model } : {}),
        };
        const isFollowup = String(turn.kind || '').startsWith('followup_');
        const threadResponse = isFollowup
          ? await sendRequest('thread/resume', {
            ...threadParams,
            threadId: String(session?.codexThreadId || ''),
            excludeTurns: true,
          })
          : await sendRequest('thread/start', threadParams);
        await reportThreadId(threadResponse?.thread?.id);
        if (!codexThreadId) {
          throw new Error('Codex app server did not return a thread id.');
        }

        const turnResponse = await sendRequest('turn/start', {
          threadId: codexThreadId,
          input: [{ type: 'text', text: String(turn.prompt || '') }],
          clientUserMessageId: runKey,
          cwd: workspace.rootPath,
          approvalPolicy: 'never',
          ...(command.settings.model ? { model: command.settings.model } : {}),
          ...(command.settings.reasoningEffort ? { effort: command.settings.reasoningEffort } : {}),
        });
        await reportTurnStarted(turnResponse?.turn?.id);
        if (!codexTurnId) {
          throw new Error('Codex app server did not return a turn id.');
        }
      };

      startProtocol().catch((error) => {
        childError = childError || error;
        finish({ exitCode: child?.exitCode ?? null, exitSignal: child?.signalCode || '' })
          .catch(() => {});
      });
    });
  }
}

module.exports = CodexLocalRunner;
