const crypto = require('crypto');

const logger = require('../utils/logger');
const ApiRecordService = require('../services/apiRecordService');
const { ApiRecordModel } = require('../database');

const apiRecordService = new ApiRecordService(ApiRecordModel);
const { ApiRecordError } = ApiRecordService;

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function getConfiguredUsers() {
  return [
    { tier: 'tier2', userId: String(process.env.API_TIER2_USER_ID || '').trim() },
    { tier: 'tier1', userId: String(process.env.API_TIER1_USER_ID || '').trim() },
  ].filter((entry) => entry.userId.length > 0);
}

function readUserId(req) {
  const headerCandidates = [
    req.get('x-user-id'),
    req.get('x-userid'),
    req.get('user-id'),
  ];

  const requestObjectCandidates = [];
  if (req.query) {
    requestObjectCandidates.push(req.query.userId, req.query.user_id);
  }
  if (req.body && !Array.isArray(req.body)) {
    requestObjectCandidates.push(req.body.userId, req.body.user_id);
  }

  const firstValue = [...headerCandidates, ...requestObjectCandidates]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  return firstValue ? firstValue.trim() : '';
}

function handleControllerError(res, error, context) {
  if (error instanceof ApiRecordError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  logger.error(`API records ${context} failed`, {
    category: 'api-records',
    metadata: { error },
  });

  return res.status(500).json({
    success: false,
    code: 'internal_error',
    message: 'Internal server error.',
  });
}

function extractBatchEntries(body) {
  if (Array.isArray(body)) {
    return body;
  }

  if (!isPlainObject(body)) {
    return null;
  }

  if (Array.isArray(body.entries)) {
    return body.entries;
  }

  if (Array.isArray(body.data)) {
    return body.data;
  }

  const singleEntry = { ...body };
  delete singleEntry.userId;
  delete singleEntry.user_id;

  return Object.keys(singleEntry).length > 0 ? [singleEntry] : null;
}

function extractFetchFilters(req) {
  const filters = { ...(req.query || {}) };
  delete filters.userId;
  delete filters.user_id;
  return filters;
}

exports.requireApiRecordUser = (req, res, next) => {
  const configuredUsers = getConfiguredUsers();
  if (configuredUsers.length < 2) {
    return res.status(500).json({
      success: false,
      code: 'user_ids_not_configured',
      message: 'API tier user IDs are not configured.',
    });
  }

  const userId = readUserId(req);
  if (!userId) {
    return res.status(403).json({
      success: false,
      code: 'invalid_user_id',
      message: 'Invalid or missing user id.',
    });
  }

  const match = configuredUsers.find((entry) => timingSafeEqual(userId, entry.userId));
  if (!match) {
    return res.status(403).json({
      success: false,
      code: 'invalid_user_id',
      message: 'Invalid or missing user id.',
    });
  }

  req.apiRecordAccess = {
    userId: match.userId,
    tier: match.tier,
  };

  return next();
};

exports.upsertRecords = async (req, res) => {
  const entries = extractBatchEntries(req.body);
  if (!entries) {
    return res.status(400).json({
      success: false,
      code: 'invalid_payload',
      message: 'Expected a single entry object, an array of entries, or an object with an entries/data array.',
    });
  }

  try {
    const result = await apiRecordService.upsertBatch(entries, req.apiRecordAccess);
    const statusCode = result.summary.failed === 0
      ? 200
      : (result.summary.created > 0 || result.summary.updated > 0 ? 207 : 400);

    return res.status(statusCode).json({
      success: result.success,
      summary: result.summary,
      results: result.results,
    });
  } catch (error) {
    return handleControllerError(res, error, 'upsert');
  }
};

exports.fetchRecords = async (req, res) => {
  try {
    const result = await apiRecordService.fetchEntries(extractFetchFilters(req), req.apiRecordAccess);
    return res.json({
      success: true,
      count: result.count,
      data: result.data,
    });
  } catch (error) {
    return handleControllerError(res, error, 'fetch');
  }
};

exports.deleteRecord = async (req, res) => {
  try {
    const result = await apiRecordService.deleteEntry(req.params.id, req.apiRecordAccess);
    return res.json({
      success: true,
      message: 'Entry deleted successfully.',
      data: result,
    });
  } catch (error) {
    return handleControllerError(res, error, 'delete');
  }
};
