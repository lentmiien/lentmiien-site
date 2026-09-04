const crypto = require('crypto');

const CodexTurn = require('../models/codex_turn');
const PendingRequests = require('../models/pending_requests');
const Role = require('../models/role');
const Useraccount = require('../models/useraccount');
const codexToolService = require('./codexToolService');
const logger = require('../utils/logger');
const {
  CHAT_TOOL_CAPABILITIES,
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/chatToolAuthorizationPolicy');
const {
  createHttpError,
  resolveAuthorizedToolPrincipal,
} = require('./toolExecutionPrincipalService');

const WORKSPACE_IDS = Object.freeze({
  aiGatewayLinux: '773f1818-2313-44b0-93e2-880693129439',
  lentmiienSiteLinux: '3b73bde5-4b30-4731-a0e4-45c4180864f2',
  lentmiienSiteProduction: '4ef51c48-3ecd-4ab1-ba3b-d8fe767f884b',
});

const FIXED_REQUESTS = Object.freeze({
  aiGatewayLinux: Object.freeze({
    workspaceId: WORKSPACE_IDS.aiGatewayLinux,
    mode: 'action',
    permissionMode: 'yolo',
    modelProvider: 'openai',
    requestProfileId: 'high',
    capability: CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite,
  }),
  lentmiienSiteLinux: Object.freeze({
    workspaceId: WORKSPACE_IDS.lentmiienSiteLinux,
    mode: 'action',
    permissionMode: 'yolo',
    modelProvider: 'openai',
    requestProfileId: 'high',
    capability: CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite,
  }),
  lentmiienSiteProduction: Object.freeze({
    workspaceId: WORKSPACE_IDS.lentmiienSiteProduction,
    mode: 'question',
    permissionMode: 'read-only',
    modelProvider: 'openai',
    requestProfileId: 'high',
    capability: CHAT_TOOL_CAPABILITIES.codexReadOnly,
  }),
});

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'blocked']);
const VALID_MODES = new Set(['question', 'action', 'git_commit_push']);
const VALID_PERMISSION_MODES = new Set(['auto', 'read-only', 'workspace-write', 'yolo']);
const VALID_MODEL_PROVIDERS = new Set(['openai', 'ollama', 'runpod-qwen', 'runpod-glm']);
const MAX_PROMPT_CHARS = 20000;
const MAX_FINAL_RESPONSE_CHARS = 100000;
const DEFAULT_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function getRuntimeConfig(env = process.env) {
  return {
    waitTimeoutMs: positiveInteger(
      env.CODEX_CHAT_TOOL_WAIT_TIMEOUT_MS,
      DEFAULT_WAIT_TIMEOUT_MS,
      30 * 1000,
      48 * 60 * 60 * 1000
    ),
    pollIntervalMs: positiveInteger(
      env.CODEX_CHAT_TOOL_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      250,
      10000
    ),
  };
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, milliseconds);
    handle.unref?.();
  });
}

function queryResult(query) {
  let current = query;
  if (current && typeof current.lean === 'function') current = current.lean();
  if (current && typeof current.exec === 'function') return current.exec();
  return current;
}

function assertArgumentsObject(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw createHttpError(400, 'Tool arguments must be an object.');
  }
}

function assertAllowedKeys(args, allowedKeys) {
  const allowed = new Set(allowedKeys);
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    throw createHttpError(400, 'The Codex tool request contains unsupported fields.');
  }
}

function normalizeRequiredString(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw createHttpError(400, `${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) throw createHttpError(400, `${label} is required.`);
  if (normalized.includes('\0')) {
    throw createHttpError(400, `${label} contains an unsupported character.`);
  }
  if (normalized.length > maxLength) {
    throw createHttpError(400, `${label} is too long. Maximum length is ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeOptionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw createHttpError(400, `${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw createHttpError(400, `${label} is too long.`);
  }
  return normalized;
}

function normalizeEnum(value, label, allowedValues) {
  const normalized = normalizeRequiredString(value, label, 80).toLowerCase();
  if (!allowedValues.has(normalized)) {
    throw createHttpError(400, `${label} is not supported.`);
  }
  return normalized;
}

function normalizeFixedArguments(args) {
  assertArgumentsObject(args);
  assertAllowedKeys(args, ['prompt']);
  return {
    prompt: normalizeRequiredString(args.prompt, 'Prompt', MAX_PROMPT_CHARS),
  };
}

function normalizeGeneralArguments(args) {
  assertArgumentsObject(args);
  assertAllowedKeys(args, [
    'workspace_id',
    'prompt',
    'model_provider',
    'mode',
    'permission_mode',
    'request_profile_id',
    'model',
  ]);
  return {
    workspaceId: normalizeRequiredString(args.workspace_id, 'Workspace id', 160),
    prompt: normalizeRequiredString(args.prompt, 'Prompt', MAX_PROMPT_CHARS),
    modelProvider: normalizeEnum(args.model_provider, 'Model provider', VALID_MODEL_PROVIDERS),
    mode: normalizeEnum(args.mode, 'Mode', VALID_MODES),
    permissionMode: normalizeEnum(args.permission_mode, 'Permission mode', VALID_PERMISSION_MODES),
    requestProfileId: normalizeOptionalString(args.request_profile_id, 'Request profile id', 80),
    model: normalizeOptionalString(args.model, 'Model', 120),
  };
}

function buildDurableResourceIds(context = {}, toolName = '') {
  const conversationId = String(context.conversationId || '').trim().slice(0, 160);
  const responseId = String(context.responseId || '').trim().slice(0, 240);
  const callId = String(context.callId || context.toolCallId || '').trim().slice(0, 240);
  const nonce = responseId || callId || crypto.randomUUID();
  const digest = crypto.createHash('sha256')
    .update(['codex-chat-tool', toolName, conversationId, responseId, callId, nonce].join('\n'))
    .digest('hex');
  return {
    sessionId: `tool-session-${digest}`,
    turnId: `tool-turn-${digest}`,
  };
}

function clipFinalResponse(value) {
  const response = String(value || '');
  if (response.length <= MAX_FINAL_RESPONSE_CHARS) {
    return { response, truncated: false };
  }
  return {
    response: `${response.slice(0, MAX_FINAL_RESPONSE_CHARS)}\n\n[Response truncated by the chat tool. Open the Codex turn for the complete response.]`,
    truncated: true,
  };
}

function serializeCompletedTurn(turn) {
  const final = clipFinalResponse(turn.finalResponse);
  const sessionId = String(turn.sessionId || '');
  const turnId = String(turn._id || turn.id || '');
  return {
    status: turn.status || 'failed',
    final_response: final.response,
    response_truncated: final.truncated,
    error: turn.errorMessage || '',
    session_id: sessionId,
    turn_id: turnId,
    session_url: `/codex/sessions/${encodeURIComponent(sessionId)}`,
    turn_url: `/codex/turns/${encodeURIComponent(turnId)}`,
    completed_at: turn.completedAt || null,
  };
}

class CodexChatToolService {
  constructor({
    service = codexToolService,
    turnModel = CodexTurn,
    pendingModel = PendingRequests,
    roleModel = Role,
    userModel = Useraccount,
    appLogger = logger,
    sleep = sleepFor,
    now = () => new Date(),
    env = process.env,
  } = {}) {
    this.service = service;
    this.turnModel = turnModel;
    this.pendingModel = pendingModel;
    this.roleModel = roleModel;
    this.userModel = userModel;
    this.logger = appLogger;
    this.sleep = sleep;
    this.now = now;
    this.config = getRuntimeConfig(env);
  }

  async authorize(context, capability) {
    return resolveAuthorizedToolPrincipal(context, capability, {
      userModel: this.userModel,
      roleModel: this.roleModel,
      roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
      appLogger: this.logger,
    });
  }

  async heartbeatPendingResponse(responseId) {
    if (!responseId || !this.pendingModel || typeof this.pendingModel.updateOne !== 'function') return;
    await this.pendingModel.updateOne(
      { response_id: responseId, recoveryState: 'pending' },
      { $set: { processingStartedAt: this.now() } }
    );
  }

  async waitForTurn(turnId, context = {}) {
    const deadline = this.now().getTime() + this.config.waitTimeoutMs;
    while (this.now().getTime() < deadline) {
      const turn = await queryResult(this.turnModel.findById(turnId));
      if (!turn) {
        throw createHttpError(500, 'The queued Codex turn could not be found.');
      }
      if (TERMINAL_STATUSES.has(turn.status)) {
        return serializeCompletedTurn(turn);
      }
      await this.heartbeatPendingResponse(String(context.responseId || ''));
      await this.sleep(Math.min(this.config.pollIntervalMs, Math.max(1, deadline - this.now().getTime())));
    }

    const turn = await queryResult(this.turnModel.findById(turnId));
    if (turn && TERMINAL_STATUSES.has(turn.status)) {
      return serializeCompletedTurn(turn);
    }
    const sessionId = String(turn?.sessionId || '');
    return {
      status: turn?.status || 'unknown',
      final_response: '',
      response_truncated: false,
      error: 'Codex did not finish before the chat tool wait limit expired.',
      session_id: sessionId,
      turn_id: turnId,
      session_url: sessionId ? `/codex/sessions/${encodeURIComponent(sessionId)}` : '',
      turn_url: `/codex/turns/${encodeURIComponent(turnId)}`,
      completed_at: null,
    };
  }

  async startAndWait(payload, context, capability) {
    const requiredCapabilities = [capability];
    if (payload.permissionMode === 'yolo' || payload.mode === 'git_commit_push') {
      requiredCapabilities.push(CHAT_TOOL_CAPABILITIES.codexYolo);
    }
    const principal = await this.authorize(context, requiredCapabilities);
    const toolName = String(context.toolName || 'run_codex_in_workspace').trim().slice(0, 64);
    const resourceIds = buildDurableResourceIds(context, toolName);
    const result = await this.service.createSession({
      ...payload,
      confirmYolo: payload.permissionMode === 'yolo',
    }, principal, resourceIds);
    return this.waitForTurn(result.turn.id, context);
  }

  async runFixed(args, context, fixedRequest) {
    const normalized = normalizeFixedArguments(args);
    const { capability, ...request } = fixedRequest;
    return this.startAndWait({
      ...request,
      prompt: normalized.prompt,
    }, context, capability);
  }

  runAiGatewayLinux(args, context = {}) {
    return this.runFixed(args, context, FIXED_REQUESTS.aiGatewayLinux);
  }

  runLentmiienSiteLinux(args, context = {}) {
    return this.runFixed(args, context, FIXED_REQUESTS.lentmiienSiteLinux);
  }

  runLentmiienSiteProduction(args, context = {}) {
    return this.runFixed(args, context, FIXED_REQUESTS.lentmiienSiteProduction);
  }

  async fetchRequestOptions(args, context = {}) {
    assertArgumentsObject(args);
    assertAllowedKeys(args, []);
    const principal = await this.authorize(context, CHAT_TOOL_CAPABILITIES.codexReadOnly);
    const [workspaces, profiles, config] = await Promise.all([
      this.service.listWorkspaces(),
      this.service.listRequestProfiles(),
      this.service.publicConfig({ user: principal }),
    ]);
    return {
      instruction: 'Choose only values returned here, then call run_codex_in_workspace.',
      workspaces: workspaces.filter((workspace) => workspace.target?.enabled).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        target: workspace.target ? {
          name: workspace.target.name,
          type: workspace.target.type,
          platform: workspace.target.platform,
        } : null,
        default_question_permission: workspace.defaultQuestionPermission,
        default_action_permission: workspace.defaultActionPermission,
        allows_yolo: Boolean(workspace.allowYolo && config.yoloEnabled),
      })),
      model_providers: config.modelProviderOptions,
      openai_profiles: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        model: profile.model,
        reasoning_effort: profile.reasoningEffort,
        codex_profile: profile.codexProfile,
      })),
      local_models: config.localModelOptions,
      modes: [
        { value: 'question', description: 'Investigate or answer without requesting edits.' },
        { value: 'action', description: 'Implement or otherwise change the selected workspace.' },
        { value: 'git_commit_push', description: 'Commit and push existing changes; forces yolo mode.' },
      ],
      permission_modes: [
        { value: 'auto', enabled: true },
        { value: 'read-only', enabled: true },
        { value: 'workspace-write', enabled: true },
        { value: 'yolo', enabled: Boolean(config.yoloEnabled) },
      ],
      max_prompt_characters: Math.min(Number(config.maxPromptChars) || MAX_PROMPT_CHARS, MAX_PROMPT_CHARS),
    };
  }

  async runInWorkspace(args, context = {}) {
    const normalized = normalizeGeneralArguments(args);
    const capability = normalized.permissionMode === 'read-only' && normalized.mode === 'question'
      ? CHAT_TOOL_CAPABILITIES.codexReadOnly
      : CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite;
    return this.startAndWait(normalized, context, capability);
  }
}

CodexChatToolService.FIXED_REQUESTS = FIXED_REQUESTS;
CodexChatToolService.WORKSPACE_IDS = WORKSPACE_IDS;
CodexChatToolService.buildDurableResourceIds = buildDurableResourceIds;
CodexChatToolService.getRuntimeConfig = getRuntimeConfig;
CodexChatToolService.normalizeGeneralArguments = normalizeGeneralArguments;
CodexChatToolService.serializeCompletedTurn = serializeCompletedTurn;

module.exports = CodexChatToolService;
