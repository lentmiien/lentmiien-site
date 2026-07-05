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
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

const TERMINAL_TURN_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'blocked']);
const ACTIVE_TURN_STATUSES = ['queued', 'running'];
const VALID_MODES = new Set(['question', 'action']);
const VALID_PERMISSION_MODES = new Set(['read-only', 'workspace-write', 'yolo']);

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

async function ensureDefaultData() {
  if (defaultDataPromise) {
    return defaultDataPromise;
  }

  defaultDataPromise = (async () => {
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

  if (String(target.type || '').startsWith('local-')) {
    const normalizedPath = path.resolve(workspace.rootPath);
    await assertLocalDirectory(normalizedPath);
    if (workspace.rootPath !== normalizedPath) {
      workspace.rootPath = normalizedPath;
      await workspace.save();
    }
  }

  return { workspace, target };
}

async function createSession(payload = {}, user) {
  const prompt = normalizePrompt(payload.prompt);
  const mode = normalizeMode(payload.mode);
  const { workspace, target } = await getWorkspaceBundle(payload.workspaceId);
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
  const { workspace, target } = await getWorkspaceBundle(session.workspaceId);
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

  const submittedRootPath = String(payload.rootPath || '').trim();
  if (!submittedRootPath) {
    throw createHttpError(400, 'Workspace root path is required.');
  }
  const rootPath = path.resolve(submittedRootPath);
  await assertLocalDirectory(rootPath);
  const localDefaults = getLocalTargetDefaults();

  const workspace = await CodexWorkspace.create({
    targetId: target._id,
    name,
    rootPath,
    pathStyle: payload.pathStyle || localDefaults.pathStyle,
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
    const submittedRootPath = String(payload.rootPath || '').trim();
    if (!submittedRootPath) {
      throw createHttpError(400, 'Workspace root path is required.');
    }
    const rootPath = path.resolve(submittedRootPath);
    await assertLocalDirectory(rootPath);
    workspace.rootPath = rootPath;
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

async function getDashboardState() {
  await ensureDefaultData();
  const [workspaces, queuedTurns, runningTurns, sessions] = await Promise.all([
    listWorkspaces(),
    CodexTurn.find({ status: 'queued' }).sort({ queuedAt: 1 }).limit(20).lean().exec(),
    CodexTurn.find({ status: 'running' }).sort({ startedAt: 1 }).limit(20).lean().exec(),
    listSessions({ limit: 12 }),
  ]);
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  return {
    config: publicConfig(),
    workspaces,
    queuedTurns: queuedTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)) })),
    runningTurns: runningTurns.map((turn) => serializeTurn(turn, { workspace: workspaceById.get(String(turn.workspaceId)) })),
    recentSessions: sessions,
  };
}

async function getSessionDetail(sessionId) {
  const session = await CodexSession.findById(sessionId).lean().exec();
  if (!session) {
    throw createHttpError(404, 'Session not found.');
  }
  const [workspace, target, turns] = await Promise.all([
    CodexWorkspace.findById(session.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(session.targetId).lean().exec(),
    CodexTurn.find({ sessionId }).sort({ sequence: 1 }).lean().exec(),
  ]);
  return {
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    turns: turns.map((turn) => serializeTurn(turn, { workspace })),
    config: publicConfig(),
  };
}

async function getTurnDetail(turnId) {
  const turn = await CodexTurn.findById(turnId).lean().exec();
  if (!turn) {
    throw createHttpError(404, 'Turn not found.');
  }
  const [session, workspace, target] = await Promise.all([
    CodexSession.findById(turn.sessionId).lean().exec(),
    CodexWorkspace.findById(turn.workspaceId).lean().exec(),
    CodexExecutionTarget.findById(turn.targetId).lean().exec(),
  ]);
  return {
    turn: serializeTurn(turn, { workspace }),
    session: serializeSession(session, { workspace, target }),
    workspace: serializeWorkspace(workspace, { target }),
    target: serializeTarget(target),
    config: publicConfig(),
  };
}

async function listTurnEvents(turnId, options = {}) {
  const afterSeq = Math.max(Number.parseInt(options.afterSeq, 10) || 0, 0);
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 100, 500));
  const events = await CodexEvent.find({
    turnId,
    seq: { $gt: afterSeq },
  }).sort({ seq: 1 }).limit(limit).lean().exec();
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

  const { workspace, target } = await getWorkspaceBundle(originalTurn.workspaceId);
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
  getDashboardState,
  getHealth,
  getQueueState,
  getRuntimeConfig,
  getSessionDetail,
  getTurnDetail,
  getWorkspaceBundle,
  listSessions,
  listTargets,
  listTurnEvents,
  listWorkspaces,
  logServiceWarning,
  previewFromText,
  publicConfig,
  retryTurn,
  serializeEvent,
  serializeLock,
  serializeSession,
  serializeTarget,
  serializeTurn,
  serializeWorkspace,
  updateSessionAfterTurn,
  updateWorkspace,
};
