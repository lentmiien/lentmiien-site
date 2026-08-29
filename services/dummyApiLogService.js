const DummyApiRequestLog = require('../models/dummy_api_request_log');
const DummyApiEndpointSetting = require('../models/dummy_api_endpoint_setting');
const { sanitizePayload, sanitizeRequestUrl } = require('../utils/apiDebugLogger');

const DUMMY_API_SETTINGS_KEY = 'ok';
const DUMMY_API_LOG_LIMIT = 200;
const DUMMY_API_ENDPOINT_PATHS = [
  '/ok',
  '/fmi/data/{version}/databases/{database-name}/sessions',
  '/fmi/data/{version}/validateSession',
  '/fmi/data/{version}/databases/{database-name}/layouts/{layout-name}/records',
  '/fmi/data/{version}/databases/{database-name}/layouts/{layout-name}/records/{record-id}/containers/{field-name}/{field-repetition}',
];

function leanExec(query) {
  if (query && typeof query.lean === 'function') {
    const leanQuery = query.lean();
    if (leanQuery && typeof leanQuery.exec === 'function') {
      return leanQuery.exec();
    }
    return leanQuery;
  }

  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

function parseEnabled(value) {
  return value === true
    || value === 'true'
    || value === '1'
    || value === 'on'
    || value === 'enabled';
}

function normalizeSettings(raw = {}) {
  return {
    key: raw.key || DUMMY_API_SETTINGS_KEY,
    enabled: raw.enabled === true,
    updatedAt: raw.updatedAt || raw.createdAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

function getHeader(req, name) {
  if (req && typeof req.get === 'function') {
    return req.get(name) || null;
  }

  if (req && req.headers) {
    return req.headers[name.toLowerCase()] || null;
  }

  return null;
}

function serializeValue(value, depth = 0) {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: 'Buffer',
      length: value.length,
      base64: value.toString('base64'),
    };
  }

  if (depth >= 8) {
    return '[MaxDepth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeValue(child, depth + 1)])
    );
  }

  return String(value);
}

function getRequestPath(req) {
  return req.originalUrl || req.url || req.path || '/';
}

function isMultipartFormData(req) {
  const contentType = req?.headers?.['content-type'] || '';
  return String(contentType).toLowerCase().includes('multipart/form-data');
}

function serializeMultipartFile(file = {}) {
  return {
    fieldname: file.fieldname || null,
    originalname: file.originalname || null,
    encoding: file.encoding || null,
    mimetype: file.mimetype || null,
    size: Number.isFinite(file.size) ? file.size : null,
  };
}

function serializeMultipartError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name || null,
    code: error.code || null,
    field: error.field || null,
    message: error.message || String(error),
    detail: error.detail || null,
  };
}

function buildMultipartSnapshot(req) {
  const files = Array.isArray(req.files) ? req.files.map(serializeMultipartFile) : [];
  const error = serializeMultipartError(req.dummyApiMultipartError);

  if (!isMultipartFormData(req) && files.length === 0 && !error) {
    return null;
  }

  return {
    fields: sanitizePayload(serializeValue(req.body || {})),
    files: sanitizePayload(files),
    fileCount: files.length,
    error: sanitizePayload(error),
  };
}

function buildRequestSnapshot(req, now) {
  const requestPath = sanitizeRequestUrl(getRequestPath(req));
  const referer = getHeader(req, 'referer') || getHeader(req, 'referrer');
  return {
    receivedAt: now.toISOString(),
    method: req.method || 'GET',
    originalUrl: req.originalUrl ? sanitizeRequestUrl(req.originalUrl) : null,
    baseUrl: req.baseUrl ? sanitizeRequestUrl(req.baseUrl) : null,
    path: req.path ? sanitizeRequestUrl(req.path) : null,
    routePath: req.route?.path ? sanitizeRequestUrl(req.route.path) : null,
    requestPath,
    protocol: req.protocol || null,
    hostname: req.hostname || null,
    ip: req.ip || null,
    ips: sanitizePayload(Array.isArray(req.ips) ? req.ips : []),
    headers: sanitizePayload(serializeValue(req.headers || {})),
    params: sanitizePayload(serializeValue(req.params || {})),
    query: sanitizePayload(serializeValue(req.query || {})),
    body: sanitizePayload(serializeValue(req.body)),
    multipart: buildMultipartSnapshot(req),
    userAgent: sanitizePayload(getHeader(req, 'user-agent')),
    referer: referer ? sanitizeRequestUrl(referer) : null,
  };
}

async function getDummyApiEndpointSettings(options = {}) {
  if (options.settings) {
    return normalizeSettings(options.settings);
  }

  const settingsModel = options.settingsModel || DummyApiEndpointSetting;
  const existing = await leanExec(settingsModel.findOne({ key: DUMMY_API_SETTINGS_KEY }));
  if (existing) {
    return normalizeSettings(existing);
  }

  const created = await leanExec(settingsModel.findOneAndUpdate(
    { key: DUMMY_API_SETTINGS_KEY },
    {
      $setOnInsert: {
        key: DUMMY_API_SETTINGS_KEY,
        enabled: false,
        updatedBy: null,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeSettings(created);
}

async function updateDummyApiEndpointSettings(input = {}, options = {}) {
  const settingsModel = options.settingsModel || DummyApiEndpointSetting;
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;

  const updated = await leanExec(settingsModel.findOneAndUpdate(
    { key: DUMMY_API_SETTINGS_KEY },
    {
      $set: {
        enabled: parseEnabled(input.enabled),
        updatedBy,
      },
      $setOnInsert: {
        key: DUMMY_API_SETTINGS_KEY,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeSettings(updated);
}

async function recordDummyApiRequest(req, options = {}) {
  const settings = await getDummyApiEndpointSettings(options);
  if (!settings.enabled) {
    return {
      enabled: false,
      logged: false,
      log: null,
    };
  }

  const logModel = options.logModel || DummyApiRequestLog;
  const now = new Date(options.now || Date.now());
  const snapshot = buildRequestSnapshot(req, now);
  const log = await logModel.create({
    receivedAt: now,
    method: snapshot.method,
    requestPath: snapshot.requestPath,
    raw: snapshot,
  });

  return {
    enabled: true,
    logged: true,
    log,
  };
}

async function listDummyApiRequestLogs(options = {}) {
  const logModel = options.logModel || DummyApiRequestLog;
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, DUMMY_API_LOG_LIMIT)
    : DUMMY_API_LOG_LIMIT;

  const rows = await leanExec(logModel.find({})
    .sort({ receivedAt: -1 })
    .limit(limit));

  return Array.isArray(rows) ? rows : [];
}

async function countDummyApiRequestLogs(options = {}) {
  const logModel = options.logModel || DummyApiRequestLog;
  return logModel.countDocuments({});
}

async function clearDummyApiRequestLogs(options = {}) {
  const logModel = options.logModel || DummyApiRequestLog;
  const result = await logModel.deleteMany({});
  return {
    deletedCount: result?.deletedCount || 0,
  };
}

module.exports = {
  DUMMY_API_ENDPOINT_PATHS,
  DUMMY_API_LOG_COLLECTION_NAME: DummyApiRequestLog.collection.collectionName,
  DUMMY_API_LOG_LIMIT,
  buildRequestSnapshot,
  clearDummyApiRequestLogs,
  countDummyApiRequestLogs,
  getDummyApiEndpointSettings,
  listDummyApiRequestLogs,
  parseEnabled,
  recordDummyApiRequest,
  updateDummyApiEndpointSettings,
};
