const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const CodexExecutionTarget = require('../models/codex_execution_target');
const CodexWorkspace = require('../models/codex_workspace');
const CodexSession = require('../models/codex_session');
const CodexTurn = require('../models/codex_turn');
const CodexEvent = require('../models/codex_event');
const CodexTurnMessage = require('../models/codex_turn_message');
const CodexWorkspaceLock = require('../models/codex_workspace_lock');
const CodexTokenPrice = require('../models/codex_token_price');
const CodexRequestProfile = require('../models/codex_request_profile');
const CodexPromptTemplate = require('../models/codex_prompt_template');
const RunpodPod = require('../models/runpod_pod');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const {
  CODEX_CAPABILITIES,
  CODEX_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/codexAuthorizationPolicy');
const {
  APP_SETTING_KEYS,
  appSettingsService,
} = require('./appSettingsService');
const {
  buildRemoteShellCommand,
  buildSshArgs,
  getSshBinary,
  quotePosixShellArg,
} = require('./codexSsh');

const execFileAsync = promisify(execFile);

const TERMINAL_TURN_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'blocked']);
const ACTIVE_TURN_STATUSES = ['queued', 'running'];
const VALID_MODES = new Set(['question', 'action', 'git_commit_push']);
const VALID_PERMISSION_MODES = new Set(['read-only', 'workspace-write', 'yolo']);
const CODEX_THREAD_INDEX_NAME = 'codexThreadId_1';
const WORKSPACE_LOCK_INDEX_NAME = 'workspaceId_1';
const WORKSPACE_LOCK_TTL_INDEX_NAME = 'expiresAt_1';
const DEFAULT_TOKEN_PRICE_ID = 'default';
const OLLAMA_TOKEN_PRICE_ID = 'ollama';
const TOKEN_TYPES = ['input', 'cached', 'output', 'reasoning'];
const MODEL_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  OLLAMA: 'ollama',
  RUNPOD_QWEN: 'runpod-qwen',
  RUNPOD_GLM: 'runpod-glm',
});
const USAGE_MODEL_PROVIDERS = Object.freeze([
  MODEL_PROVIDERS.OPENAI,
  MODEL_PROVIDERS.OLLAMA,
]);
const MODEL_PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({
    value: MODEL_PROVIDERS.OPENAI,
    label: 'OpenAI',
    description: 'OpenAI-backed Codex profiles.',
    controlMode: 'openai-profile',
    usageProvider: MODEL_PROVIDERS.OPENAI,
  }),
  Object.freeze({
    value: MODEL_PROVIDERS.OLLAMA,
    label: 'Ollama (local)',
    description: 'Local Ollama models on the Codex machine; reserves the AI Gateway GPU while active.',
    controlMode: 'local-model',
    usageProvider: MODEL_PROVIDERS.OLLAMA,
  }),
  Object.freeze({
    value: MODEL_PROVIDERS.RUNPOD_QWEN,
    label: 'Qwen (Runpod)',
    description: 'Runpod Qwen through the lentmiien-qwen Codex profile.',
    controlMode: 'fixed-profile',
    usageProvider: MODEL_PROVIDERS.OLLAMA,
    codexProfile: 'lentmiien-qwen',
    podName: 'ollama-qwen',
  }),
  Object.freeze({
    value: MODEL_PROVIDERS.RUNPOD_GLM,
    label: 'GLM-5.3 Flash (Runpod)',
    description: 'Runpod GLM-5.3 Flash through the lentmiien-glm Codex profile.',
    controlMode: 'fixed-profile',
    usageProvider: MODEL_PROVIDERS.OLLAMA,
    codexProfile: 'lentmiien-glm',
    podName: 'glm53-flash',
  }),
]);
const MODEL_PROVIDER_DEFINITION_BY_VALUE = new Map(
  MODEL_PROVIDER_DEFINITIONS.map((definition) => [definition.value, definition])
);
const RUNPOD_MODEL_PROVIDER_DEFINITIONS = MODEL_PROVIDER_DEFINITIONS.filter(
  (definition) => Boolean(definition.podName)
);
const VALID_MODEL_PROVIDERS = new Set(Object.values(MODEL_PROVIDERS));
const CODEX_MODEL_OPTIONS = [
  {
    value: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    description: 'Latest frontier agentic coding model for hardest coding, research, and architecture work.',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    description: 'Balanced agentic coding model for everyday implementation, review, and debugging.',
  },
  {
    value: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Fast and affordable agentic coding model for small changes, quick answers, and mechanical edits.',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'Previous frontier model for complex coding, research, and real-world work.',
  },
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong model for everyday coding.',
  },
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
  },
  {
    value: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3 Codex Spark',
    description: 'Ultra-fast coding model for near-instant iteration.',
  },
];
const KNOWN_LOCAL_MODEL_OPTIONS = [
  {
    value: 'qwen3.6:27b',
    label: 'Qwen 3.6 27B',
    description: 'Local Ollama model running on the Codex machine.',
  },
];
const REASONING_EFFORT_OPTIONS = [
  {
    value: 'low',
    label: 'Low',
    description: 'Fast responses with lighter reasoning.',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balances speed and reasoning depth for everyday tasks.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Greater reasoning depth for complex problems.',
  },
  {
    value: 'xhigh',
    label: 'Extra high',
    description: 'Extra high reasoning depth for complex problems.',
  },
  {
    value: 'max',
    label: 'Max',
    description: 'Maximum reasoning depth for the hardest problems.',
  },
  {
    value: 'ultra',
    label: 'Ultra',
    description: 'Maximum reasoning with automatic task delegation.',
  },
];
const VALID_REASONING_EFFORTS = new Set(['', ...REASONING_EFFORT_OPTIONS.map((option) => option.value)]);
const DEFAULT_REQUEST_PROFILES = [
  {
    _id: 'default',
    name: 'Default',
    description: 'Use the target machine Codex defaults.',
    model: '',
    codexProfile: '',
    reasoningEffort: '',
    sortOrder: 0,
  },
  {
    _id: 'max',
    name: 'Max',
    description: 'Frontier model with Ultra reasoning for the hardest delegated coding work.',
    model: 'gpt-5.6-sol',
    codexProfile: '',
    reasoningEffort: 'ultra',
    sortOrder: 10,
  },
  {
    _id: 'high',
    name: 'High',
    description: 'Frontier model with Max reasoning for hard single-agent work.',
    model: 'gpt-5.6-sol',
    codexProfile: '',
    reasoningEffort: 'max',
    sortOrder: 20,
  },
  {
    _id: 'normal',
    name: 'Normal',
    description: 'Balanced 5.6 model with medium reasoning for everyday implementation.',
    model: 'gpt-5.6-terra',
    codexProfile: '',
    reasoningEffort: 'medium',
    sortOrder: 30,
  },
  {
    _id: 'low',
    name: 'Low',
    description: 'Balanced 5.6 model with low reasoning for scoped work.',
    model: 'gpt-5.6-terra',
    codexProfile: '',
    reasoningEffort: 'low',
    sortOrder: 40,
  },
  {
    _id: 'fast',
    name: 'Fast',
    description: 'Fast 5.6 model with low reasoning for small changes and quick answers.',
    model: 'gpt-5.6-luna',
    codexProfile: '',
    reasoningEffort: 'low',
    sortOrder: 50,
  },
  {
    _id: 'fastest',
    name: 'Fastest',
    description: 'Ultra-fast model for the smallest coding iteration loops.',
    model: 'gpt-5.3-codex-spark',
    codexProfile: '',
    reasoningEffort: 'low',
    sortOrder: 60,
  },
];
const TERMINAL_STATUS_LABELS = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};
const KIND_LABELS = {
  question: 'Question',
  action: 'Action',
  followup_question: 'Follow-up question',
  followup_action: 'Follow-up action',
};
const ACTION_MODE_TYPES = new Set(['action', 'git_commit_push']);
const COMMIT_PUSH_MODE = 'git_commit_push';
const COMMIT_PUSH_KIND = 'action';
const COMMIT_PUSH_DEFAULT_PROFILE_ID = 'fastest';

let defaultDataPromise = null;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getPositiveIntegerEnv(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number.parseInt(process.env[name], 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function getBooleanEnv(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
}

function normalizeModelProvider(value, fallback = MODEL_PROVIDERS.OPENAI) {
  const provider = String(value || fallback).trim().toLowerCase();
  if (!VALID_MODEL_PROVIDERS.has(provider)) {
    throw createHttpError(400, 'Selected model provider is not supported.');
  }
  return provider;
}

function getModelProviderDefinition(providerInput) {
  const provider = normalizeModelProvider(providerInput);
  return MODEL_PROVIDER_DEFINITION_BY_VALUE.get(provider);
}

function isRunpodModelProvider(providerInput) {
  const definition = getModelProviderDefinition(providerInput);
  return Boolean(definition && definition.podName);
}

function getUsageModelProvider(providerInput) {
  return getModelProviderDefinition(providerInput).usageProvider;
}

function getModelProviderLabel(providerInput) {
  return getModelProviderDefinition(providerInput).label;
}

function getModelProviderCodexProfile(providerInput) {
  return getModelProviderDefinition(providerInput).codexProfile || '';
}

function modelProviderNeedsProfileEnvironment(providerInput) {
  return isRunpodModelProvider(providerInput);
}

async function canUseRunpodModelProviders(user) {
  return hasCapabilities(user, [CODEX_CAPABILITIES.runpodModelRun], {
    roleModel: Role,
    roleCapabilityBundles: CODEX_ROLE_CAPABILITY_BUNDLES,
  });
}

async function canSteerCodexTurns(user) {
  return hasCapabilities(user, [CODEX_CAPABILITIES.turnSteer], {
    roleModel: Role,
    roleCapabilityBundles: CODEX_ROLE_CAPABILITY_BUNDLES,
  });
}

function getPrincipalId(user) {
  return normalizeOptionalString(user && (user._id || user.id), 160);
}

function canAccessTurnForSteering(turn, user) {
  if (!turn || !user) {
    return false;
  }
  if (user.type_user === 'admin') {
    return true;
  }
  const principalId = getPrincipalId(user);
  const ownerId = normalizeOptionalString(turn.createdBy && turn.createdBy.id, 160);
  return Boolean(principalId && ownerId && principalId === ownerId);
}

async function canSteerTurn(turn, user) {
  return Boolean(
    await canSteerCodexTurns(user) &&
    canAccessTurnForSteering(turn, user)
  );
}

async function assertCanSteerCodexTurns(user) {
  let allowed = false;
  try {
    allowed = await canSteerCodexTurns(user);
  } catch (error) {
    logger.error('Codex turn steering authorization failed', {
      category: 'authorization',
      metadata: { errorName: error?.name || 'Error' },
    });
    throw createHttpError(503, 'Codex message authorization is temporarily unavailable.');
  }
  if (!allowed) {
    throw createHttpError(403, 'You do not have permission to add messages to Codex turns.');
  }
}

function buildSteerTurnScope(turnId, user) {
  const query = { _id: turnId };
  if (user && user.type_user === 'admin') {
    return query;
  }
  const principalId = getPrincipalId(user);
  if (!principalId) {
    throw createHttpError(403, 'Your account cannot add messages to Codex turns.');
  }
  query['createdBy.id'] = principalId;
  return query;
}

async function getRunningRunpodPodNames() {
  const podNames = RUNPOD_MODEL_PROVIDER_DEFINITIONS.map((definition) => definition.podName);
  const pods = await RunpodPod.find({
    name: { $in: podNames },
    providerStatus: 'RUNNING',
    lifecycleGroup: 'running',
    archivedAt: null,
  }).lean().exec();
  return new Set(pods.map((pod) => String(pod && pod.name || '').trim()));
}

function serializeModelProviderOption(definition) {
  return {
    value: definition.value,
    label: definition.label,
    description: definition.description,
    controlMode: definition.controlMode,
  };
}

async function getAvailableModelProviderOptions({ user, localModelOptions = [] } = {}) {
  const options = [MODEL_PROVIDER_DEFINITION_BY_VALUE.get(MODEL_PROVIDERS.OPENAI)];
  if (localModelOptions.length) {
    options.push(MODEL_PROVIDER_DEFINITION_BY_VALUE.get(MODEL_PROVIDERS.OLLAMA));
  }
  let authorized = false;
  try {
    authorized = await canUseRunpodModelProviders(user);
  } catch (error) {
    logger.error('Codex Runpod model capability lookup failed', {
      category: 'authorization',
      metadata: { errorName: error?.name || 'Error' },
    });
  }
  if (!authorized) {
    return options.map(serializeModelProviderOption);
  }

  let runningPodNames;
  try {
    runningPodNames = await getRunningRunpodPodNames();
  } catch (error) {
    logger.error('Codex Runpod model availability lookup failed', {
      category: 'codex_tool',
      metadata: { errorName: error?.name || 'Error' },
    });
    return options.map(serializeModelProviderOption);
  }
  RUNPOD_MODEL_PROVIDER_DEFINITIONS.forEach((definition) => {
    if (runningPodNames.has(definition.podName)) {
      options.push(definition);
    }
  });
  return options.map(serializeModelProviderOption);
}

async function assertRunpodModelProviderAuthorized(providerInput, user) {
  if (!isRunpodModelProvider(providerInput)) {
    return;
  }
  let allowed;
  try {
    allowed = await canUseRunpodModelProviders(user);
  } catch (error) {
    logger.error('Codex Runpod model authorization failed', {
      category: 'authorization',
      metadata: { errorName: error?.name || 'Error' },
    });
    throw createHttpError(503, 'Runpod model authorization is temporarily unavailable.');
  }
  if (!allowed) {
    throw createHttpError(403, 'You do not have permission to use Runpod-backed Codex models.');
  }
}

async function assertModelProviderAvailable(providerInput) {
  const definition = getModelProviderDefinition(providerInput);
  if (!definition.podName) {
    return definition;
  }
  let runningPodNames;
  try {
    runningPodNames = await getRunningRunpodPodNames();
  } catch (error) {
    logger.error('Codex Runpod model availability verification failed', {
      category: 'codex_tool',
      metadata: { errorName: error?.name || 'Error' },
    });
    throw createHttpError(503, 'Runpod model availability could not be verified. Please try again.');
  }
  if (!runningPodNames.has(definition.podName)) {
    throw createHttpError(409, `${definition.label} is unavailable because its Runpod pod is not running.`);
  }
  return definition;
}

function normalizeLocalModelOption(entry) {
  const source = typeof entry === 'string' ? { value: entry } : entry;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  const value = String(source.value || source.model || '').trim().slice(0, 120);
  if (!value) {
    return null;
  }
  return {
    value,
    label: String(source.label || value).trim().slice(0, 120) || value,
    description: String(source.description || 'Local Ollama model.').trim().slice(0, 500),
  };
}

function parseLocalModelOptions(rawValue) {
  const knownOptionsByValue = new Map(
    KNOWN_LOCAL_MODEL_OPTIONS.map((option) => [option.value, option])
  );
  const byValue = new Map();
  String(rawValue || '').split(',')
    .map(normalizeLocalModelOption)
    .filter(Boolean)
    .forEach((option) => {
      byValue.set(option.value, knownOptionsByValue.get(option.value) || option);
    });
  return Array.from(byValue.values());
}

async function getLocalModelOptions() {
  const rawValue = await appSettingsService.getValue(APP_SETTING_KEYS.CODEX_LOCAL_MODELS);
  const options = parseLocalModelOptions(rawValue);
  if (!options.length) {
    throw createHttpError(
      500,
      `App setting "${APP_SETTING_KEYS.CODEX_LOCAL_MODELS}" must contain at least one comma-separated Ollama model.`
    );
  }
  return options;
}

function normalizeLocalModel(value, fallback = '', localModels = []) {
  const model = String(value || fallback).trim().slice(0, 120);
  const selectedModel = model || localModels[0]?.value || '';
  if (!selectedModel || !localModels.some((option) => option.value === selectedModel)) {
    throw createHttpError(400, 'Selected local model is not configured for the Codex tool.');
  }
  return selectedModel;
}

function getTurnModelProvider(turn) {
  const provider = String(turn && turn.modelProvider || '').trim().toLowerCase();
  return VALID_MODEL_PROVIDERS.has(provider) ? provider : MODEL_PROVIDERS.OPENAI;
}

function getFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return number;
}

function getNonNegativeNumber(value, fallback = 0) {
  return Math.max(0, getFiniteNumber(value, fallback));
}

function getPathValue(source, pathExpression) {
  return String(pathExpression || '').split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return current[part];
  }, source);
}

function firstNonNegativeNumber(source, pathExpressions) {
  for (const pathExpression of pathExpressions) {
    const value = getPathValue(source, pathExpression);
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return Math.round(number);
    }
  }
  return 0;
}

function zeroTokenUsage() {
  return TOKEN_TYPES.reduce((tokens, type) => {
    tokens[type] = 0;
    return tokens;
  }, { total: 0 });
}

function normalizeTokenUsage(usage = {}) {
  if (!usage || typeof usage !== 'object') {
    return zeroTokenUsage();
  }

  const input = firstNonNegativeNumber(usage, [
    'input_tokens',
    'prompt_tokens',
    'input',
    'prompt',
    'tokens.input',
    'tokens.prompt',
  ]);
  const cached = firstNonNegativeNumber(usage, [
    'cached',
    'cached_tokens',
    'cached_input_tokens',
    'input_cached_tokens',
    'prompt_cached_tokens',
    'input_tokens_details.cached_tokens',
    'prompt_tokens_details.cached_tokens',
    'cache_read_input_tokens',
  ]);
  const output = firstNonNegativeNumber(usage, [
    'output_tokens',
    'completion_tokens',
    'output',
    'completion',
    'tokens.output',
    'tokens.completion',
  ]);
  const reasoning = firstNonNegativeNumber(usage, [
    'reasoning',
    'reasoning_tokens',
    'reasoning_output_tokens',
    'output_reasoning_tokens',
    'completion_reasoning_tokens',
    'output_tokens_details.reasoning_tokens',
    'completion_tokens_details.reasoning_tokens',
    'reasoning.output_tokens',
    'tokens.reasoning',
  ]);
  const providedTotal = firstNonNegativeNumber(usage, [
    'total_tokens',
    'total',
    'tokens.total',
  ]);

  return {
    input,
    cached,
    output,
    reasoning,
    total: providedTotal || (Math.max(input, cached) + Math.max(output, reasoning)),
  };
}

function subtractTokenUsage(currentInput, previousInput) {
  const current = normalizeTokenUsage(currentInput);
  const previous = normalizeTokenUsage(previousInput);
  const tokens = TOKEN_TYPES.reduce((result, type) => {
    result[type] = Math.max(0, current[type] - previous[type]);
    return result;
  }, {});
  tokens.total = Math.max(0, current.total - previous.total);
  return tokens;
}

function hasRecordedTokenUsage(usageInput) {
  const usage = normalizeTokenUsage(usageInput);
  return usage.total > 0 || TOKEN_TYPES.some((type) => usage[type] > 0);
}

function shouldDeriveTurnUsageDelta(turn, previousUsage) {
  if (!turn || !previousUsage) {
    return false;
  }
  const sequence = Number(turn.sequence);
  if (!Number.isFinite(sequence) || sequence <= 1) {
    return false;
  }
  if (turn.commandSummary && turn.commandSummary.resume === true) {
    return true;
  }
  return String(turn.kind || '').startsWith('followup_');
}

function compareIndexedTurns(left, right) {
  const leftTurn = left.turn || {};
  const rightTurn = right.turn || {};
  const sessionCompare = String(leftTurn.sessionId || '').localeCompare(String(rightTurn.sessionId || ''));
  if (sessionCompare !== 0) {
    return sessionCompare;
  }

  const leftSequence = Number(leftTurn.sequence) || 0;
  const rightSequence = Number(rightTurn.sequence) || 0;
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  const leftDate = new Date(leftTurn.startedAt || leftTurn.queuedAt || leftTurn.createdAt || 0).getTime() || 0;
  const rightDate = new Date(rightTurn.startedAt || rightTurn.queuedAt || rightTurn.createdAt || 0).getTime() || 0;
  if (leftDate !== rightDate) {
    return leftDate - rightDate;
  }

  return left.index - right.index;
}

function annotateTurnsWithTokenUsage(turns = []) {
  if (!Array.isArray(turns) || !turns.length) {
    return [];
  }

  const annotations = new Map();
  const previousUsageBySession = new Map();
  turns
    .map((turn, index) => ({ turn, index }))
    .sort(compareIndexedTurns)
    .forEach(({ turn, index }) => {
      const sessionId = String(turn && turn.sessionId ? turn.sessionId : '');
      const provider = getTurnModelProvider(turn);
      const usageKey = `${sessionId}:${provider}`;
      const sessionTokenUsage = normalizeTokenUsage(turn && turn.usage ? turn.usage : {});
      const previousUsage = previousUsageBySession.get(usageKey);
      const tokenUsage = shouldDeriveTurnUsageDelta(turn, previousUsage)
        ? subtractTokenUsage(sessionTokenUsage, previousUsage)
        : sessionTokenUsage;

      annotations.set(index, { tokenUsage, sessionTokenUsage });
      if (hasRecordedTokenUsage(sessionTokenUsage)) {
        previousUsageBySession.set(usageKey, sessionTokenUsage);
      }
    });

  return turns.map((turn, index) => ({
    ...turn,
    ...(annotations.get(index) || {}),
  }));
}

function getTurnTokenUsage(turn) {
  if (turn && Object.prototype.hasOwnProperty.call(turn, 'tokenUsage')) {
    return normalizeTokenUsage(turn.tokenUsage);
  }
  return normalizeTokenUsage(turn && turn.usage ? turn.usage : {});
}

function addTokenUsage(target, usage) {
  const normalized = normalizeTokenUsage(usage);
  TOKEN_TYPES.forEach((type) => {
    target[type] = (target[type] || 0) + normalized[type];
  });
  target.total = (target.total || 0) + normalized.total;
  return target;
}

function getTokenPriceId(provider) {
  return getUsageModelProvider(provider) === MODEL_PROVIDERS.OLLAMA
    ? OLLAMA_TOKEN_PRICE_ID
    : DEFAULT_TOKEN_PRICE_ID;
}

function serializeTokenPricing(pricing, providerInput = MODEL_PROVIDERS.OPENAI) {
  const provider = getUsageModelProvider(providerInput);
  const prices = pricing && pricing.prices ? pricing.prices : {};
  return {
    id: pricing && pricing._id ? String(pricing._id) : getTokenPriceId(provider),
    provider,
    currency: pricing && pricing.currency ? String(pricing.currency) : 'USD',
    unitTokens: Math.max(1, Number(pricing && pricing.unitTokens) || 1000000),
    prices: TOKEN_TYPES.reduce((result, type) => {
      result[type] = getNonNegativeNumber(prices[type], 0);
      return result;
    }, {}),
    updatedBy: pricing && pricing.updatedBy ? pricing.updatedBy : {},
    updatedAt: pricing && pricing.updatedAt ? pricing.updatedAt : null,
    createdAt: pricing && pricing.createdAt ? pricing.createdAt : null,
  };
}

function normalizeTokenPricingPayload(payload = {}) {
  const source = payload.prices && typeof payload.prices === 'object' ? payload.prices : payload;
  const prices = {};
  TOKEN_TYPES.forEach((type) => {
    const number = Number(source[type]);
    if (!Number.isFinite(number) || number < 0) {
      throw createHttpError(400, `Token price for ${type} must be a non-negative number.`);
    }
    prices[type] = number;
  });
  return {
    currency: 'USD',
    unitTokens: 1000000,
    prices,
  };
}

function estimateTokenCost(tokensInput, pricingInput) {
  const tokens = normalizeTokenUsage(tokensInput);
  const provider = pricingInput && pricingInput.provider
    ? getUsageModelProvider(pricingInput.provider)
    : MODEL_PROVIDERS.OPENAI;
  const pricing = serializeTokenPricing(pricingInput, provider);
  const unitTokens = pricing.unitTokens || 1000000;
  const billableTokens = {
    input: Math.max(tokens.input - tokens.cached, 0),
    cached: tokens.cached,
    output: Math.max(tokens.output - tokens.reasoning, 0),
    reasoning: tokens.reasoning,
  };
  const breakdown = TOKEN_TYPES.reduce((result, type) => {
    result[type] = (billableTokens[type] * (pricing.prices[type] || 0)) / unitTokens;
    return result;
  }, {});
  const total = TOKEN_TYPES.reduce((sum, type) => sum + breakdown[type], 0);
  return {
    provider,
    currency: pricing.currency,
    unitTokens,
    billableTokens,
    breakdown,
    total,
  };
}

function serializePricingByProvider(pricingInput = {}) {
  const hasProviderMap = pricingInput && (
    Object.prototype.hasOwnProperty.call(pricingInput, MODEL_PROVIDERS.OPENAI) ||
    Object.prototype.hasOwnProperty.call(pricingInput, MODEL_PROVIDERS.OLLAMA)
  );
  const openaiPricing = hasProviderMap ? pricingInput[MODEL_PROVIDERS.OPENAI] : pricingInput;
  const ollamaPricing = hasProviderMap ? pricingInput[MODEL_PROVIDERS.OLLAMA] : null;
  return {
    [MODEL_PROVIDERS.OPENAI]: serializeTokenPricing(openaiPricing, MODEL_PROVIDERS.OPENAI),
    [MODEL_PROVIDERS.OLLAMA]: serializeTokenPricing(ollamaPricing, MODEL_PROVIDERS.OLLAMA),
  };
}

function getPricingForProvider(pricingInput, providerInput) {
  const provider = getUsageModelProvider(providerInput);
  return serializePricingByProvider(pricingInput)[provider];
}

function startOfMonth(date) {
  const value = date ? new Date(date) : new Date();
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function monthKey(date) {
  const value = new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${value.getFullYear()}-${month}`;
}

function dayKey(date) {
  const value = new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function monthLabel(date) {
  return new Date(date).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function getTurnStartedDate(turn) {
  return turn && (turn.startedAt || turn.queuedAt || turn.createdAt || turn.updatedAt);
}

function incrementMap(map, key, amount = 1) {
  const normalizedKey = String(key || '').trim() || 'unknown';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function serializeDistribution(map, total, labels = {}) {
  return Array.from(map.entries())
    .map(([key, count]) => ({
      key,
      label: labels[key] || key.replace(/_/g, ' '),
      count,
      share: total ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function calculateNumberStats(values = []) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!numbers.length) {
    return { count: 0, min: null, max: null, avg: null, median: null, p95: null };
  }
  const sum = numbers.reduce((total, value) => total + value, 0);
  const middle = Math.floor(numbers.length / 2);
  const median = numbers.length % 2
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
  const p95Index = Math.min(numbers.length - 1, Math.ceil(numbers.length * 0.95) - 1);
  return {
    count: numbers.length,
    min: numbers[0],
    max: numbers[numbers.length - 1],
    avg: sum / numbers.length,
    median,
    p95: numbers[p95Index],
  };
}

function createActivityBucket(seed = {}) {
  const providerTotals = USAGE_MODEL_PROVIDERS.reduce((result, provider) => {
    result[provider] = {
      sessionIds: new Set(),
      turnCount: 0,
      tokenTotals: zeroTokenUsage(),
    };
    return result;
  }, {});
  return {
    key: seed.key || '',
    label: seed.label || '',
    start: seed.start || null,
    end: seed.end || null,
    sessionCount: 0,
    sessionIds: new Set(),
    turnCount: 0,
    completedTurnCount: 0,
    terminalTurnCount: 0,
    successfulTurnCount: 0,
    totalDurationMs: 0,
    durations: [],
    tokenTotals: zeroTokenUsage(),
    tokenValues: [],
    providerTotals,
    kindMap: new Map(),
    statusMap: new Map(),
    modelMap: new Map(),
    providerMap: new Map(),
    dayMap: new Map(),
    lastStartedAt: null,
  };
}

function recordSessionInBucket(bucket, session) {
  if (!bucket || !session) {
    return;
  }
  const sessionId = String(session.sessionId || session._id || session.id || '');
  if (sessionId && !bucket.sessionIds.has(sessionId)) {
    bucket.sessionIds.add(sessionId);
    bucket.sessionCount += 1;
  }
  const provider = getUsageModelProvider(getTurnModelProvider(session));
  if (sessionId) {
    bucket.providerTotals[provider].sessionIds.add(sessionId);
  }
}

function recordTurnInBucket(bucket, turn) {
  if (!bucket || !turn) {
    return;
  }
  bucket.turnCount += 1;
  const tokens = getTurnTokenUsage(turn);
  const provider = getUsageModelProvider(getTurnModelProvider(turn));
  addTokenUsage(bucket.tokenTotals, tokens);
  addTokenUsage(bucket.providerTotals[provider].tokenTotals, tokens);
  bucket.providerTotals[provider].turnCount += 1;
  bucket.tokenValues.push(tokens.total);

  const status = turn.status || 'unknown';
  incrementMap(bucket.statusMap, status);
  incrementMap(bucket.kindMap, turn.kind || 'unknown');
  incrementMap(bucket.modelMap, turn.model || 'default');
  incrementMap(bucket.providerMap, provider);
  recordSessionInBucket(bucket, turn);

  if (TERMINAL_TURN_STATUSES.has(status)) {
    bucket.terminalTurnCount += 1;
  }
  if (status === 'succeeded') {
    bucket.successfulTurnCount += 1;
  }
  const durationMs = Number(turn.durationMs);
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    bucket.completedTurnCount += 1;
    bucket.totalDurationMs += durationMs;
    bucket.durations.push(durationMs);
  }
  const startedAt = getTurnStartedDate(turn);
  if (startedAt) {
    const startedDate = new Date(startedAt);
    if (!Number.isNaN(startedDate.getTime())) {
      incrementMap(bucket.dayMap, dayKey(startedDate));
      if (!bucket.lastStartedAt || startedDate > new Date(bucket.lastStartedAt)) {
        bucket.lastStartedAt = startedAt;
      }
    }
  }
}

function getTopDay(dayMap) {
  const [date, turnCount] = Array.from(dayMap.entries())
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0] || [];
  return date ? { date, turnCount } : null;
}

function finalizeActivityBucket(bucket, pricing) {
  const durationStats = calculateNumberStats(bucket.durations);
  const tokenStats = calculateNumberStats(bucket.tokenValues);
  const pricingByProvider = serializePricingByProvider(pricing);
  const providerUsage = USAGE_MODEL_PROVIDERS.reduce((result, provider) => {
    const providerTotals = bucket.providerTotals[provider];
    const tokenCost = estimateTokenCost(
      providerTotals.tokenTotals,
      pricingByProvider[provider],
    );
    result[provider] = {
      provider,
      sessionCount: providerTotals.sessionIds.size,
      turnCount: providerTotals.turnCount,
      tokens: normalizeTokenUsage(providerTotals.tokenTotals),
      cost: tokenCost.total,
      costBreakdown: tokenCost.breakdown,
    };
    return result;
  }, {});
  const openaiUsage = providerUsage[MODEL_PROVIDERS.OPENAI];
  const ollamaUsage = providerUsage[MODEL_PROVIDERS.OLLAMA];
  return {
    key: bucket.key,
    label: bucket.label,
    start: bucket.start,
    end: bucket.end,
    sessionCount: bucket.sessionCount,
    turnCount: bucket.turnCount,
    completedTurnCount: bucket.completedTurnCount,
    terminalTurnCount: bucket.terminalTurnCount,
    successfulTurnCount: bucket.successfulTurnCount,
    successRate: bucket.terminalTurnCount ? (bucket.successfulTurnCount / bucket.terminalTurnCount) * 100 : null,
    totalDurationMs: bucket.totalDurationMs,
    avgDurationMs: durationStats.avg,
    durationStats,
    tokenStats,
    tokens: normalizeTokenUsage(bucket.tokenTotals),
    averageTokensPerTurn: bucket.turnCount ? bucket.tokenTotals.total / bucket.turnCount : 0,
    cacheShare: bucket.tokenTotals.input ? (bucket.tokenTotals.cached / bucket.tokenTotals.input) * 100 : 0,
    reasoningShare: bucket.tokenTotals.output ? (bucket.tokenTotals.reasoning / bucket.tokenTotals.output) * 100 : 0,
    cost: openaiUsage.cost,
    costBreakdown: openaiUsage.costBreakdown,
    ollamaCost: ollamaUsage.cost,
    ollamaCostBreakdown: ollamaUsage.costBreakdown,
    combinedCost: openaiUsage.cost + ollamaUsage.cost,
    costs: {
      openai: openaiUsage.cost,
      ollama: ollamaUsage.cost,
      combined: openaiUsage.cost + ollamaUsage.cost,
    },
    providerUsage,
    kindDistribution: serializeDistribution(bucket.kindMap, bucket.turnCount, KIND_LABELS),
    statusDistribution: serializeDistribution(bucket.statusMap, bucket.turnCount, TERMINAL_STATUS_LABELS),
    modelDistribution: serializeDistribution(bucket.modelMap, bucket.turnCount),
    providerDistribution: serializeDistribution(bucket.providerMap, bucket.turnCount, {
      openai: 'OpenAI',
      ollama: 'Ollama',
    }),
    busiestDay: getTopDay(bucket.dayMap),
    lastStartedAt: bucket.lastStartedAt,
  };
}

function getRuntimeConfig() {
  return {
    binaryPath: process.env.CODEX_BINARY_PATH || process.env.CODEX_BINARY || 'codex',
    ollamaProfile: normalizeCodexProfileName(process.env.CODEX_OLLAMA_PROFILE || 'ollama'),
    runpodProfileEnvFile: normalizeOptionalString(
      process.env.CODEX_RUNPOD_PROFILE_ENV_FILE,
      500
    ) || '~/.codex/lentmiien.env',
    runpodProfileShell: normalizeOptionalString(
      process.env.CODEX_RUNPOD_PROFILE_SHELL,
      500
    ) || '/bin/bash',
    workerEnabled: getBooleanEnv('CODEX_WORKER_ENABLED', true),
    globalConcurrency: getPositiveIntegerEnv('CODEX_GLOBAL_CONCURRENCY', 1, 1, 8),
    pollIntervalMs: getPositiveIntegerEnv('CODEX_WORKER_POLL_MS', 5000, 1000, 60000),
    timeoutMs: getPositiveIntegerEnv('CODEX_TIMEOUT_MS', 60 * 60 * 1000, 30 * 1000),
    completionExitGraceMs: getPositiveIntegerEnv('CODEX_COMPLETION_EXIT_GRACE_MS', 2000, 100, 30000),
    lockTtlMs: getPositiveIntegerEnv('CODEX_LOCK_TTL_MS', 5 * 60 * 1000, 60 * 1000),
    heartbeatMs: getPositiveIntegerEnv('CODEX_LOCK_HEARTBEAT_MS', 15 * 1000, 2000),
    maxPromptChars: getPositiveIntegerEnv('CODEX_MAX_PROMPT_CHARS', 20000, 1000, 500000),
    maxAdditionalMessagesPerTurn: getPositiveIntegerEnv(
      'CODEX_MAX_ADDITIONAL_MESSAGES_PER_TURN',
      20,
      1,
      100
    ),
    additionalMessagePollMs: getPositiveIntegerEnv('CODEX_MESSAGE_POLL_MS', 1000, 250, 10000),
    additionalMessageTimeoutMs: getPositiveIntegerEnv('CODEX_MESSAGE_TIMEOUT_MS', 15000, 1000, 60000),
    maxEventsPerTurn: getPositiveIntegerEnv('CODEX_MAX_EVENTS_PER_TURN', 2000, 20, 100000),
    maxEventTextChars: getPositiveIntegerEnv('CODEX_MAX_EVENT_TEXT_CHARS', 12000, 1000, 100000),
    remoteValidationTimeoutMs: getPositiveIntegerEnv('CODEX_REMOTE_VALIDATION_TIMEOUT_MS', 15000, 1000, 120000),
    yoloEnabled: getBooleanEnv('CODEX_YOLO_ENABLED', false),
  };
}

function getLocalTargetDefaults() {
  if (process.platform === 'win32') {
    return { type: 'local-windows', platform: 'windows', pathStyle: 'windows' };
  }
  if (process.platform === 'darwin') {
    return { type: 'local-darwin', platform: 'darwin', pathStyle: 'posix' };
  }
  return { type: 'local-linux', platform: 'linux', pathStyle: 'posix' };
}

function parseSshOptions(value) {
  if (!value || !String(value).trim()) {
    return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];
  }

  const rawValue = String(value).trim();
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).filter(Boolean);
    }
  } catch (_error) {
    // Fall back to shell-like whitespace splitting for simple option lists.
  }

  return rawValue.split(/\s+/).filter(Boolean);
}

function getRemoteSshSeedConfig() {
  const enabled = getBooleanEnv('CODEX_REMOTE_SSH_ENABLED', false);
  const destination = normalizeOptionalString(process.env.CODEX_REMOTE_SSH_DESTINATION, 240);
  const host = normalizeOptionalString(process.env.CODEX_REMOTE_SSH_HOST, 240);
  const user = normalizeOptionalString(process.env.CODEX_REMOTE_SSH_USER, 120);

  if (!enabled && !destination && !host) {
    return null;
  }
  if (!destination && !host) {
    throw new Error('CODEX_REMOTE_SSH_DESTINATION or CODEX_REMOTE_SSH_HOST is required when CODEX_REMOTE_SSH_ENABLED is true.');
  }

  const port = Number.parseInt(process.env.CODEX_REMOTE_SSH_PORT, 10);
  const connection = {
    destination: destination || (user ? `${user}@${host}` : host),
    host,
    user,
    codexBinaryPath: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_CODEX_BINARY, 500) || 'codex',
    envWrapperPath: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_ENV_WRAPPER, 500),
    tempDir: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_TEMP_DIR, 500) || '/tmp',
    shell: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_SHELL, 500) || '/bin/sh',
    options: parseSshOptions(process.env.CODEX_REMOTE_SSH_OPTIONS),
  };
  if (Number.isFinite(port) && port > 0) {
    connection.port = port;
  }

  return {
    name: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_NAME, 140) || `Linux Codex (${connection.destination})`,
    description: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_DESCRIPTION, 1000) || 'Codex runs on a Linux machine over SSH.',
    connection,
    workspaceName: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_WORKSPACE_NAME, 140),
    workspacePath: normalizeOptionalString(process.env.CODEX_REMOTE_SSH_WORKSPACE_PATH, 1200),
    workspaceAllowYolo: getBooleanEnv('CODEX_REMOTE_SSH_WORKSPACE_ALLOW_YOLO', false),
  };
}

async function ensureRemoteSshSeedData() {
  const config = getRemoteSshSeedConfig();
  if (!config) {
    return;
  }

  let target = await CodexExecutionTarget.findOne({
    type: 'remote-ssh-linux',
    'connection.destination': config.connection.destination,
  }).sort({ createdAt: 1 }).exec();

  if (!target) {
    target = await CodexExecutionTarget.create({
      name: config.name,
      type: 'remote-ssh-linux',
      platform: 'remote-linux',
      enabled: true,
      description: config.description,
      connection: config.connection,
    });
  } else {
    target.name = config.name;
    target.platform = 'remote-linux';
    target.enabled = true;
    target.description = config.description;
    target.connection = config.connection;
    await target.save();
  }

  if (!config.workspacePath) {
    return;
  }

  const rootPath = normalizeWorkspaceRootPathForTarget(config.workspacePath, target);
  let workspace = await CodexWorkspace.findOne({
    targetId: target._id,
    rootPath,
  }).exec();

  if (!workspace) {
    workspace = await CodexWorkspace.create({
      targetId: target._id,
      name: config.workspaceName || 'Lentmiien Site',
      rootPath,
      pathStyle: 'posix',
      enabled: true,
      description: 'Default remote workspace seeded for the Codex web tool.',
      defaultQuestionPermission: 'read-only',
      defaultActionPermission: 'workspace-write',
      allowYolo: config.workspaceAllowYolo,
      maxConcurrentTurns: 1,
    }).catch((error) => {
      if (error && error.code === 11000) {
        return null;
      }
      throw error;
    });
    return;
  }

  workspace.name = config.workspaceName || workspace.name;
  workspace.pathStyle = 'posix';
  workspace.enabled = true;
  workspace.defaultQuestionPermission = 'read-only';
  workspace.defaultActionPermission = 'workspace-write';
  workspace.allowYolo = config.workspaceAllowYolo;
  await workspace.save();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeOptionalString(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeRequestProfileId(value, fallback = '') {
  const source = normalizeOptionalString(value || fallback, 80).toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!normalized) {
    throw createHttpError(400, 'Profile key is required.');
  }
  return normalized;
}

function normalizeCodexProfileName(value) {
  const profile = normalizeOptionalString(value, 120);
  if (profile && !/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw createHttpError(400, 'Codex profile names can only contain letters, numbers, hyphens, and underscores.');
  }
  return profile;
}

function normalizeReasoningEffort(value) {
  const effort = normalizeOptionalString(value, 20).toLowerCase();
  if (!VALID_REASONING_EFFORTS.has(effort)) {
    throw createHttpError(400, 'Reasoning effort must be low, medium, high, xhigh, max, or ultra.');
  }
  return effort;
}

function normalizeSortOrder(value, fallback = 100) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(number, 100000));
}

function normalizeRequestProfilePayload(payload = {}, options = {}) {
  const name = normalizeOptionalString(payload.name, 80);
  if (!name) {
    throw createHttpError(400, 'Profile name is required.');
  }
  const normalized = {
    name,
    description: normalizeOptionalString(payload.description, 500),
    model: normalizeOptionalString(payload.model, 120),
    codexProfile: normalizeCodexProfileName(payload.codexProfile || payload.profile),
    reasoningEffort: normalizeReasoningEffort(payload.reasoningEffort),
    enabled: Object.prototype.hasOwnProperty.call(payload, 'enabled') ? normalizeBoolean(payload.enabled) : true,
    sortOrder: normalizeSortOrder(payload.sortOrder, 100),
  };
  if (options.includeId) {
    normalized._id = normalizeRequestProfileId(payload.id || payload._id, name);
  }
  return normalized;
}

function serializeRequestProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: String(profile._id || ''),
    name: profile.name || '',
    description: profile.description || '',
    model: profile.model || '',
    codexProfile: profile.codexProfile || '',
    reasoningEffort: profile.reasoningEffort || '',
    enabled: Boolean(profile.enabled),
    sortOrder: Number(profile.sortOrder) || 0,
    updatedBy: profile.updatedBy || {},
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

function normalizePromptTemplateId(value) {
  const id = normalizeOptionalString(value, 160);
  if (!id) {
    throw createHttpError(400, 'Prompt template id is required.');
  }
  return id;
}

function normalizePromptTemplatePayload(payload = {}) {
  const name = normalizeOptionalString(payload.name, 120);
  if (!name) {
    throw createHttpError(400, 'Template name is required.');
  }
  return {
    name,
    description: normalizeOptionalString(payload.description, 500),
    prompt: normalizePrompt(payload.prompt),
    workspaceId: normalizeOptionalString(payload.workspaceId, 160),
  };
}

function serializePromptTemplate(template) {
  if (!template) {
    return null;
  }
  return {
    id: String(template._id || ''),
    name: template.name || '',
    description: template.description || '',
    prompt: template.prompt || '',
    workspaceId: String(template.workspaceId || ''),
    createdAt: template.createdAt || null,
    updatedAt: template.updatedAt || null,
  };
}

async function ensurePromptTemplateWorkspaceExists(workspaceId) {
  if (!workspaceId) {
    return;
  }
  const workspace = await CodexWorkspace.exists({ _id: workspaceId });
  if (!workspace) {
    throw createHttpError(400, 'Selected workspace does not exist.');
  }
}

async function ensureDefaultRequestProfiles() {
  await Promise.all(DEFAULT_REQUEST_PROFILES.map(async (profile) => {
    const existing = await CodexRequestProfile.findById(profile._id).exec();
    if (!existing) {
      await CodexRequestProfile.create({
        ...profile,
        enabled: true,
      });
      return;
    }

    const editedByUser = Boolean(existing.updatedBy && (existing.updatedBy.id || existing.updatedBy.name));
    if (editedByUser) {
      return;
    }

    existing.name = profile.name;
    existing.description = profile.description;
    existing.model = profile.model;
    existing.codexProfile = profile.codexProfile;
    existing.reasoningEffort = profile.reasoningEffort;
    existing.sortOrder = profile.sortOrder;
    existing.enabled = true;
    await existing.save();
  }));
}

function makeOwner(user) {
  return {
    id: user && (user._id || user.id) ? String(user._id || user.id) : null,
    name: user && user.name ? String(user.name) : '',
  };
}

function getOwnerId(user) {
  const id = normalizeOptionalString(user && (user._id || user.id), 160);
  if (id) {
    return id;
  }
  const name = normalizeOptionalString(user && user.name, 120);
  if (name) {
    return `name:${name}`;
  }
  throw createHttpError(401, 'Authentication is required to access prompt templates.');
}

function normalizePrompt(prompt) {
  const value = String(prompt || '').trim();
  const { maxPromptChars } = getRuntimeConfig();
  if (!value) {
    throw createHttpError(400, 'Prompt is required.');
  }
  if (value.length > maxPromptChars) {
    throw createHttpError(400, `Prompt is too long. Maximum length is ${maxPromptChars} characters.`);
  }
  return value;
}

function normalizeAdditionalTurnMessagePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'A JSON object containing a message is required.');
  }
  const keys = Object.keys(payload);
  if (keys.some((key) => key !== 'message')) {
    throw createHttpError(400, 'The message request contains unsupported fields.');
  }
  if (typeof payload.message !== 'string') {
    throw createHttpError(400, 'Message must be a string.');
  }
  const message = payload.message.trim();
  const { maxPromptChars } = getRuntimeConfig();
  if (!message) {
    throw createHttpError(400, 'Message is required.');
  }
  if (message.includes('\0')) {
    throw createHttpError(400, 'Message contains an unsupported character.');
  }
  if (message.length > maxPromptChars) {
    throw createHttpError(400, `Message is too long. Maximum length is ${maxPromptChars} characters.`);
  }
  return message;
}

function titleFromPrompt(prompt) {
  const firstLine = String(prompt || '').split(/\r?\n/).find((line) => line.trim()) || 'Codex request';
  const title = firstLine.trim().replace(/\s+/g, ' ').slice(0, 160);
  return title || 'Codex request';
}

function previewFromText(text, maxLength = 420) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeMode(mode) {
  const normalized = String(mode || 'question').trim().toLowerCase();
  if (!VALID_MODES.has(normalized)) {
    throw createHttpError(400, 'Mode must be either question, action, or git_commit_push.');
  }
  return normalized;
}

function isActionMode(mode) {
  return ACTION_MODE_TYPES.has(String(mode || '').trim().toLowerCase());
}

function getSessionTurnKind(mode) {
  return isActionMode(mode) ? COMMIT_PUSH_KIND : 'question';
}

function getFollowupTurnKind(mode) {
  return isActionMode(mode) ? 'followup_action' : 'followup_question';
}

function normalizePermissionMode(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }
  if (!VALID_PERMISSION_MODES.has(normalized)) {
    throw createHttpError(400, 'Unsupported Codex permission mode.');
  }
  return normalized;
}

function resolvePermissionMode({ mode, requestedPermissionMode, workspace, confirmYolo }) {
  const requested = normalizePermissionMode(requestedPermissionMode);
  const isCommitPushMode = String(mode || '').trim().toLowerCase() === COMMIT_PUSH_MODE;
  let permissionMode = requested === 'auto'
    ? (isActionMode(mode)
      ? workspace.defaultActionPermission || 'workspace-write'
      : workspace.defaultQuestionPermission || 'read-only')
    : requested;

  if (isCommitPushMode) {
    permissionMode = 'yolo';
    confirmYolo = true;
  }

  if (permissionMode !== 'yolo') {
    return { permissionMode, yolo: false };
  }

  const config = getRuntimeConfig();
  if (!config.yoloEnabled) {
    throw createHttpError(403, 'Dangerous mode is disabled by server configuration.');
  }
  if (!workspace.allowYolo) {
    throw createHttpError(403, 'Dangerous mode is not enabled for this workspace.');
  }
  if (!normalizeBoolean(confirmYolo)) {
    throw createHttpError(400, 'Dangerous mode requires explicit confirmation.');
  }

  return { permissionMode: 'yolo', yolo: true };
}

async function assertLocalDirectory(rootPath) {
  let stat;
  try {
    stat = await fs.promises.stat(rootPath);
  } catch (_error) {
    throw createHttpError(400, 'Workspace path does not exist on this machine.');
  }
  if (!stat.isDirectory()) {
    throw createHttpError(400, 'Workspace path must be a directory.');
  }
}

function isRemoteSshTarget(target) {
  return target && target.type === 'remote-ssh-linux';
}

function getTargetPathStyle(target) {
  if (target && target.platform === 'windows') {
    return 'windows';
  }
  return 'posix';
}

function normalizeWorkspaceRootPathForTarget(rootPath, target) {
  const submittedRootPath = String(rootPath || '').trim();
  if (!submittedRootPath) {
    throw createHttpError(400, 'Workspace root path is required.');
  }

  if (!isRemoteSshTarget(target)) {
    return path.resolve(submittedRootPath);
  }

  if (!submittedRootPath.startsWith('/')) {
    throw createHttpError(400, 'Remote Linux workspace paths must be absolute POSIX paths.');
  }

  const normalizedPath = path.posix.normalize(submittedRootPath);
  return normalizedPath === '.' ? '/' : normalizedPath;
}

async function assertRemoteDirectory(target, rootPath) {
  const connection = target && target.connection ? target.connection : {};
  const command = buildRemoteShellCommand(
    `test -d ${quotePosixShellArg(rootPath)}`,
    connection
  );
  try {
    await execFileAsync(getSshBinary(connection), buildSshArgs(connection, command), {
      timeout: getRuntimeConfig().remoteValidationTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw createHttpError(400, `Remote workspace path is not reachable over SSH: ${error.message}`);
  }
}

async function assertWorkspaceDirectoryForTarget(target, rootPath) {
  if (isRemoteSshTarget(target)) {
    await assertRemoteDirectory(target, rootPath);
    return;
  }
  await assertLocalDirectory(rootPath);
}

function shouldValidateWorkspaceDirectory(target, options = {}) {
  if (options.validateDirectory === false) {
    return false;
  }
  if (isRemoteSshTarget(target) && options.validateRemoteDirectory === false) {
    return false;
  }
  return true;
}

function isIndexNotFoundError(error) {
  return error && (
    error.code === 27 ||
    error.codeName === 'IndexNotFound' ||
    /index not found/i.test(String(error.message || ''))
  );
}

function isNamespaceMissingError(error) {
  return error && (
    error.code === 26 ||
    error.codeName === 'NamespaceNotFound' ||
    /ns not found|namespace.*not found/i.test(String(error.message || ''))
  );
}

function isCorrectCodexThreadIndex(index) {
  const partial = index && index.partialFilterExpression;
  return Boolean(
    index &&
    index.unique === true &&
    partial &&
    partial.codexThreadId &&
    partial.codexThreadId.$type === 'string'
  );
}

function isCodexThreadIndex(index) {
  return Boolean(
    index &&
    index.key &&
    Number(index.key.codexThreadId) === 1 &&
    Object.keys(index.key).length === 1
  );
}

function isSingleKeyIndex(index, keyName) {
  return Boolean(
    index &&
    index.key &&
    Number(index.key[keyName]) === 1 &&
    Object.keys(index.key).length === 1
  );
}

function isCorrectWorkspaceLockIndex(index) {
  return Boolean(
    index &&
    index.name === WORKSPACE_LOCK_INDEX_NAME &&
    index.unique === true &&
    isSingleKeyIndex(index, 'workspaceId')
  );
}

function isCorrectWorkspaceLockTtlIndex(index) {
  return Boolean(
    index &&
    index.name === WORKSPACE_LOCK_TTL_INDEX_NAME &&
    Number(index.expireAfterSeconds) === 0 &&
    isSingleKeyIndex(index, 'expiresAt')
  );
}

function isWorkspaceLockConflictError(error) {
  if (!error || error.code !== 11000) {
    return false;
  }

  const keyPattern = error.keyPattern && typeof error.keyPattern === 'object' ? error.keyPattern : null;
  if (keyPattern) {
    return Number(keyPattern.workspaceId) === 1 && Object.keys(keyPattern).length === 1;
  }

  const message = String(error.message || '');
  const indexName = String(error.index || '');
  return message.includes(WORKSPACE_LOCK_INDEX_NAME) || indexName === WORKSPACE_LOCK_INDEX_NAME;
}

async function ensureCodexSessionIndexes() {
  let indexes = [];
  try {
    indexes = await CodexSession.collection.indexes();
  } catch (error) {
    if (!isNamespaceMissingError(error)) {
      throw error;
    }
  }

  const existingThreadIndex = indexes.find((index) => (
    index.name === CODEX_THREAD_INDEX_NAME ||
    isCodexThreadIndex(index)
  ));

  if (existingThreadIndex && !isCorrectCodexThreadIndex(existingThreadIndex)) {
    await CodexSession.collection.dropIndex(existingThreadIndex.name).catch((error) => {
      if (!isIndexNotFoundError(error)) {
        throw error;
      }
    });
  }

  if (!existingThreadIndex || !isCorrectCodexThreadIndex(existingThreadIndex)) {
    await CodexSession.collection.createIndex(
      { codexThreadId: 1 },
      {
        unique: true,
        name: CODEX_THREAD_INDEX_NAME,
        partialFilterExpression: {
          codexThreadId: { $type: 'string' },
        },
      }
    );
  }

  await Promise.all([
    CodexSession.collection.createIndex(
      { workspaceId: 1, updatedAt: -1 },
      { name: 'workspaceId_1_updatedAt_-1' }
    ),
    CodexSession.collection.createIndex(
      { 'createdBy.id': 1, updatedAt: -1 },
      { name: 'createdBy.id_1_updatedAt_-1' }
    ),
    CodexSession.collection.createIndex(
      { status: 1, updatedAt: -1 },
      { name: 'status_1_updatedAt_-1' }
    ),
  ]);
}

async function ensureCodexWorkspaceLockIndexes() {
  await CodexWorkspaceLock.deleteMany({ expiresAt: { $lte: new Date() } }).exec();

  let indexes = [];
  try {
    indexes = await CodexWorkspaceLock.collection.indexes();
  } catch (error) {
    if (!isNamespaceMissingError(error)) {
      throw error;
    }
  }

  for (const index of indexes) {
    if (!index || index.name === '_id_') {
      continue;
    }

    const workspaceIndex = isSingleKeyIndex(index, 'workspaceId');
    const ttlIndex = isSingleKeyIndex(index, 'expiresAt');
    const obsoleteUniqueIndex = index.unique === true && !workspaceIndex;
    const incorrectWorkspaceIndex = workspaceIndex && !isCorrectWorkspaceLockIndex(index);
    const incorrectTtlIndex = ttlIndex && !isCorrectWorkspaceLockTtlIndex(index);

    if (obsoleteUniqueIndex || incorrectWorkspaceIndex || incorrectTtlIndex) {
      await CodexWorkspaceLock.collection.dropIndex(index.name).catch((error) => {
        if (!isIndexNotFoundError(error)) {
          throw error;
        }
      });
    }
  }

  await Promise.all([
    CodexWorkspaceLock.collection.createIndex(
      { workspaceId: 1 },
      { unique: true, name: WORKSPACE_LOCK_INDEX_NAME }
    ),
    CodexWorkspaceLock.collection.createIndex(
      { turnId: 1 },
      { name: 'turnId_1' }
    ),
    CodexWorkspaceLock.collection.createIndex(
      { workerId: 1 },
      { name: 'workerId_1' }
    ),
    CodexWorkspaceLock.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: WORKSPACE_LOCK_TTL_INDEX_NAME }
    ),
  ]);
}

async function ensureDefaultData() {
  if (defaultDataPromise) {
    return defaultDataPromise;
  }

  defaultDataPromise = (async () => {
    await ensureCodexSessionIndexes();
    await ensureCodexWorkspaceLockIndexes();
    await ensureDefaultRequestProfiles();

    const localDefaults = getLocalTargetDefaults();
    let target = await CodexExecutionTarget.findOne({
      type: localDefaults.type,
      platform: localDefaults.platform,
    }).sort({ createdAt: 1 }).exec();

    if (!target) {
      target = await CodexExecutionTarget.create({
        name: process.env.CODEX_DEFAULT_TARGET_NAME || 'Local machine',
        type: localDefaults.type,
        platform: localDefaults.platform,
        enabled: true,
        description: 'Codex runs on the same machine as the web server.',
      });
    }

    const workspaceCount = await CodexWorkspace.countDocuments({}).exec();
    if (workspaceCount === 0) {
      const defaultRoot = path.resolve(process.env.CODEX_DEFAULT_WORKSPACE_PATH || path.join(__dirname, '..'));
      await assertLocalDirectory(defaultRoot);
      await CodexWorkspace.create({
        targetId: target._id,
        name: process.env.CODEX_DEFAULT_WORKSPACE_NAME || 'Lentmiien Site',
        rootPath: defaultRoot,
        pathStyle: localDefaults.pathStyle,
        enabled: true,
        description: 'Default workspace seeded for the Codex web tool.',
        defaultQuestionPermission: 'read-only',
        defaultActionPermission: 'workspace-write',
        allowYolo: false,
        maxConcurrentTurns: 1,
      }).catch((error) => {
        if (error && error.code === 11000) {
          return null;
        }
        throw error;
      });
    }

    await ensureRemoteSshSeedData();
  })().catch((error) => {
    defaultDataPromise = null;
    throw error;
  });

  return defaultDataPromise;
}

async function getWorkspaceBundle(workspaceId, options = {}) {
  await ensureDefaultData();

  const workspace = await CodexWorkspace.findById(workspaceId).exec();
  if (!workspace) {
    throw createHttpError(404, 'Workspace not found.');
  }
  if (!options.includeDisabled && !workspace.enabled) {
    throw createHttpError(403, 'Workspace is disabled.');
  }

  const target = await CodexExecutionTarget.findById(workspace.targetId).exec();
  if (!target) {
    throw createHttpError(400, 'Workspace execution target is missing.');
  }
  if (!options.includeDisabled && !target.enabled) {
    throw createHttpError(403, 'Workspace execution target is disabled.');
  }

  const normalizedPath = normalizeWorkspaceRootPathForTarget(workspace.rootPath, target);
  if (shouldValidateWorkspaceDirectory(target, options)) {
    await assertWorkspaceDirectoryForTarget(target, normalizedPath);
  }
  if (workspace.rootPath !== normalizedPath || workspace.pathStyle !== getTargetPathStyle(target)) {
    workspace.rootPath = normalizedPath;
    workspace.pathStyle = getTargetPathStyle(target);
    await workspace.save();
  }

  return { workspace, target };
}

async function resolveTurnRequestOptions(payload = {}, workspace = {}, options = {}) {
  const fallbackProvider = options.requiredModelProvider || options.modelProvider || MODEL_PROVIDERS.OPENAI;
  const modelProvider = normalizeModelProvider(payload.modelProvider, fallbackProvider);
  if (options.requiredModelProvider && modelProvider !== normalizeModelProvider(options.requiredModelProvider)) {
    throw createHttpError(409, 'A Codex session cannot switch model providers. Start a new session to change providers.');
  }
  await assertRunpodModelProviderAuthorized(modelProvider, options.user);
  if (isRunpodModelProvider(modelProvider)) {
    const definition = await assertModelProviderAvailable(modelProvider);
    return {
      requestProfileId: '',
      requestProfileName: '',
      modelProvider,
      model: '',
      profile: definition.codexProfile,
      reasoningEffort: '',
    };
  }
  if (modelProvider === MODEL_PROVIDERS.OLLAMA) {
    const localModelOptions = await getLocalModelOptions();
    return {
      requestProfileId: '',
      requestProfileName: '',
      modelProvider,
      model: normalizeLocalModel(payload.model, options.defaultModel, localModelOptions),
      profile: '',
      reasoningEffort: '',
    };
  }

  const requestedProfileId = normalizeOptionalString(payload.requestProfileId || payload.requestProfile, 80);
  const normalizedMode = String(options.mode || '').trim().toLowerCase();
  const effectiveProfileId = requestedProfileId || (normalizedMode === COMMIT_PUSH_MODE
    ? COMMIT_PUSH_DEFAULT_PROFILE_ID
    : '');
  if (!effectiveProfileId) {
    return {
      requestProfileId: '',
      requestProfileName: '',
      modelProvider,
      model: normalizeOptionalString(payload.model || workspace.defaultModel),
      profile: normalizeCodexProfileName(payload.profile || workspace.defaultProfile),
      reasoningEffort: normalizeReasoningEffort(payload.reasoningEffort),
    };
  }

  const requestProfileId = normalizeRequestProfileId(effectiveProfileId);
  const requestProfile = await CodexRequestProfile.findById(requestProfileId).lean().exec();
  if (!requestProfile || !requestProfile.enabled) {
    throw createHttpError(400, 'Selected Codex profile is not available.');
  }

  return {
    requestProfileId: String(requestProfile._id),
    requestProfileName: requestProfile.name || '',
    modelProvider,
    model: normalizeOptionalString(requestProfile.model || workspace.defaultModel),
    profile: normalizeCodexProfileName(requestProfile.codexProfile || workspace.defaultProfile),
    reasoningEffort: normalizeReasoningEffort(requestProfile.reasoningEffort || payload.reasoningEffort),
  };
}

async function createSession(payload = {}, user) {
  const prompt = normalizePrompt(payload.prompt);
  const mode = normalizeMode(payload.mode);
  const { workspace, target } = await getWorkspaceBundle(payload.workspaceId, { validateRemoteDirectory: false });
  const permission = resolvePermissionMode({
    mode,
    requestedPermissionMode: payload.permissionMode,
    workspace,
    confirmYolo: payload.confirmYolo,
  });
  const requestOptions = await resolveTurnRequestOptions(payload, workspace, { mode, user });
  const owner = makeOwner(user);

  const session = await CodexSession.create({
    workspaceId: workspace._id,
    targetId: target._id,
    title: titleFromPrompt(prompt),
    modelProvider: requestOptions.modelProvider,
    model: requestOptions.model,
    status: 'pending',
    createdBy: owner,
    turnCount: 0,
  });

  const turn = await CodexTurn.create({
    sessionId: session._id,
    workspaceId: workspace._id,
    targetId: target._id,
    sequence: 1,
    kind: getSessionTurnKind(mode),
    status: 'queued',
    prompt,
    permissionMode: permission.permissionMode,
    yolo: permission.yolo,
    requestProfileId: requestOptions.requestProfileId,
    requestProfileName: requestOptions.requestProfileName,
    modelProvider: requestOptions.modelProvider,
    model: requestOptions.model,
    profile: requestOptions.profile,
    reasoningEffort: requestOptions.reasoningEffort,
    createdBy: owner,
    queuedAt: new Date(),
  });

  session.firstTurnId = turn._id;
  session.lastTurnId = turn._id;
  session.turnCount = 1;
  await session.save();

  return {
    accepted: true,
    session: serializeSession(session, { workspace }),
    turn: serializeTurn(turn, { workspace }),
    statusUrl: `/codex/turns/${encodeURIComponent(turn._id)}`,
  };
}

async function getNextSessionSequence(sessionId) {
  const lastTurn = await CodexTurn.findOne({ sessionId }).sort({ sequence: -1 }).lean().exec();
  return lastTurn && Number.isFinite(lastTurn.sequence) ? lastTurn.sequence + 1 : 1;
}

async function createFollowupTurn(sessionId, payload = {}, user) {
  const session = await CodexSession.findById(sessionId).exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  if (session.status === 'archived') {
    throw createHttpError(409, 'Archived sessions cannot receive follow-up turns.');
  }
  if (!session.codexThreadId) {
    throw createHttpError(409, 'Follow-up is unavailable until the first Codex run has a session id.');
  }

  const prompt = normalizePrompt(payload.prompt);
  const mode = normalizeMode(payload.mode);
  const { workspace, target } = await getWorkspaceBundle(session.workspaceId, { validateRemoteDirectory: false });
  const permission = resolvePermissionMode({
    mode,
    requestedPermissionMode: payload.permissionMode,
    workspace,
    confirmYolo: payload.confirmYolo,
  });
  const sequence = await getNextSessionSequence(session._id);
  const owner = makeOwner(user);
  const kind = getFollowupTurnKind(mode);
  const sessionProvider = getTurnModelProvider(session);
  const requestOptions = await resolveTurnRequestOptions(payload, workspace, {
    mode,
    requiredModelProvider: sessionProvider,
    defaultModel: session.model,
    user,
  });

  const turn = await CodexTurn.create({
    sessionId: session._id,
    workspaceId: workspace._id,
    targetId: target._id,
    sequence,
    kind,
    status: 'queued',
    prompt,
    permissionMode: permission.permissionMode,
    yolo: permission.yolo,
    requestProfileId: requestOptions.requestProfileId,
    requestProfileName: requestOptions.requestProfileName,
    modelProvider: requestOptions.modelProvider,
    model: requestOptions.model,
    profile: requestOptions.profile,
    reasoningEffort: requestOptions.reasoningEffort,
    createdBy: owner,
    queuedAt: new Date(),
  });

  session.lastTurnId = turn._id;
  session.turnCount = Math.max(session.turnCount || 0, sequence);
  session.model = requestOptions.model;
  await session.save();

  return {
    accepted: true,
    session: serializeSession(session, { workspace }),
    turn: serializeTurn(turn, { workspace }),
    statusUrl: `/codex/turns/${encodeURIComponent(turn._id)}`,
  };
}

async function listTargets() {
  await ensureDefaultData();
  const targets = await CodexExecutionTarget.find({}).sort({ enabled: -1, name: 1 }).lean().exec();
  return targets.map(serializeTarget);
}

async function listWorkspaces(options = {}) {
  await ensureDefaultData();
  const query = options.includeDisabled ? {} : { enabled: true };
  const [workspaceDocs, targets] = await Promise.all([
    CodexWorkspace.find(query).sort({ enabled: -1, name: 1 }).lean().exec(),
    CodexExecutionTarget.find({}).lean().exec(),
  ]);
  const targetById = new Map(targets.map((target) => [String(target._id), target]));
  return workspaceDocs.map((workspace) => serializeWorkspace(workspace, { target: targetById.get(String(workspace.targetId)) }));
}

async function listRequestProfiles(options = {}) {
  await ensureDefaultData();
  const query = options.includeDisabled ? {} : { enabled: true };
  const profiles = await CodexRequestProfile.find(query)
    .sort({ enabled: -1, sortOrder: 1, name: 1 })
    .lean()
    .exec();
  return profiles.map(serializeRequestProfile);
}

async function listPromptTemplates(user, options = {}) {
  const ownerId = getOwnerId(user);
  const query = { ownerId };
  if (Object.prototype.hasOwnProperty.call(options, 'workspaceId')) {
    const workspaceId = normalizeOptionalString(options.workspaceId, 160);
    query.$or = [
      { workspaceId: '' },
      { workspaceId: null },
    ];
    if (workspaceId) {
      query.$or.push({ workspaceId });
    }
  }
  const templates = await CodexPromptTemplate.find(query)
    .sort({ name: 1, createdAt: 1 })
    .lean()
    .exec();
  return templates.map(serializePromptTemplate);
}

async function createPromptTemplate(payload = {}, user) {
  const ownerId = getOwnerId(user);
  const normalized = normalizePromptTemplatePayload(payload);
  await ensurePromptTemplateWorkspaceExists(normalized.workspaceId);
  const template = await CodexPromptTemplate.create({
    ...normalized,
    ownerId,
    updatedBy: makeOwner(user),
  });
  return serializePromptTemplate(template);
}

async function updatePromptTemplate(templateId, payload = {}, user) {
  const ownerId = getOwnerId(user);
  const id = normalizePromptTemplateId(templateId);
  const template = await CodexPromptTemplate.findOne({ _id: id, ownerId }).exec();
  if (!template) {
    throw createHttpError(404, 'Prompt template not found.');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = normalizeOptionalString(payload.name, 120);
    if (!name) {
      throw createHttpError(400, 'Template name is required.');
    }
    template.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    template.description = normalizeOptionalString(payload.description, 500);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'prompt')) {
    template.prompt = normalizePrompt(payload.prompt);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'workspaceId')) {
    const workspaceId = normalizeOptionalString(payload.workspaceId, 160);
    await ensurePromptTemplateWorkspaceExists(workspaceId);
    template.workspaceId = workspaceId;
  }
  template.updatedBy = makeOwner(user);
  await template.save();
  return serializePromptTemplate(template);
}

async function deletePromptTemplate(templateId, user) {
  const ownerId = getOwnerId(user);
  const id = normalizePromptTemplateId(templateId);
  const result = await CodexPromptTemplate.deleteOne({ _id: id, ownerId }).exec();
  if (!result.deletedCount) {
    throw createHttpError(404, 'Prompt template not found.');
  }
  return { deleted: true, templateId: id };
}

async function createRequestProfile(payload = {}, user) {
  await ensureDefaultData();
  const normalized = normalizeRequestProfilePayload(payload, { includeId: true });
  const updatedBy = makeOwner(user);
  try {
    const profile = await CodexRequestProfile.create({
      ...normalized,
      updatedBy,
    });
    return serializeRequestProfile(profile);
  } catch (error) {
    if (error && error.code === 11000) {
      throw createHttpError(409, 'A Codex profile with this key already exists.');
    }
    throw error;
  }
}

async function updateRequestProfile(profileId, payload = {}, user) {
  await ensureDefaultData();
  const id = normalizeRequestProfileId(profileId);
  const profile = await CodexRequestProfile.findById(id).exec();
  if (!profile) {
    throw createHttpError(404, 'Codex profile not found.');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = normalizeOptionalString(payload.name, 80);
    if (!name) {
      throw createHttpError(400, 'Profile name is required.');
    }
    profile.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    profile.description = normalizeOptionalString(payload.description, 500);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'model')) {
    profile.model = normalizeOptionalString(payload.model, 120);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'codexProfile') || Object.prototype.hasOwnProperty.call(payload, 'profile')) {
    profile.codexProfile = normalizeCodexProfileName(payload.codexProfile || payload.profile);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort')) {
    profile.reasoningEffort = normalizeReasoningEffort(payload.reasoningEffort);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    if (id === 'default' && !normalizeBoolean(payload.enabled)) {
      throw createHttpError(400, 'The default Codex profile cannot be disabled.');
    }
    profile.enabled = normalizeBoolean(payload.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) {
    profile.sortOrder = normalizeSortOrder(payload.sortOrder, profile.sortOrder);
  }
  profile.updatedBy = makeOwner(user);

  await profile.save();
  return serializeRequestProfile(profile);
}

async function disableRequestProfile(profileId) {
  await ensureDefaultData();
  const id = normalizeRequestProfileId(profileId);
  if (id === 'default') {
    throw createHttpError(400, 'The default Codex profile cannot be disabled.');
  }
  const profile = await CodexRequestProfile.findById(id).exec();
  if (!profile) {
    throw createHttpError(404, 'Codex profile not found.');
  }
  profile.enabled = false;
  await profile.save();
  return { ok: true, profile: serializeRequestProfile(profile) };
}

async function createWorkspace(payload = {}) {
  await ensureDefaultData();
  const name = normalizeOptionalString(payload.name, 140);
  if (!name) {
    throw createHttpError(400, 'Workspace name is required.');
  }

  const targetId = normalizeOptionalString(payload.targetId, 160);
  const target = targetId
    ? await CodexExecutionTarget.findById(targetId).exec()
    : await CodexExecutionTarget.findOne({ enabled: true }).sort({ createdAt: 1 }).exec();
  if (!target) {
    throw createHttpError(400, 'Execution target is required.');
  }

  const rootPath = normalizeWorkspaceRootPathForTarget(payload.rootPath, target);
  if (!isRemoteSshTarget(target)) {
    await assertWorkspaceDirectoryForTarget(target, rootPath);
  }

  const workspace = await CodexWorkspace.create({
    targetId: target._id,
    name,
    rootPath,
    pathStyle: payload.pathStyle || getTargetPathStyle(target),
    enabled: payload.enabled === undefined ? true : normalizeBoolean(payload.enabled),
    description: normalizeOptionalString(payload.description, 1000),
    defaultModel: normalizeOptionalString(payload.defaultModel),
    defaultProfile: normalizeOptionalString(payload.defaultProfile),
    defaultQuestionPermission: normalizePermissionForWorkspace(payload.defaultQuestionPermission, 'read-only'),
    defaultActionPermission: normalizePermissionForWorkspace(payload.defaultActionPermission, 'workspace-write'),
    allowYolo: normalizeBoolean(payload.allowYolo),
    maxConcurrentTurns: 1,
  });

  return serializeWorkspace(workspace, { target });
}

async function updateWorkspace(workspaceId, payload = {}) {
  await ensureDefaultData();
  const workspace = await CodexWorkspace.findById(workspaceId).exec();
  if (!workspace) {
    throw createHttpError(404, 'Workspace not found.');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = normalizeOptionalString(payload.name, 140);
    if (!name) {
      throw createHttpError(400, 'Workspace name is required.');
    }
    workspace.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'rootPath')) {
    const target = await CodexExecutionTarget.findById(workspace.targetId).exec();
    if (!target) {
      throw createHttpError(400, 'Workspace execution target is missing.');
    }
    const rootPath = normalizeWorkspaceRootPathForTarget(payload.rootPath, target);
    if (!isRemoteSshTarget(target)) {
      await assertWorkspaceDirectoryForTarget(target, rootPath);
    }
    workspace.rootPath = rootPath;
    workspace.pathStyle = getTargetPathStyle(target);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    workspace.enabled = normalizeBoolean(payload.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    workspace.description = normalizeOptionalString(payload.description, 1000);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'defaultModel')) {
    workspace.defaultModel = normalizeOptionalString(payload.defaultModel);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'defaultProfile')) {
    workspace.defaultProfile = normalizeOptionalString(payload.defaultProfile);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'defaultQuestionPermission')) {
    workspace.defaultQuestionPermission = normalizePermissionForWorkspace(payload.defaultQuestionPermission, 'read-only');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'defaultActionPermission')) {
    workspace.defaultActionPermission = normalizePermissionForWorkspace(payload.defaultActionPermission, 'workspace-write');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'allowYolo')) {
    workspace.allowYolo = normalizeBoolean(payload.allowYolo);
  }

  await workspace.save();
  const target = await CodexExecutionTarget.findById(workspace.targetId).lean().exec();
  return serializeWorkspace(workspace, { target });
}

async function deleteWorkspace(workspaceId) {
  const workspace = await CodexWorkspace.findById(workspaceId).exec();
  if (!workspace) {
    throw createHttpError(404, 'Workspace not found.');
  }
  workspace.enabled = false;
  await workspace.save();
  return { ok: true, workspace: serializeWorkspace(workspace) };
}

function normalizePermissionForWorkspace(value, fallback) {
  const permission = String(value || fallback).trim().toLowerCase();
  if (permission === 'read-only' || permission === 'workspace-write') {
    return permission;
  }
  throw createHttpError(400, 'Workspace defaults can only be read-only or workspace-write.');
}

async function listSessions(options = {}) {
  await ensureDefaultData();
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 12, 100));
  const query = {};
  if (!options.includeArchived) {
    query.status = { $ne: 'archived' };
  }
  if (options.workspaceId) {
    query.workspaceId = options.workspaceId;
  }
  const [sessions, workspaces] = await Promise.all([
    CodexSession.find(query).sort({ updatedAt: -1 }).limit(limit).lean().exec(),
    CodexWorkspace.find({}).lean().exec(),
  ]);
  const workspaceById = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));
  return sessions.map((session) => serializeSession(session, { workspace: workspaceById.get(String(session.workspaceId)) }));
}

async function getTokenPricing(providerInput = MODEL_PROVIDERS.OPENAI) {
  const provider = normalizeModelProvider(providerInput);
  const pricing = await CodexTokenPrice.findById(getTokenPriceId(provider)).lean().exec();
  return serializeTokenPricing(pricing, provider);
}

async function getTokenPricingByProvider() {
  const [openai, ollama] = await Promise.all([
    getTokenPricing(MODEL_PROVIDERS.OPENAI),
    getTokenPricing(MODEL_PROVIDERS.OLLAMA),
  ]);
  return { openai, ollama };
}

async function updateTokenPricing(payload = {}, user) {
  const provider = normalizeModelProvider(payload.provider, MODEL_PROVIDERS.OPENAI);
  const normalized = normalizeTokenPricingPayload(payload);
  const updatedBy = makeOwner(user);
  const pricing = await CodexTokenPrice.findByIdAndUpdate(
    getTokenPriceId(provider),
    {
      $set: {
        ...normalized,
        updatedBy,
      },
      $setOnInsert: {
        _id: getTokenPriceId(provider),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean().exec();
  return serializeTokenPricing(pricing, provider);
}

function buildSessionStats(turns = [], pricing) {
  const usageTurns = annotateTurnsWithTokenUsage(turns);
  const bucket = createActivityBucket({ key: 'session', label: 'Session' });
  let firstStartedAt = null;
  let lastCompletedAt = null;

  usageTurns.forEach((turn) => {
    recordTurnInBucket(bucket, turn, pricing);
    const startedAt = getTurnStartedDate(turn);
    if (startedAt) {
      const startedDate = new Date(startedAt);
      if (!Number.isNaN(startedDate.getTime()) && (!firstStartedAt || startedDate < new Date(firstStartedAt))) {
        firstStartedAt = startedAt;
      }
    }
    if (turn.completedAt) {
      const completedDate = new Date(turn.completedAt);
      if (!Number.isNaN(completedDate.getTime()) && (!lastCompletedAt || completedDate > new Date(lastCompletedAt))) {
        lastCompletedAt = turn.completedAt;
      }
    }
  });

  const stats = finalizeActivityBucket(bucket, pricing);
  stats.firstStartedAt = firstStartedAt;
  stats.lastCompletedAt = lastCompletedAt;
  stats.elapsedMs = firstStartedAt && lastCompletedAt
    ? Math.max(0, new Date(lastCompletedAt).getTime() - new Date(firstStartedAt).getTime())
    : null;
  return stats;
}

async function annotatePeriodTurnsWithUsageDeltas(turns = []) {
  if (!Array.isArray(turns) || !turns.length) {
    return [];
  }

  const sessionIds = Array.from(new Set(turns
    .map((turn) => String(turn.sessionId || ''))
    .filter(Boolean)));
  const turnIds = new Set(turns.map((turn) => String(turn._id || turn.id || '')));
  if (!sessionIds.length || !turnIds.size) {
    return annotateTurnsWithTokenUsage(turns);
  }

  const sessionTurns = await CodexTurn.find({ sessionId: { $in: sessionIds } })
    .sort({ sessionId: 1, sequence: 1 })
    .lean()
    .exec();
  const annotatedById = new Map(annotateTurnsWithTokenUsage(sessionTurns)
    .map((turn) => [String(turn._id || turn.id || ''), turn]));

  return turns.map((turn) => {
    const annotated = annotatedById.get(String(turn._id || turn.id || ''));
    return annotated || annotateTurnsWithTokenUsage([turn])[0];
  });
}

async function getDashboardStats(options = {}) {
  const pricing = options.pricingByProvider || options.pricing || await getTokenPricingByProvider();
  const currentMonthStart = startOfMonth(new Date());
  const oldestStart = addMonths(currentMonthStart, -2);
  const nextMonthStart = addMonths(currentMonthStart, 1);
  const monthSeeds = [0, -1, -2].map((offset) => {
    const start = addMonths(currentMonthStart, offset);
    return {
      key: monthKey(start),
      label: monthLabel(start),
      start,
      end: addMonths(start, 1),
    };
  });
  const monthBuckets = new Map(monthSeeds.map((seed) => [seed.key, createActivityBucket(seed)]));
  const summaryBucket = createActivityBucket({
    key: 'last_3_months',
    label: `${monthSeeds[2].label} - ${monthSeeds[0].label}`,
    start: oldestStart,
    end: nextMonthStart,
  });

  const [turns, sessions, workspaces] = await Promise.all([
    CodexTurn.find({
      $or: [
        { startedAt: { $gte: oldestStart, $lt: nextMonthStart } },
        { startedAt: null, queuedAt: { $gte: oldestStart, $lt: nextMonthStart } },
        { startedAt: { $exists: false }, queuedAt: { $gte: oldestStart, $lt: nextMonthStart } },
        { startedAt: null, queuedAt: null, createdAt: { $gte: oldestStart, $lt: nextMonthStart } },
      ],
    }).lean().exec(),
    CodexSession.find({ createdAt: { $gte: oldestStart, $lt: nextMonthStart } }).lean().exec(),
    CodexWorkspace.find({}).lean().exec(),
  ]);

  const workspaceById = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));
  const workspaceBuckets = new Map();
  const getWorkspaceBucket = (workspaceId) => {
    const id = String(workspaceId || '');
    if (!workspaceBuckets.has(id)) {
      const workspace = workspaceById.get(id);
      workspaceBuckets.set(id, createActivityBucket({
        key: id,
        label: workspace ? workspace.name : 'Unknown workspace',
      }));
    }
    return workspaceBuckets.get(id);
  };

  sessions.forEach((session) => {
    const createdAt = session.createdAt ? new Date(session.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return;
    }
    const key = monthKey(createdAt);
    const monthBucket = monthBuckets.get(key);
    if (monthBucket) {
      recordSessionInBucket(monthBucket, session);
    }
    recordSessionInBucket(summaryBucket, session);
    recordSessionInBucket(getWorkspaceBucket(session.workspaceId), session);
  });

  const usageTurns = await annotatePeriodTurnsWithUsageDeltas(turns);
  usageTurns.forEach((turn) => {
    const startedAt = getTurnStartedDate(turn);
    const startedDate = startedAt ? new Date(startedAt) : null;
    if (!startedDate || Number.isNaN(startedDate.getTime())) {
      return;
    }
    const key = monthKey(startedDate);
    const monthBucket = monthBuckets.get(key);
    if (monthBucket) {
      recordTurnInBucket(monthBucket, turn, pricing);
    }
    recordTurnInBucket(summaryBucket, turn, pricing);
    recordTurnInBucket(getWorkspaceBucket(turn.workspaceId), turn, pricing);
  });

  const workspaceActivity = Array.from(workspaceBuckets.entries())
    .map(([workspaceId, bucket]) => {
      const stats = finalizeActivityBucket(bucket, pricing);
      const workspace = workspaceById.get(workspaceId);
      return {
        ...stats,
        workspaceId,
        workspaceName: workspace ? workspace.name : stats.label,
        rootPath: workspace ? workspace.rootPath : '',
      };
    })
    .filter((workspace) => workspace.turnCount || workspace.sessionCount)
    .sort((a, b) => b.tokens.total - a.tokens.total || b.turnCount - a.turnCount || a.workspaceName.localeCompare(b.workspaceName))
    .slice(0, 12);

  return {
    period: {
      start: oldestStart,
      end: nextMonthStart,
      label: summaryBucket.label,
    },
    summary: finalizeActivityBucket(summaryBucket, pricing),
    months: monthSeeds.map((seed) => finalizeActivityBucket(monthBuckets.get(seed.key), pricing)),
    workspaceActivity,
  };
}

async function getDashboardState(options = {}) {
  await ensureDefaultData();
  const [workspaces, queuedTurns, runningTurns, sessions, pricingByProvider, requestProfiles, config] = await Promise.all([
    listWorkspaces(),
    CodexTurn.find({ status: 'queued' }).sort({ queuedAt: 1 }).limit(20).lean().exec(),
    CodexTurn.find({ status: 'running' }).sort({ startedAt: 1 }).limit(20).lean().exec(),
    listSessions({ limit: 12 }),
    getTokenPricingByProvider(),
    listRequestProfiles(),
    publicConfig(options),
  ]);
  const stats = await getDashboardStats({ pricingByProvider });
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  return {
    config,
    pricing: pricingByProvider.openai,
    pricingByProvider,
    stats,
    workspaces,
    queuedTurns: queuedTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)), pricingByProvider })),
    runningTurns: runningTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)), pricingByProvider })),
    recentSessions: sessions,
    requestProfiles,
  };
}

async function getSessionDetail(sessionId, options = {}) {
  const session = await CodexSession.findById(sessionId).lean().exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  const [workspace, target, turns, pricingByProvider, requestProfiles, config] = await Promise.all([
    CodexWorkspace.findById(session.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(session.targetId).lean().exec(),
    CodexTurn.find({ sessionId }).sort({ sequence: 1 }).lean().exec(),
    getTokenPricingByProvider(),
    listRequestProfiles(),
    publicConfig(options),
  ]);
  const turnsWithUsage = annotateTurnsWithTokenUsage(turns);
  return {
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    turns: turnsWithUsage.map((turn) => serializeTurn(turn, { workspace, pricingByProvider })),
    stats: buildSessionStats(turnsWithUsage, pricingByProvider),
    pricing: pricingByProvider.openai,
    pricingByProvider,
    config,
    requestProfiles,
  };
}

async function getTurnDetail(turnId, options = {}) {
  const turn = await CodexTurn.findById(turnId).lean().exec();
  if (!turn) {
    throw createHttpError(404, 'Turn not found.');
  }
  const canAddMessagePromise = canSteerTurn(turn, options.user).catch((error) => {
    logger.error('Codex turn message availability lookup failed', {
      category: 'authorization',
      metadata: {
        turnId: String(turn._id),
        errorName: error?.name || 'Error',
      },
    });
    return false;
  });
  const [session, workspace, target, pricingByProvider, sessionTurns, config, canAddMessage] = await Promise.all([
    CodexSession.findById(turn.sessionId).lean().exec(),
    CodexWorkspace.findById(turn.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(turn.targetId).lean().exec(),
    getTokenPricingByProvider(),
    CodexTurn.find({ sessionId: turn.sessionId }).sort({ sequence: 1 }).lean().exec(),
    publicConfig(options),
    canAddMessagePromise,
  ]);
  const turnsWithUsage = annotateTurnsWithTokenUsage(sessionTurns.length ? sessionTurns : [turn]);
  const turnWithUsage = turnsWithUsage.find((entry) => String(entry._id) === String(turn._id)) ||
    annotateTurnsWithTokenUsage([turn])[0];
  const serializedTurn = serializeTurn(turnWithUsage, { workspace, pricingByProvider });
  serializedTurn.canAddMessage = canAddMessage;
  return {
    turn: serializedTurn,
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    pricing: pricingByProvider.openai,
    pricingByProvider,
    config,
  };
}

async function listTurnEvents(turnId, options = {}) {
  const afterSeq = Math.max(Number.parseInt(options.afterSeq, 10) || 0, 0);
  const query = {
    turnId,
    seq: { $gt: afterSeq },
  };
  if (options.user && options.user.type_user !== 'admin') {
    const principalId = getPrincipalId(options.user);
    query.$or = [
      { 'payload.item.type': { $ne: 'user_message' } },
    ];
    if (principalId) {
      query.$or.push({ 'payload.ownerId': principalId });
    }
  }
  const eventQuery = CodexEvent.find(query).sort({ seq: 1 });
  const requestedLimit = options.limit;
  const hasLimit = requestedLimit !== undefined &&
    requestedLimit !== null &&
    String(requestedLimit).trim() !== '' &&
    String(requestedLimit).trim().toLowerCase() !== 'all';
  if (hasLimit) {
    const config = getRuntimeConfig();
    const parsedLimit = Number.parseInt(requestedLimit, 10);
    const limit = Math.max(1, Math.min(parsedLimit || 100, config.maxEventsPerTurn));
    eventQuery.limit(limit);
  }
  const events = await eventQuery.lean().exec();
  return events.map(serializeEvent);
}

async function getQueueState() {
  await ensureDefaultData();
  const [queuedTurns, runningTurns, locks, workspaces] = await Promise.all([
    CodexTurn.find({ status: 'queued' }).sort({ queuedAt: 1 }).limit(50).lean().exec(),
    CodexTurn.find({ status: 'running' }).sort({ startedAt: 1 }).limit(50).lean().exec(),
    CodexWorkspaceLock.find({}).sort({ acquiredAt: 1 }).lean().exec(),
    CodexWorkspace.find({}).lean().exec(),
  ]);
  const workspaceById = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));
  return {
    queuedTurns: queuedTurns.map((turn, index) => serializeTurn(turn, {
      workspace: workspaceById.get(String(turn.workspaceId)),
      queuePosition: index + 1,
    })),
    runningTurns: runningTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)) })),
    locks: locks.map(serializeLock),
  };
}

async function queueAdditionalTurnMessage(turnIdInput, payload = {}, user) {
  const turnId = normalizeOptionalString(turnIdInput, 160);
  if (!turnId) {
    throw createHttpError(400, 'Turn id is required.');
  }
  await assertCanSteerCodexTurns(user);

  const scope = buildSteerTurnScope(turnId, user);
  const turn = await CodexTurn.findOne(scope).lean().exec();
  if (!turn) {
    throw createHttpError(404, 'Turn not found.');
  }
  if (turn.status !== 'running' || turn.cancelRequestedAt) {
    throw createHttpError(409, 'Additional messages can only be sent while the Codex turn is running.');
  }
  const message = normalizeAdditionalTurnMessagePayload(payload);

  const config = getRuntimeConfig();
  if (Number(turn.additionalMessageCount) >= config.maxAdditionalMessagesPerTurn) {
    throw createHttpError(
      429,
      `This turn has reached its limit of ${config.maxAdditionalMessagesPerTurn} additional messages.`
    );
  }

  const reservedTurn = await CodexTurn.findOneAndUpdate({
    ...scope,
    status: 'running',
    cancelRequestedAt: null,
    $or: [
      { additionalMessageCount: { $lt: config.maxAdditionalMessagesPerTurn } },
      { additionalMessageCount: { $exists: false } },
    ],
  }, {
    $inc: { additionalMessageCount: 1 },
  }, { returnDocument: 'after' }).exec();
  if (!reservedTurn) {
    throw createHttpError(409, 'The Codex turn is no longer accepting additional messages.');
  }

  let queuedMessage;
  try {
    queuedMessage = await CodexTurnMessage.create({
      turnId,
      sessionId: String(turn.sessionId),
      workspaceId: String(turn.workspaceId),
      message,
      status: 'queued',
      createdBy: makeOwner(user),
      queuedAt: new Date(),
    });
  } catch (error) {
    await CodexTurn.updateOne(
      { _id: turnId, additionalMessageCount: { $gt: 0 } },
      { $inc: { additionalMessageCount: -1 } }
    ).exec().catch(() => {});
    logger.error('Codex additional message could not be queued', {
      category: 'codex_tool',
      metadata: {
        turnId,
        errorName: error?.name || 'Error',
      },
    });
    throw createHttpError(500, 'The additional message could not be queued.');
  }

  const turnStillAccepting = await CodexTurn.exists({
    ...scope,
    status: 'running',
    cancelRequestedAt: null,
  }).exec();
  if (!turnStillAccepting) {
    const failedMessage = await CodexTurnMessage.findOneAndUpdate({
      _id: queuedMessage._id,
      status: 'queued',
    }, {
      $set: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: 'The Codex turn ended before this message could be delivered.',
      },
    }, { returnDocument: 'after' }).exec();
    if (failedMessage) {
      await CodexTurn.updateOne(
        { _id: turnId, additionalMessageCount: { $gt: 0 } },
        { $inc: { additionalMessageCount: -1 } }
      ).exec().catch(() => {});
      throw createHttpError(409, 'The Codex turn is no longer accepting additional messages.');
    }
  }

  return {
    accepted: true,
    message: {
      id: String(queuedMessage._id),
      status: queuedMessage.status || 'queued',
      queuedAt: queuedMessage.queuedAt || queuedMessage.createdAt || null,
    },
  };
}

async function cancelTurn(turnId) {
  const turn = await CodexTurn.findById(turnId).exec();
  if (!turn) {
    throw createHttpError(404, 'Turn not found.');
  }
  if (turn.status === 'queued') {
    turn.status = 'cancelled';
    turn.completedAt = new Date();
    turn.errorMessage = 'Cancelled before Codex started.';
    await turn.save();
    await updateSessionAfterTurn(turn);
    return serializeTurn(turn);
  }
  if (turn.status === 'running') {
    if (!turn.cancelRequestedAt) {
      turn.cancelRequestedAt = new Date();
      turn.errorMessage = 'Cancellation requested.';
      await turn.save();
    }
    return serializeTurn(turn);
  }
  throw createHttpError(409, 'Only queued or running turns can be cancelled.');
}

async function retryTurn(turnId, user) {
  const originalTurn = await CodexTurn.findById(turnId).lean().exec();
  if (!originalTurn) {
    throw createHttpError(404, 'Turn not found.');
  }
  if (!TERMINAL_TURN_STATUSES.has(originalTurn.status)) {
    throw createHttpError(409, 'Only completed turns can be retried.');
  }

  const session = await CodexSession.findById(originalTurn.sessionId).exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  if (session.status === 'archived') {
    throw createHttpError(409, 'Archived sessions cannot be retried.');
  }

  const { workspace, target } = await getWorkspaceBundle(originalTurn.workspaceId, { validateRemoteDirectory: false });
  const originalProvider = getTurnModelProvider(originalTurn);
  await assertRunpodModelProviderAuthorized(originalProvider, user);
  await assertModelProviderAvailable(originalProvider);
  if (originalTurn.kind.startsWith('followup_') && !session.codexThreadId) {
    throw createHttpError(409, 'Follow-up retry is unavailable because this session has no Codex session id.');
  }

  const requestedMode = originalTurn.kind.includes('action') ? 'action' : 'question';
  const permission = resolvePermissionMode({
    mode: requestedMode,
    requestedPermissionMode: originalTurn.permissionMode,
    workspace,
    confirmYolo: originalTurn.yolo,
  });
  const sequence = await getNextSessionSequence(session._id);
  const turn = await CodexTurn.create({
    sessionId: session._id,
    workspaceId: workspace._id,
    targetId: target._id,
    sequence,
    kind: originalTurn.kind,
    status: 'queued',
    prompt: originalTurn.prompt,
    permissionMode: permission.permissionMode,
    yolo: permission.yolo,
    requestProfileId: originalTurn.requestProfileId || '',
    requestProfileName: originalTurn.requestProfileName || '',
    modelProvider: originalProvider,
    model: originalTurn.model || '',
    profile: originalTurn.profile || '',
    reasoningEffort: originalTurn.reasoningEffort || '',
    createdBy: makeOwner(user),
    queuedAt: new Date(),
  });

  session.lastTurnId = turn._id;
  session.turnCount = Math.max(session.turnCount || 0, sequence);
  session.modelProvider = originalProvider;
  session.model = originalTurn.model || '';
  await session.save();

  return {
    accepted: true,
    session: serializeSession(session, { workspace }),
    turn: serializeTurn(turn, { workspace }),
    statusUrl: `/codex/turns/${encodeURIComponent(turn._id)}`,
  };
}

async function archiveSession(sessionId) {
  const session = await CodexSession.findById(sessionId).exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  session.status = 'archived';
  session.archivedAt = new Date();
  await session.save();
  return serializeSession(session);
}

async function updateSessionAfterTurn(turnInput) {
  const turn = turnInput && turnInput.toObject ? turnInput.toObject() : turnInput;
  if (!turn || !turn.sessionId) {
    return null;
  }

  const session = await CodexSession.findById(turn.sessionId).exec();
  if (!session) {
    return null;
  }
  if (turn.codexThreadIdSeen && !session.codexThreadId) {
    session.codexThreadId = turn.codexThreadIdSeen;
  }
  session.modelProvider = getTurnModelProvider(turn);
  session.model = turn.model || session.model || '';

  if (String(session.firstTurnId) === String(turn._id)) {
    if (turn.status === 'succeeded') {
      session.status = 'active';
    } else if (TERMINAL_TURN_STATUSES.has(turn.status) && session.status !== 'archived') {
      session.status = session.codexThreadId ? 'active' : 'failed';
    }
  } else if (turn.status === 'succeeded' && session.status !== 'archived') {
    session.status = 'active';
  }

  session.lastTurnId = turn._id;
  if (turn.finalResponse) {
    session.lastResponsePreview = previewFromText(turn.finalResponse);
  }
  await session.save();
  return session;
}

async function getHealth(workerStatus, options = {}) {
  await ensureDefaultData();
  const config = getRuntimeConfig();
  const [workspaceCount, queuedCount, runningCount, staleLockCount] = await Promise.all([
    CodexWorkspace.countDocuments({ enabled: true }).exec(),
    CodexTurn.countDocuments({ status: 'queued' }).exec(),
    CodexTurn.countDocuments({ status: 'running' }).exec(),
    CodexWorkspaceLock.countDocuments({ expiresAt: { $lte: new Date() } }).exec(),
  ]);

  const binary = {
    path: config.binaryPath,
    available: false,
    version: '',
    error: '',
  };
  try {
    const result = await execFileAsync(config.binaryPath, ['--version'], { timeout: 5000 });
    binary.available = true;
    binary.version = String(result.stdout || result.stderr || '').trim();
  } catch (error) {
    binary.error = error.message;
  }

  return {
    ok: binary.available,
    binary,
    worker: workerStatus || null,
    queuedCount,
    runningCount,
    staleLockCount,
    workspaceCount,
    config: await publicConfig(options),
  };
}

async function publicConfig(options = {}) {
  const config = getRuntimeConfig();
  const localModelOptions = await getLocalModelOptions();
  const modelProviderOptions = await getAvailableModelProviderOptions({
    user: options.user,
    localModelOptions,
  });
  return {
    workerEnabled: config.workerEnabled,
    globalConcurrency: config.globalConcurrency,
    timeoutMs: config.timeoutMs,
    maxPromptChars: config.maxPromptChars,
    yoloEnabled: config.yoloEnabled,
    reasoningEfforts: REASONING_EFFORT_OPTIONS,
    codexModelOptions: CODEX_MODEL_OPTIONS,
    localModelOptions,
    modelProviderOptions,
  };
}

function serializeTarget(target) {
  if (!target) {
    return null;
  }
  return {
    id: String(target._id),
    name: target.name || '',
    type: target.type || '',
    platform: target.platform || '',
    enabled: Boolean(target.enabled),
    description: target.description || '',
    createdAt: target.createdAt || null,
    updatedAt: target.updatedAt || null,
  };
}

function serializeWorkspace(workspace, extras = {}) {
  if (!workspace) {
    return null;
  }
  return {
    id: String(workspace._id),
    targetId: String(workspace.targetId || ''),
    target: extras.target ? serializeTarget(extras.target) : null,
    name: workspace.name || '',
    rootPath: workspace.rootPath || '',
    pathStyle: workspace.pathStyle || 'posix',
    enabled: Boolean(workspace.enabled),
    description: workspace.description || '',
    defaultModel: workspace.defaultModel || '',
    defaultProfile: workspace.defaultProfile || '',
    defaultQuestionPermission: workspace.defaultQuestionPermission || 'read-only',
    defaultActionPermission: workspace.defaultActionPermission || 'workspace-write',
    allowYolo: Boolean(workspace.allowYolo),
    maxConcurrentTurns: workspace.maxConcurrentTurns || 1,
    createdAt: workspace.createdAt || null,
    updatedAt: workspace.updatedAt || null,
  };
}

function serializeSession(session, extras = {}) {
  if (!session) {
    return null;
  }
  const modelProvider = getTurnModelProvider(session);
  return {
    id: String(session._id),
    workspaceId: String(session.workspaceId || ''),
    workspace: extras.workspace ? serializeWorkspace(extras.workspace, { target: extras.target }) : null,
    targetId: String(session.targetId || ''),
    codexThreadId: session.codexThreadId || '',
    modelProvider,
    modelProviderLabel: getModelProviderLabel(modelProvider),
    usageProvider: getUsageModelProvider(modelProvider),
    runpodBacked: isRunpodModelProvider(modelProvider),
    model: session.model || '',
    title: session.title || '',
    summary: session.summary || '',
    status: session.status || 'pending',
    createdBy: session.createdBy || {},
    firstTurnId: session.firstTurnId || '',
    lastTurnId: session.lastTurnId || '',
    lastResponsePreview: session.lastResponsePreview || '',
    turnCount: session.turnCount || 0,
    archivedAt: session.archivedAt || null,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
  };
}

function serializeTurn(turn, extras = {}) {
  if (!turn) {
    return null;
  }
  const sessionTokenUsage = turn.sessionTokenUsage
    ? normalizeTokenUsage(turn.sessionTokenUsage)
    : normalizeTokenUsage(turn.usage || {});
  const tokenUsage = getTurnTokenUsage(turn);
  const modelProvider = getTurnModelProvider(turn);
  const usageProvider = getUsageModelProvider(modelProvider);
  const pricingInput = extras.pricingByProvider || extras.pricing;
  const costEstimate = pricingInput
    ? estimateTokenCost(tokenUsage, getPricingForProvider(pricingInput, modelProvider))
    : null;
  return {
    id: String(turn._id),
    sessionId: String(turn.sessionId || ''),
    workspaceId: String(turn.workspaceId || ''),
    workspace: extras.workspace || null,
    targetId: String(turn.targetId || ''),
    sequence: turn.sequence || 0,
    kind: turn.kind || '',
    status: turn.status || '',
    prompt: turn.prompt || '',
    finalResponse: turn.finalResponse || '',
    responsePreview: turn.responsePreview || '',
    permissionMode: turn.permissionMode || 'read-only',
    yolo: Boolean(turn.yolo),
    requestProfileId: turn.requestProfileId || '',
    requestProfileName: turn.requestProfileName || '',
    modelProvider,
    modelProviderLabel: getModelProviderLabel(modelProvider),
    usageProvider,
    runpodBacked: isRunpodModelProvider(modelProvider),
    model: turn.model || '',
    profile: turn.profile || '',
    reasoningEffort: turn.reasoningEffort || '',
    codexThreadIdSeen: turn.codexThreadIdSeen || '',
    commandSummary: turn.commandSummary || {},
    exitCode: turn.exitCode,
    exitSignal: turn.exitSignal || '',
    errorMessage: turn.errorMessage || '',
    usage: turn.usage || {},
    sessionTokenUsage,
    tokenUsage,
    costEstimate,
    eventCount: turn.eventCount || 0,
    artifactRefs: turn.artifactRefs || [],
    createdBy: turn.createdBy || {},
    queuedAt: turn.queuedAt || null,
    startedAt: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    durationMs: turn.durationMs,
    cancelRequestedAt: turn.cancelRequestedAt || null,
    createdAt: turn.createdAt || null,
    updatedAt: turn.updatedAt || null,
    queuePosition: extras.queuePosition || null,
  };
}

function serializeEvent(event) {
  if (!event) {
    return null;
  }
  return {
    id: String(event._id),
    turnId: String(event.turnId || ''),
    sessionId: String(event.sessionId || ''),
    workspaceId: String(event.workspaceId || ''),
    seq: event.seq || 0,
    eventType: event.eventType || '',
    stream: event.stream || '',
    payload: event.payload || {},
    text: event.text || '',
    severity: event.severity || 'info',
    hiddenByDefault: event.hiddenByDefault !== false,
    createdAt: event.createdAt || null,
  };
}

function serializeLock(lock) {
  if (!lock) {
    return null;
  }
  return {
    id: String(lock._id),
    workspaceId: String(lock.workspaceId || ''),
    turnId: String(lock.turnId || ''),
    workerId: lock.workerId || '',
    acquiredAt: lock.acquiredAt || null,
    heartbeatAt: lock.heartbeatAt || null,
    expiresAt: lock.expiresAt || null,
  };
}

async function logServiceWarning(message, metadata) {
  try {
    await logger.warning(message, { category: 'codex_tool', metadata });
  } catch (_error) {
    // Logger failures should not make a user request fail.
  }
}

module.exports = {
  ACTIVE_TURN_STATUSES,
  MODEL_PROVIDERS,
  TERMINAL_TURN_STATUSES,
  annotateTurnsWithTokenUsage,
  archiveSession,
  assertModelProviderAvailable,
  buildSessionStats,
  canSteerCodexTurns,
  canUseRunpodModelProviders,
  cancelTurn,
  createFollowupTurn,
  createHttpError,
  createPromptTemplate,
  createRequestProfile,
  createSession,
  createWorkspace,
  deletePromptTemplate,
  deleteWorkspace,
  disableRequestProfile,
  ensureDefaultData,
  estimateTokenCost,
  getDashboardState,
  getDashboardStats,
  getHealth,
  getModelProviderCodexProfile,
  getModelProviderLabel,
  getQueueState,
  getRuntimeConfig,
  getSessionDetail,
  getTokenPricing,
  getTokenPricingByProvider,
  getTurnModelProvider,
  getUsageModelProvider,
  getTurnDetail,
  getWorkspaceBundle,
  ensureCodexWorkspaceLockIndexes,
  isWorkspaceLockConflictError,
  listSessions,
  listPromptTemplates,
  listRequestProfiles,
  listTargets,
  listTurnEvents,
  listWorkspaces,
  logServiceWarning,
  modelProviderNeedsProfileEnvironment,
  normalizeTokenUsage,
  previewFromText,
  publicConfig,
  queueAdditionalTurnMessage,
  resolveTurnRequestOptions,
  retryTurn,
  serializeEvent,
  serializeLock,
  serializePromptTemplate,
  serializeSession,
  serializeTarget,
  serializeTurn,
  serializeWorkspace,
  updateTokenPricing,
  updatePromptTemplate,
  updateRequestProfile,
  updateSessionAfterTurn,
  updateWorkspace,
};
