const IncomingRequest = require('../models/incoming_request');
const RequestCounterSettings = require('../models/request_counter_settings');
const { ensureRequestCounterPath } = require('../utils/requestCounterPath');

const REQUEST_COUNTER_LIMIT = 60;
const REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES = 90;
const REQUEST_COUNTER_WINDOW_MS = REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES * 60 * 1000;
const REQUEST_COUNTER_MIN_LIMIT = 1;
const REQUEST_COUNTER_MAX_LIMIT = 100000;
const REQUEST_COUNTER_MIN_WINDOW_MINUTES = 1;
const REQUEST_COUNTER_MAX_WINDOW_MINUTES = 7 * 24 * 60;
const REQUEST_COUNTER_SETTINGS_KEY = 'default';
const MINUTE_MS = 60 * 1000;

class RequestCounterSettingsError extends Error {
  constructor(message, status = 400, code = 'invalid_settings') {
    super(message);
    this.name = 'RequestCounterSettingsError';
    this.status = status;
    this.code = code;
  }
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

function getRequestPath(req) {
  return req.originalUrl || req.url || req.path || '/';
}

function getEndpointPath(req, fallback) {
  return fallback || req.baseUrl || req.path || getRequestPath(req);
}

function normalizeStoredInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseBoundedInteger(value, label, min, max) {
  const trimmed = String(value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new RequestCounterSettingsError(`${label} must be a whole number.`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) {
    throw new RequestCounterSettingsError(`${label} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function normalizeSettings(raw = {}) {
  const maxRequests = normalizeStoredInteger(
    raw.maxRequests,
    REQUEST_COUNTER_LIMIT,
    REQUEST_COUNTER_MIN_LIMIT,
    REQUEST_COUNTER_MAX_LIMIT
  );
  const windowMinutes = normalizeStoredInteger(
    raw.windowMinutes,
    REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES,
    REQUEST_COUNTER_MIN_WINDOW_MINUTES,
    REQUEST_COUNTER_MAX_WINDOW_MINUTES
  );

  return {
    key: raw.key || REQUEST_COUNTER_SETTINGS_KEY,
    maxRequests,
    windowMinutes,
    windowMs: windowMinutes * MINUTE_MS,
    updatedAt: raw.updatedAt || raw.createdAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

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

async function getRequestCounterSettings(options = {}) {
  if (options.settings) {
    return normalizeSettings(options.settings);
  }

  const settingsModel = options.settingsModel || RequestCounterSettings;
  const existing = await leanExec(settingsModel.findOne({ key: REQUEST_COUNTER_SETTINGS_KEY }));
  if (existing) {
    return normalizeSettings(existing);
  }

  const created = await leanExec(settingsModel.findOneAndUpdate(
    { key: REQUEST_COUNTER_SETTINGS_KEY },
    {
      $setOnInsert: {
        key: REQUEST_COUNTER_SETTINGS_KEY,
        maxRequests: REQUEST_COUNTER_LIMIT,
        windowMinutes: REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES,
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

async function updateRequestCounterSettings(input = {}, options = {}) {
  const settingsModel = options.settingsModel || RequestCounterSettings;
  const maxRequests = parseBoundedInteger(
    input.maxRequests,
    'Max requests',
    REQUEST_COUNTER_MIN_LIMIT,
    REQUEST_COUNTER_MAX_LIMIT
  );
  const windowMinutes = parseBoundedInteger(
    input.windowMinutes,
    'Window minutes',
    REQUEST_COUNTER_MIN_WINDOW_MINUTES,
    REQUEST_COUNTER_MAX_WINDOW_MINUTES
  );
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;

  const updated = await leanExec(settingsModel.findOneAndUpdate(
    { key: REQUEST_COUNTER_SETTINGS_KEY },
    {
      $set: {
        maxRequests,
        windowMinutes,
        updatedBy,
      },
      $setOnInsert: {
        key: REQUEST_COUNTER_SETTINGS_KEY,
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

function floorToMinute(date) {
  const value = new Date(date);
  value.setSeconds(0, 0);
  return value;
}

async function fetchRollingWindowSeries(endpointPath, settings, options = {}) {
  const requestModel = options.model || IncomingRequest;
  const now = new Date(options.now || Date.now());
  const lastPointMinute = floorToMinute(now);
  const pointCount = Math.max(1, settings.windowMinutes);
  const firstPointMinute = new Date(lastPointMinute.getTime() - ((pointCount - 1) * MINUTE_MS));
  const earliestWindowStart = new Date(firstPointMinute.getTime() - settings.windowMs);

  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: earliestWindowStart,
      $lte: now,
    },
  }).sort({ receivedAt: 1 }).select({ receivedAt: 1 }));
  const eventTimes = (Array.isArray(rows) ? rows : [])
    .map((row) => new Date(row.receivedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  const points = [];
  let left = 0;
  let right = 0;

  for (let index = 0; index < pointCount; index += 1) {
    const pointMinute = new Date(firstPointMinute.getTime() + (index * MINUTE_MS));
    const isLastPoint = index === pointCount - 1;
    const pointEndMs = isLastPoint
      ? now.getTime()
      : pointMinute.getTime() + MINUTE_MS - 1;
    const windowStartMs = pointEndMs - settings.windowMs;

    while (right < eventTimes.length && eventTimes[right] <= pointEndMs) {
      right += 1;
    }

    while (left < right && eventTimes[left] < windowStartMs) {
      left += 1;
    }

    points.push({
      timestamp: pointMinute.toISOString(),
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: new Date(pointEndMs).toISOString(),
      count: right - left,
    });
  }

  return points;
}

async function getRequestCounterDashboard(options = {}) {
  const requestModel = options.model || IncomingRequest;
  const endpointPath = options.endpointPath || ensureRequestCounterPath();
  const now = new Date(options.now || Date.now());
  const settings = await getRequestCounterSettings(options);
  const currentWindowStart = new Date(now.getTime() - settings.windowMs);

  const currentCount = await requestModel.countDocuments({
    endpointPath,
    receivedAt: { $gte: currentWindowStart },
  });
  const totalStored = await requestModel.countDocuments({ endpointPath });
  const blockedInWindow = await requestModel.countDocuments({
    endpointPath,
    receivedAt: { $gte: currentWindowStart },
    allowed: false,
  });
  const recentRequests = await leanExec(requestModel.find({ endpointPath })
    .sort({ receivedAt: -1 })
    .limit(25));
  const chartSeries = await fetchRollingWindowSeries(endpointPath, settings, {
    model: requestModel,
    now,
  });

  return {
    endpointPath,
    generatedAt: now,
    settings,
    currentWindowStart,
    currentCount,
    totalStored,
    blockedInWindow,
    remaining: Math.max(0, settings.maxRequests - currentCount),
    nextDecision: currentCount < settings.maxRequests ? 'OK' : 'NG',
    chartSeries,
    recentRequests: Array.isArray(recentRequests) ? recentRequests : [],
  };
}

async function recordAndEvaluateRequest(req, options = {}) {
  const model = options.model || IncomingRequest;
  const settings = await getRequestCounterSettings(options);
  const now = new Date(options.now || Date.now());
  const endpointPath = getEndpointPath(req, options.endpointPath);
  const windowStart = new Date(now.getTime() - settings.windowMs);
  const recentCount = await model.countDocuments({
    endpointPath,
    receivedAt: { $gte: windowStart },
  });
  const countInWindow = recentCount + 1;
  const allowed = recentCount < settings.maxRequests;
  const responseText = allowed ? 'OK' : 'NG';
  const responseStatusCode = allowed ? 200 : 429;

  await model.create({
    endpointPath,
    requestPath: getRequestPath(req),
    method: req.method || 'GET',
    ip: req.ip || null,
    ips: Array.isArray(req.ips) ? req.ips : [],
    userAgent: getHeader(req, 'user-agent'),
    referer: getHeader(req, 'referer') || getHeader(req, 'referrer'),
    query: req.query || {},
    receivedAt: now,
    windowStart,
    countInWindow,
    allowed,
    responseStatusCode,
    responseText,
  });

  return {
    allowed,
    countInWindow,
    limit: settings.maxRequests,
    windowMinutes: settings.windowMinutes,
    windowMs: settings.windowMs,
    responseStatusCode,
    responseText,
  };
}

module.exports = {
  RequestCounterSettingsError,
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES,
  REQUEST_COUNTER_MAX_LIMIT,
  REQUEST_COUNTER_MAX_WINDOW_MINUTES,
  REQUEST_COUNTER_MIN_LIMIT,
  REQUEST_COUNTER_MIN_WINDOW_MINUTES,
  REQUEST_COUNTER_WINDOW_MS,
  fetchRollingWindowSeries,
  getRequestCounterDashboard,
  getRequestCounterSettings,
  recordAndEvaluateRequest,
  updateRequestCounterSettings,
};
