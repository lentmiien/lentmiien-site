const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const CodexExecutionTarget = require('../models/codex_execution_target');
const CodexWorkspace = require('../models/codex_workspace');
const CodexSession = require('../models/codex_session');
const CodexTurn = require('../models/codex_turn');
const CodexEvent = require('../models/codex_event');
const CodexWorkspaceLock = require('../models/codex_workspace_lock');
const CodexTokenPrice = require('../models/codex_token_price');
const logger = require('../utils/logger');
const {
  buildRemoteShellCommand,
  buildSshArgs,
  getSshBinary,
  quotePosixShellArg,
} = require('./codexSsh');

const execFileAsync = promisify(execFile);

const TERMINAL_TURN_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'blocked']);
const ACTIVE_TURN_STATUSES = ['queued', 'running'];
const VALID_MODES = new Set(['question', 'action']);
const VALID_PERMISSION_MODES = new Set(['read-only', 'workspace-write', 'yolo']);
const CODEX_THREAD_INDEX_NAME = 'codexThreadId_1';
const DEFAULT_TOKEN_PRICE_ID = 'default';
const TOKEN_TYPES = ['input', 'cached', 'output', 'reasoning'];
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

function addTokenUsage(target, usage) {
  const normalized = normalizeTokenUsage(usage);
  TOKEN_TYPES.forEach((type) => {
    target[type] = (target[type] || 0) + normalized[type];
  });
  target.total = (target.total || 0) + normalized.total;
  return target;
}

function serializeTokenPricing(pricing) {
  const prices = pricing && pricing.prices ? pricing.prices : {};
  return {
    id: pricing && pricing._id ? String(pricing._id) : DEFAULT_TOKEN_PRICE_ID,
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
  const pricing = serializeTokenPricing(pricingInput);
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
    currency: pricing.currency,
    unitTokens,
    billableTokens,
    breakdown,
    total,
  };
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
    cost: 0,
    kindMap: new Map(),
    statusMap: new Map(),
    modelMap: new Map(),
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
}

function recordTurnInBucket(bucket, turn, pricing) {
  if (!bucket || !turn) {
    return;
  }
  bucket.turnCount += 1;
  const tokens = normalizeTokenUsage(turn.usage);
  addTokenUsage(bucket.tokenTotals, tokens);
  bucket.tokenValues.push(tokens.total);
  bucket.cost += estimateTokenCost(tokens, pricing).total;

  const status = turn.status || 'unknown';
  incrementMap(bucket.statusMap, status);
  incrementMap(bucket.kindMap, turn.kind || 'unknown');
  incrementMap(bucket.modelMap, turn.model || 'default');
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
  const tokenCost = estimateTokenCost(bucket.tokenTotals, pricing);
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
    cost: tokenCost.total,
    costBreakdown: tokenCost.breakdown,
    kindDistribution: serializeDistribution(bucket.kindMap, bucket.turnCount, KIND_LABELS),
    statusDistribution: serializeDistribution(bucket.statusMap, bucket.turnCount, TERMINAL_STATUS_LABELS),
    modelDistribution: serializeDistribution(bucket.modelMap, bucket.turnCount),
    busiestDay: getTopDay(bucket.dayMap),
    lastStartedAt: bucket.lastStartedAt,
  };
}

function getRuntimeConfig() {
  return {
    binaryPath: process.env.CODEX_BINARY_PATH || process.env.CODEX_BINARY || 'codex',
    workerEnabled: getBooleanEnv('CODEX_WORKER_ENABLED', true),
    globalConcurrency: getPositiveIntegerEnv('CODEX_GLOBAL_CONCURRENCY', 1, 1, 8),
    pollIntervalMs: getPositiveIntegerEnv('CODEX_WORKER_POLL_MS', 5000, 1000, 60000),
    timeoutMs: getPositiveIntegerEnv('CODEX_TIMEOUT_MS', 60 * 60 * 1000, 30 * 1000),
    lockTtlMs: getPositiveIntegerEnv('CODEX_LOCK_TTL_MS', 5 * 60 * 1000, 60 * 1000),
    heartbeatMs: getPositiveIntegerEnv('CODEX_LOCK_HEARTBEAT_MS', 15 * 1000, 2000),
    maxPromptChars: getPositiveIntegerEnv('CODEX_MAX_PROMPT_CHARS', 20000, 1000, 500000),
    maxEventsPerTurn: getPositiveIntegerEnv('CODEX_MAX_EVENTS_PER_TURN', 1000, 20, 100000),
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

function makeOwner(user) {
  return {
    id: user && user._id ? String(user._id) : null,
    name: user && user.name ? String(user.name) : '',
  };
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
    throw createHttpError(400, 'Mode must be either question or action.');
  }
  return normalized;
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
  const permissionMode = requested === 'auto'
    ? (mode === 'action'
      ? workspace.defaultActionPermission || 'workspace-write'
      : workspace.defaultQuestionPermission || 'read-only')
    : requested;

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

async function ensureDefaultData() {
  if (defaultDataPromise) {
    return defaultDataPromise;
  }

  defaultDataPromise = (async () => {
    await ensureCodexSessionIndexes();

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
  const model = normalizeOptionalString(payload.model || workspace.defaultModel);
  const profile = normalizeOptionalString(payload.profile || workspace.defaultProfile);
  const owner = makeOwner(user);

  const session = await CodexSession.create({
    workspaceId: workspace._id,
    targetId: target._id,
    title: titleFromPrompt(prompt),
    status: 'pending',
    createdBy: owner,
    turnCount: 0,
  });

  const turn = await CodexTurn.create({
    sessionId: session._id,
    workspaceId: workspace._id,
    targetId: target._id,
    sequence: 1,
    kind: mode,
    status: 'queued',
    prompt,
    permissionMode: permission.permissionMode,
    yolo: permission.yolo,
    model,
    profile,
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
  const kind = mode === 'action' ? 'followup_action' : 'followup_question';

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
    model: normalizeOptionalString(payload.model || workspace.defaultModel),
    profile: normalizeOptionalString(payload.profile || workspace.defaultProfile),
    createdBy: owner,
    queuedAt: new Date(),
  });

  session.lastTurnId = turn._id;
  session.turnCount = Math.max(session.turnCount || 0, sequence);
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

async function getTokenPricing() {
  const pricing = await CodexTokenPrice.findById(DEFAULT_TOKEN_PRICE_ID).lean().exec();
  return serializeTokenPricing(pricing);
}

async function updateTokenPricing(payload = {}, user) {
  const normalized = normalizeTokenPricingPayload(payload);
  const updatedBy = makeOwner(user);
  const pricing = await CodexTokenPrice.findByIdAndUpdate(
    DEFAULT_TOKEN_PRICE_ID,
    {
      $set: {
        ...normalized,
        updatedBy,
      },
      $setOnInsert: {
        _id: DEFAULT_TOKEN_PRICE_ID,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean().exec();
  return serializeTokenPricing(pricing);
}

function buildSessionStats(turns = [], pricing) {
  const bucket = createActivityBucket({ key: 'session', label: 'Session' });
  let firstStartedAt = null;
  let lastCompletedAt = null;

  turns.forEach((turn) => {
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

async function getDashboardStats(options = {}) {
  const pricing = options.pricing || await getTokenPricing();
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

  turns.forEach((turn) => {
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

async function getDashboardState() {
  await ensureDefaultData();
  const [workspaces, queuedTurns, runningTurns, sessions, pricing] = await Promise.all([
    listWorkspaces(),
    CodexTurn.find({ status: 'queued' }).sort({ queuedAt: 1 }).limit(20).lean().exec(),
    CodexTurn.find({ status: 'running' }).sort({ startedAt: 1 }).limit(20).lean().exec(),
    listSessions({ limit: 12 }),
    getTokenPricing(),
  ]);
  const stats = await getDashboardStats({ pricing });
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  return {
    config: publicConfig(),
    pricing,
    stats,
    workspaces,
    queuedTurns: queuedTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)), pricing })),
    runningTurns: runningTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)), pricing })),
    recentSessions: sessions,
  };
}

async function getSessionDetail(sessionId) {
  const session = await CodexSession.findById(sessionId).lean().exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  const [workspace, target, turns, pricing] = await Promise.all([
    CodexWorkspace.findById(session.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(session.targetId).lean().exec(),
    CodexTurn.find({ sessionId }).sort({ sequence: 1 }).lean().exec(),
    getTokenPricing(),
  ]);
  return {
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    turns: turns.map((turn) => serializeTurn(turn, { workspace, pricing })),
    stats: buildSessionStats(turns, pricing),
    pricing,
    config: publicConfig(),
  };
}

async function getTurnDetail(turnId) {
  const turn = await CodexTurn.findById(turnId).lean().exec();
  if (!turn) {
    throw createHttpError(404, 'Turn not found.');
  }
  const [session, workspace, target, pricing] = await Promise.all([
    CodexSession.findById(turn.sessionId).lean().exec(),
    CodexWorkspace.findById(turn.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(turn.targetId).lean().exec(),
    getTokenPricing(),
  ]);
  return {
    turn: serializeTurn(turn, { workspace, pricing }),
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    pricing,
    config: publicConfig(),
  };
}

async function listTurnEvents(turnId, options = {}) {
  const afterSeq = Math.max(Number.parseInt(options.afterSeq, 10) || 0, 0);
  const eventQuery = CodexEvent.find({
    turnId,
    seq: { $gt: afterSeq },
  }).sort({ seq: 1 });
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
    model: originalTurn.model || '',
    profile: originalTurn.profile || '',
    createdBy: makeOwner(user),
    queuedAt: new Date(),
  });

  session.lastTurnId = turn._id;
  session.turnCount = Math.max(session.turnCount || 0, sequence);
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

async function getHealth(workerStatus) {
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
    config: publicConfig(),
  };
}

function publicConfig() {
  const config = getRuntimeConfig();
  return {
    workerEnabled: config.workerEnabled,
    globalConcurrency: config.globalConcurrency,
    timeoutMs: config.timeoutMs,
    maxPromptChars: config.maxPromptChars,
    yoloEnabled: config.yoloEnabled,
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
  return {
    id: String(session._id),
    workspaceId: String(session.workspaceId || ''),
    workspace: extras.workspace ? serializeWorkspace(extras.workspace, { target: extras.target }) : null,
    targetId: String(session.targetId || ''),
    codexThreadId: session.codexThreadId || '',
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
  const tokenUsage = normalizeTokenUsage(turn.usage || {});
  const costEstimate = extras.pricing ? estimateTokenCost(tokenUsage, extras.pricing) : null;
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
    model: turn.model || '',
    profile: turn.profile || '',
    codexThreadIdSeen: turn.codexThreadIdSeen || '',
    commandSummary: turn.commandSummary || {},
    exitCode: turn.exitCode,
    exitSignal: turn.exitSignal || '',
    errorMessage: turn.errorMessage || '',
    usage: turn.usage || {},
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
  TERMINAL_TURN_STATUSES,
  archiveSession,
  cancelTurn,
  createFollowupTurn,
  createHttpError,
  createSession,
  createWorkspace,
  deleteWorkspace,
  ensureDefaultData,
  estimateTokenCost,
  getDashboardState,
  getDashboardStats,
  getHealth,
  getQueueState,
  getRuntimeConfig,
  getSessionDetail,
  getTokenPricing,
  getTurnDetail,
  getWorkspaceBundle,
  listSessions,
  listTargets,
  listTurnEvents,
  listWorkspaces,
  logServiceWarning,
  normalizeTokenUsage,
  previewFromText,
  publicConfig,
  retryTurn,
  serializeEvent,
  serializeLock,
  serializeSession,
  serializeTarget,
  serializeTurn,
  serializeWorkspace,
  updateTokenPricing,
  updateSessionAfterTurn,
  updateWorkspace,
};
