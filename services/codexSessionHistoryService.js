const CodexSession = require('../models/codex_session');
const CodexWorkspace = require('../models/codex_workspace');
const Role = require('../models/role');
const { hasCapabilities } = require('../utils/authorization');
const { CODEX_CAPABILITIES, CODEX_ROLE_CAPABILITY_BUNDLES } = require('../utils/codexAuthorizationPolicy');

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseHistoryQuery(input = {}) {
  const allowed = ['page', 'limit', 'status', 'workspaceId', 'search'];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw invalid('Invalid history query.');
  }
  function integer(key, fallback, maximum) {
    if (input[key] === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(input[key]) || Number(input[key]) > maximum) {
      throw invalid(`Invalid ${key}.`);
    }
    return Number(input[key]);
  }
  const status = input.status || 'recent';
  if (!['recent', 'all', 'pending', 'active', 'failed', 'archived'].includes(status)) {
    throw invalid('Invalid session status.');
  }
  const workspaceId = (input.workspaceId || '').trim();
  const search = (input.search || '').trim();
  if ((input.workspaceId || '').length > 160 || (input.search || '').length > 100) {
    throw invalid('History filter is too long.');
  }
  return { page: integer('page', 1, 10000), limit: integer('limit', 12, 24), status, workspaceId, search };
}

async function listSessionHistory(input, user) {
  const allowed = await hasCapabilities(user, [CODEX_CAPABILITIES.sessionRead], {
    roleModel: Role,
    roleCapabilityBundles: CODEX_ROLE_CAPABILITY_BUNDLES,
  });
  const principalId = String(user?._id || user?.id || '');
  if (!allowed || !principalId) {
    throw Object.assign(new Error('Session history access is required.'), { statusCode: 403 });
  }
  const filters = parseHistoryQuery(input);
  const { page, limit, status, workspaceId, search } = filters;
  const match = user.type_user === 'admin' ? {} : { 'createdBy.id': principalId };
  if (status === 'recent') match.status = { $ne: 'archived' };
  else if (status !== 'all') match.status = status;
  if (workspaceId) match.workspaceId = workspaceId;
  if (search) match.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [result] = await CodexSession.aggregate([
    { $match: match },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $facet: {
      rows: [
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { title: 1, workspaceId: 1, status: 1, updatedAt: 1, createdAt: 1, lastResponsePreview: 1 } },
      ],
      count: [{ $count: 'total' }],
    } },
  ]).option({ maxTimeMS: 3000 }).exec();
  const rows = result?.rows || [];
  const total = result?.count?.[0]?.total || 0;
  const workspaces = rows.length ? await CodexWorkspace.find({
    _id: { $in: [...new Set(rows.map((row) => row.workspaceId))] },
  }).select({ name: 1 }).maxTimeMS(3000).lean().exec() : [];
  const names = new Map(workspaces.map((workspace) => [String(workspace._id), workspace.name]));
  return {
    sessions: rows.map((row) => ({
      id: String(row._id), title: row.title, status: row.status,
      workspaceId: row.workspaceId, workspace: { name: names.get(String(row.workspaceId)) || 'Unavailable workspace' },
      updatedAt: row.updatedAt, createdAt: row.createdAt, lastResponsePreview: row.lastResponsePreview,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNext: page * limit < total },
  };
}

module.exports = { listSessionHistory, parseHistoryQuery };
