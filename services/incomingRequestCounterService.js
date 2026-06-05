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
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_COUNTER_RETENTION_DAYS = 7;

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

function startOfLocalDay(date) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(date, days) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function formatLocalDateKey(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCompleteRetentionDayRanges(now = new Date(), retentionDays = REQUEST_COUNTER_RETENTION_DAYS) {
  const nowDate = new Date(now);
  const retentionStart = new Date(nowDate.getTime() - retentionDays * DAY_MS);
  const currentDayStart = startOfLocalDay(nowDate);
  let dayStart = startOfLocalDay(retentionStart);

  if (dayStart.getTime() < retentionStart.getTime()) {
    dayStart = addLocalDays(dayStart, 1);
  }

  const ranges = [];
  while (dayStart.getTime() < currentDayStart.getTime()) {
    const dayEnd = addLocalDays(dayStart, 1);
    if (dayStart.getTime() >= retentionStart.getTime() && dayEnd.getTime() <= nowDate.getTime()) {
      ranges.push({
        dateKey: formatLocalDateKey(dayStart),
        start: dayStart,
        end: dayEnd,
      });
    }
    dayStart = dayEnd;
  }

  return ranges;
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

async function fetchDailyMinuteStats(endpointPath, options = {}) {
  const requestModel = options.model || IncomingRequest;
  const now = new Date(options.now || Date.now());
  const ranges = buildCompleteRetentionDayRanges(now);

  return Promise.all(ranges.map(async (range) => {
    const baseQuery = {
      endpointPath,
      receivedAt: {
        $gte: range.start,
        $lt: range.end,
      },
    };
    const [totalMinutes, ngMinutes] = await Promise.all([
      requestModel.countDocuments(baseQuery),
      requestModel.countDocuments({
        ...baseQuery,
        allowed: false,
      }),
    ]);
    const safeTotal = Number.isFinite(totalMinutes) ? totalMinutes : 0;
    const safeNg = Number.isFinite(ngMinutes) ? ngMinutes : 0;

    return {
      dateKey: range.dateKey,
      start: range.start,
      end: range.end,
      totalMinutes: safeTotal,
      okMinutes: Math.max(0, safeTotal - safeNg),
      ngMinutes: safeNg,
    };
  }));
}

async function fetchCurrentWindowEventTimes(endpointPath, settings, options = {}) {
  const requestModel = options.model || IncomingRequest;
  const now = new Date(options.now || Date.now());
  const windowStart = new Date(now.getTime() - settings.windowMs);
  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: windowStart,
      $lte: now,
    },
  }).sort({ receivedAt: 1 }).select({ receivedAt: 1 }));

  return (Array.isArray(rows) ? rows : [])
    .map((row) => new Date(row.receivedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

function calculateRequestCounterLimitTiming(eventTimes, settings, now = new Date()) {
  const limit = normalizeStoredInteger(
    settings.maxRequests,
    REQUEST_COUNTER_LIMIT,
    REQUEST_COUNTER_MIN_LIMIT,
    REQUEST_COUNTER_MAX_LIMIT
  );
  const windowMinutes = normalizeStoredInteger(
    settings.windowMinutes,
    REQUEST_COUNTER_DEFAULT_WINDOW_MINUTES,
    REQUEST_COUNTER_MIN_WINDOW_MINUTES,
    REQUEST_COUNTER_MAX_WINDOW_MINUTES
  );
  const windowMs = Number.isFinite(Number(settings.windowMs)) && Number(settings.windowMs) > 0
    ? Number(settings.windowMs)
    : windowMinutes * MINUTE_MS;
  const nowMs = new Date(now).getTime();
  const windowStartMs = nowMs - windowMs;
  const currentEventTimes = (Array.isArray(eventTimes) ? eventTimes : [])
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time) && time >= windowStartMs && time <= nowMs)
    .sort((a, b) => a - b);
  const currentCount = currentEventTimes.length;
  const expiryTimes = currentEventTimes
    .map((time) => time + windowMs)
    .sort((a, b) => a - b);

  if (currentCount >= limit) {
    const expirationsNeeded = currentCount - limit + 1;
    const expiryTime = expiryTimes[expirationsNeeded - 1];
    const minutes = Number.isFinite(expiryTime)
      ? Math.max(0, Math.ceil((expiryTime - nowMs) / MINUTE_MS))
      : null;

    return {
      mode: 'until_below_max',
      minutes,
    };
  }

  if (limit > windowMinutes) {
    return {
      mode: 'infinite',
      minutes: null,
    };
  }

  let expiredCount = 0;
  for (let minuteOffset = 1; minuteOffset <= windowMinutes; minuteOffset += 1) {
    const futureMs = nowMs + (minuteOffset * MINUTE_MS);

    while (expiredCount < expiryTimes.length && expiryTimes[expiredCount] <= futureMs) {
      expiredCount += 1;
    }

    const projectedCount = currentCount + minuteOffset - expiredCount;
    if (projectedCount >= limit) {
      return {
        mode: 'until_max',
        minutes: minuteOffset,
      };
    }
  }

  return {
    mode: 'infinite',
    minutes: null,
  };
}

async function getRequestCounterDashboard(options = {}) {
  const requestModel = options.model || IncomingRequest;
  const endpointPath = options.endpointPath || ensureRequestCounterPath();
  const now = new Date(options.now || Date.now());
  const settings = await getRequestCounterSettings(options);
  const currentWindowStart = new Date(now.getTime() - settings.windowMs);

  const [
    currentEventTimes,
    totalStored,
    blockedInWindow,
    recentRequests,
    chartSeries,
    dailyMinuteStats,
  ] = await Promise.all([
    fetchCurrentWindowEventTimes(endpointPath, settings, {
      model: requestModel,
      now,
    }),
    requestModel.countDocuments({ endpointPath }),
    requestModel.countDocuments({
      endpointPath,
      receivedAt: {
        $gte: currentWindowStart,
        $lte: now,
      },
      allowed: false,
    }),
    leanExec(requestModel.find({ endpointPath })
      .sort({ receivedAt: -1 })
      .limit(25)),
    fetchRollingWindowSeries(endpointPath, settings, {
      model: requestModel,
      now,
    }),
    fetchDailyMinuteStats(endpointPath, {
      model: requestModel,
      now,
    }),
  ]);
  const currentCount = currentEventTimes.length;
  const limitTiming = calculateRequestCounterLimitTiming(currentEventTimes, settings, now);

  return {
    endpointPath,
    generatedAt: now,
    settings,
    currentWindowStart,
    currentCount,
    totalStored,
    blockedInWindow,
    remaining: Math.max(0, settings.maxRequests - currentCount),
    limitTiming,
    nextDecision: currentCount < settings.maxRequests ? 'OK' : 'NG',
    chartSeries,
    dailyMinuteStats,
    recentRequests: Array.isArray(recentRequests) ? recentRequests : [],
  };
}

async function getCurrentRequestCounterStatus(endpointPath, options = {}) {
  const requestModel = options.model || IncomingRequest;
  const now = new Date(options.now || Date.now());
  const settings = await getRequestCounterSettings(options);
  const windowStart = new Date(now.getTime() - settings.windowMs);
  const countInWindow = await requestModel.countDocuments({
    endpointPath,
    receivedAt: { $gte: windowStart },
  });
  const allowed = countInWindow < settings.maxRequests;

  return {
    endpointPath,
    status: allowed ? 'OK' : 'NG',
    allowed,
    countInWindow,
    limit: settings.maxRequests,
    remaining: Math.max(0, settings.maxRequests - countInWindow),
    windowMinutes: settings.windowMinutes,
    windowMs: settings.windowMs,
    windowStart,
    checkedAt: now,
    wouldReturnStatusCode: allowed ? 200 : 429,
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
  REQUEST_COUNTER_RETENTION_DAYS,
  REQUEST_COUNTER_WINDOW_MS,
  buildCompleteRetentionDayRanges,
  calculateRequestCounterLimitTiming,
  fetchCurrentWindowEventTimes,
  fetchDailyMinuteStats,
  fetchRollingWindowSeries,
  getCurrentRequestCounterStatus,
  getRequestCounterDashboard,
  getRequestCounterSettings,
  recordAndEvaluateRequest,
  updateRequestCounterSettings,
};
