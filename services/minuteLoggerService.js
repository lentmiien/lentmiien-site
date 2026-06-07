const MinuteLoggerRequest = require('../models/minute_logger_request');
const MinuteLoggerStat = require('../models/minute_logger_stat');
const { ensureMinuteLoggerPath } = require('../utils/minuteLoggerPath');

const MINUTE_LOGGER_RAW_RETENTION_DAYS = 60;
const MINUTE_LOGGER_STATS_RETENTION_YEARS = 10;
const MINUTE_LOGGER_RECENT_LIMIT = 50;
const UNKNOWN_DIMENSION = 'unknown';
const MINUTE_LOGGER_RESPONSE_BODY = { message: 'OK' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_LOGGER_LOCATION_GROUP_PRECISION = 3;
const MINUTE_LOGGER_LOCATION_NOISE_MINUTES = 3;
const MINUTE_LOGGER_LOCATION_GROUP_LIMIT = 20;

const TIME_BUCKETS = [
  { key: 'morning', label: 'Morning', startHour: 5, endHour: 11 },
  { key: 'afternoon', label: 'Afternoon', startHour: 12, endHour: 16 },
  { key: 'evening', label: 'Evening', startHour: 17, endHour: 21 },
  { key: 'night', label: 'Night', startHour: 22, endHour: 4 },
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

function sanitizeObjectKey(key) {
  return String(key || '')
    .replace(/^\$/u, '_')
    .replace(/\./gu, '_');
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
      Object.entries(value).map(([key, child]) => [
        sanitizeObjectKey(key),
        serializeValue(child, depth + 1),
      ])
    );
  }

  return String(value);
}

function firstPresentValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstPresentValue(item);
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
        return candidate;
      }
    }
    return undefined;
  }

  return value;
}

function normalizeDimension(value, fallback = UNKNOWN_DIMENSION) {
  const candidate = firstPresentValue(value);

  if (candidate === undefined || candidate === null) {
    return fallback;
  }

  const normalized = String(candidate).trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 200);
}

function getInputValue(req, names = [], headerNames = []) {
  const sources = [req?.body, req?.query];

  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(source, name)) {
        const value = firstPresentValue(source[name]);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
    }
  }

  for (const headerName of headerNames) {
    const value = getHeader(req, headerName);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return undefined;
}

function isPresentInputValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isPresentInputValue(item));
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return true;
}

function getRawInputValue(req, names = []) {
  const sources = [req?.body, req?.query];

  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(source, name) && isPresentInputValue(source[name])) {
        return source[name];
      }
    }
  }

  return undefined;
}

function getPackageName(req) {
  return normalizeDimension(
    getInputValue(req, ['package'], ['x-package']),
    UNKNOWN_DIMENSION
  );
}

function getDeviceId(req) {
  return normalizeDimension(
    getInputValue(req, ['deviceId', 'device_id', 'deviceID', 'device'], ['x-device-id']),
    UNKNOWN_DIMENSION
  );
}

function parseCoordinateNumber(value) {
  const candidate = firstPresentValue(value);

  if (candidate === undefined || candidate === null) {
    return null;
  }

  if (typeof candidate === 'number') {
    return Number.isFinite(candidate) ? candidate : null;
  }

  const text = String(candidate).trim();
  if (!text) {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function formatLocationRaw(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().slice(0, 240) || null;
  }

  try {
    return JSON.stringify(serializeValue(value)).slice(0, 240);
  } catch (error) {
    return String(value).slice(0, 240);
  }
}

function roundCoordinate(value, precision = MINUTE_LOGGER_LOCATION_GROUP_PRECISION) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

function buildLocationGroupKey(latitude, longitude, precision = MINUTE_LOGGER_LOCATION_GROUP_PRECISION) {
  return [
    roundCoordinate(latitude, precision).toFixed(precision),
    roundCoordinate(longitude, precision).toFixed(precision),
  ].join(',');
}

function buildLocationObject(latitude, longitude, raw, options = {}) {
  const precision = Number.isInteger(options.precision)
    ? options.precision
    : MINUTE_LOGGER_LOCATION_GROUP_PRECISION;

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return null;
  }

  return {
    raw: formatLocationRaw(raw) || `${latitude},${longitude}`,
    latitude,
    longitude,
    groupKey: buildLocationGroupKey(latitude, longitude, precision),
  };
}

function parseCoordinatePair(firstValue, secondValue, raw, options = {}) {
  let latitude = parseCoordinateNumber(firstValue);
  let longitude = parseCoordinateNumber(secondValue);

  if (isValidLatitude(latitude) && isValidLongitude(longitude)) {
    return buildLocationObject(latitude, longitude, raw, options);
  }

  if (isValidLatitude(longitude) && isValidLongitude(latitude)) {
    return buildLocationObject(longitude, latitude, raw, options);
  }

  return null;
}

function getObjectCoordinateValue(value, names = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) {
      return value[name];
    }
  }

  return undefined;
}

function parseLocationValue(value, options = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value) && value.length >= 2) {
    return parseCoordinatePair(value[0], value[1], value, options);
  }

  if (typeof value === 'string') {
    const parts = value.trim().split(/[,\s;]+/u).filter(Boolean);
    if (parts.length >= 2) {
      return parseCoordinatePair(parts[0], parts[1], value, options);
    }
    return null;
  }

  if (typeof value === 'object') {
    const latitude = getObjectCoordinateValue(value, ['latitude', 'lat']);
    const longitude = getObjectCoordinateValue(value, ['longitude', 'lng', 'lon']);
    const explicit = parseCoordinatePair(latitude, longitude, value, options);
    if (explicit) {
      return explicit;
    }

    const nestedCoordinates = getObjectCoordinateValue(value, ['coordinates', 'coords']);
    if (Array.isArray(nestedCoordinates) && nestedCoordinates.length >= 2) {
      return parseCoordinatePair(nestedCoordinates[0], nestedCoordinates[1], value, options);
    }
  }

  return null;
}

function getLocation(req) {
  const explicitLatitude = getInputValue(req, ['latitude', 'lat'], ['x-latitude']);
  const explicitLongitude = getInputValue(req, ['longitude', 'lng', 'lon'], ['x-longitude']);
  const explicitLocation = parseCoordinatePair(
    explicitLatitude,
    explicitLongitude,
    `${explicitLatitude},${explicitLongitude}`
  );

  if (explicitLocation) {
    return explicitLocation;
  }

  return parseLocationValue(
    getRawInputValue(req, ['location', 'coordinates', 'coords'])
  );
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function buildPeriodInfo(periodType, now) {
  if (periodType === 'month') {
    const periodStart = startOfLocalMonth(now);
    return {
      periodType,
      periodKey: formatMonthKey(periodStart),
      periodStart,
      expiresAt: addYears(periodStart, MINUTE_LOGGER_STATS_RETENTION_YEARS),
    };
  }

  const periodStart = startOfLocalDay(now);
  return {
    periodType: 'day',
    periodKey: formatDayKey(periodStart),
    periodStart,
    expiresAt: addYears(periodStart, MINUTE_LOGGER_STATS_RETENTION_YEARS),
  };
}

function buildCompleteDayRanges(now = new Date(), days = MINUTE_LOGGER_RAW_RETENTION_DAYS) {
  const currentDayStart = startOfLocalDay(new Date(now));
  const count = Number.isInteger(days) && days > 0 ? days : MINUTE_LOGGER_RAW_RETENTION_DAYS;
  const ranges = [];

  for (let offset = count; offset >= 1; offset -= 1) {
    const start = new Date(currentDayStart);
    start.setDate(currentDayStart.getDate() - offset);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    ranges.push({
      dateKey: formatDayKey(start),
      start,
      end,
    });
  }

  return ranges;
}

function buildMonthRanges(now = new Date(), months = 12) {
  const currentMonthStart = startOfLocalMonth(new Date(now));
  const count = Number.isInteger(months) && months > 0 ? months : 12;
  const ranges = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(currentMonthStart);
    start.setMonth(currentMonthStart.getMonth() - offset);
    const end = new Date(start);
    end.setMonth(start.getMonth() + 1);

    ranges.push({
      monthKey: formatMonthKey(start),
      start,
      end,
    });
  }

  return ranges;
}

function buildRequestRecord(req, options = {}) {
  const now = new Date(options.now || Date.now());
  const endpointPath = options.endpointPath || req?.baseUrl || '';
  const packageName = getPackageName(req);
  const deviceId = getDeviceId(req);
  const location = getLocation(req);

  return {
    endpointPath,
    requestPath: getRequestPath(req),
    method: req?.method || 'POST',
    ip: req?.ip || null,
    ips: Array.isArray(req?.ips) ? req.ips : [],
    userAgent: getHeader(req, 'user-agent'),
    referer: getHeader(req, 'referer') || getHeader(req, 'referrer'),
    deviceId,
    package: packageName,
    location,
    query: serializeValue(req?.query || {}),
    body: serializeValue(req?.body === undefined ? {} : req.body),
    receivedAt: now,
    responseStatusCode: 200,
    responseBody: MINUTE_LOGGER_RESPONSE_BODY,
  };
}

async function incrementMinuteLoggerStats(input = {}, options = {}) {
  const statModel = options.statModel || MinuteLoggerStat;
  const now = new Date(input.now || options.now || Date.now());
  const endpointPath = input.endpointPath || options.endpointPath || '';
  const deviceId = normalizeDimension(input.deviceId, UNKNOWN_DIMENSION);
  const packageName = normalizeDimension(input.package, UNKNOWN_DIMENSION);
  const periods = ['day', 'month'].map((periodType) => buildPeriodInfo(periodType, now));

  await Promise.all(periods.map((period) => {
    return leanExec(statModel.findOneAndUpdate(
      {
        endpointPath,
        periodType: period.periodType,
        periodKey: period.periodKey,
        deviceId,
        package: packageName,
      },
      {
        $setOnInsert: {
          endpointPath,
          periodType: period.periodType,
          periodKey: period.periodKey,
          periodStart: period.periodStart,
          deviceId,
          package: packageName,
          expiresAt: period.expiresAt,
        },
        $inc: {
          minutes: 1,
        },
        $min: {
          firstRequestAt: now,
        },
        $max: {
          lastRequestAt: now,
        },
        $set: {
          updatedAt: now,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ));
  }));
}

async function recordMinuteLoggerRequest(req, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const statModel = options.statModel || MinuteLoggerStat;
  const now = new Date(options.now || Date.now());
  const record = buildRequestRecord(req, {
    now,
    endpointPath: options.endpointPath,
  });

  const log = await requestModel.create(record);
  await incrementMinuteLoggerStats({
    now,
    endpointPath: record.endpointPath,
    deviceId: record.deviceId,
    package: record.package,
  }, {
    statModel,
  });

  return {
    logged: true,
    log,
    responseBody: MINUTE_LOGGER_RESPONSE_BODY,
  };
}

async function fetchDailyMinuteStats(endpointPath, options = {}) {
  const statModel = options.statModel || MinuteLoggerStat;
  const now = new Date(options.now || Date.now());
  const ranges = buildCompleteDayRanges(now, options.days || MINUTE_LOGGER_RAW_RETENTION_DAYS);
  if (!ranges.length) {
    return [];
  }

  const rows = await statModel.aggregate([
    {
      $match: {
        endpointPath,
        periodType: 'day',
        periodStart: {
          $gte: ranges[0].start,
          $lt: ranges[ranges.length - 1].end,
        },
      },
    },
    {
      $group: {
        _id: {
          periodKey: '$periodKey',
          package: '$package',
        },
        minutes: { $sum: '$minutes' },
      },
    },
    {
      $sort: {
        '_id.periodKey': 1,
        minutes: -1,
      },
    },
  ]);

  const rowMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const dateKey = row?._id?.periodKey;
    if (!dateKey) {
      return;
    }

    const packageName = normalizeDimension(row?._id?.package, UNKNOWN_DIMENSION);
    const minutes = Number(row?.minutes) || 0;
    if (!rowMap.has(dateKey)) {
      rowMap.set(dateKey, []);
    }
    if (minutes > 0) {
      rowMap.get(dateKey).push({ name: packageName, minutes });
    }
  });

  return ranges.map((range) => {
    const categories = rowMap.get(range.dateKey) || [];
    return {
      dateKey: range.dateKey,
      totalMinutes: categories.reduce((sum, category) => sum + category.minutes, 0),
      categories,
    };
  });
}

async function fetchMonthlyMinuteStats(endpointPath, options = {}) {
  const statModel = options.statModel || MinuteLoggerStat;
  const now = new Date(options.now || Date.now());
  const ranges = buildMonthRanges(now, options.months || 12);
  if (!ranges.length) {
    return [];
  }

  const rows = await statModel.aggregate([
    {
      $match: {
        endpointPath,
        periodType: 'month',
        periodStart: {
          $gte: ranges[0].start,
          $lt: ranges[ranges.length - 1].end,
        },
      },
    },
    {
      $group: {
        _id: '$periodKey',
        minutes: { $sum: '$minutes' },
        devices: { $addToSet: '$deviceId' },
        packages: { $addToSet: '$package' },
      },
    },
    {
      $sort: {
        _id: 1,
      },
    },
  ]);

  const rowMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    rowMap.set(row._id, {
      monthKey: row._id,
      totalMinutes: Number(row.minutes) || 0,
      deviceCount: Array.isArray(row.devices) ? row.devices.length : 0,
      packageCount: Array.isArray(row.packages) ? row.packages.length : 0,
    });
  });

  return ranges.map((range) => rowMap.get(range.monthKey) || {
    monthKey: range.monthKey,
    totalMinutes: 0,
    deviceCount: 0,
    packageCount: 0,
  });
}

function getDashboardTimeZone() {
  return process.env.MINUTE_LOGGER_TIME_ZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
}

async function fetchPackageStats(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const rows = await requestModel.aggregate([
    {
      $match: {
        endpointPath,
        receivedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$package',
        minutes: { $sum: 1 },
        devices: { $addToSet: '$deviceId' },
        lastSeen: { $max: '$receivedAt' },
      },
    },
    {
      $project: {
        _id: 0,
        package: '$_id',
        minutes: 1,
        deviceCount: { $size: '$devices' },
        lastSeen: 1,
      },
    },
    { $sort: { minutes: -1, package: 1 } },
  ]);

  return Array.isArray(rows) ? rows : [];
}

async function fetchDeviceStats(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const rows = await requestModel.aggregate([
    {
      $match: {
        endpointPath,
        receivedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$deviceId',
        minutes: { $sum: 1 },
        packages: { $addToSet: '$package' },
        lastSeen: { $max: '$receivedAt' },
      },
    },
    {
      $project: {
        _id: 0,
        deviceId: '$_id',
        minutes: 1,
        packageCount: { $size: '$packages' },
        lastSeen: 1,
      },
    },
    { $sort: { minutes: -1, deviceId: 1 } },
  ]);

  return Array.isArray(rows) ? rows : [];
}

function normalizeLocationStatRow(row = {}) {
  const latitude = row.latitude === null || row.latitude === undefined ? NaN : Number(row.latitude);
  const longitude = row.longitude === null || row.longitude === undefined ? NaN : Number(row.longitude);
  const minutes = Number(row.minutes) || 0;
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    groupKey: row.groupKey || row.locationGroupKey || row._id || (hasCoordinates ? buildLocationGroupKey(latitude, longitude) : ''),
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    minutes,
    deviceCount: Number(row.deviceCount) || 0,
    packageCount: Number(row.packageCount) || 0,
    firstSeen: row.firstSeen || null,
    lastSeen: row.lastSeen || null,
  };
}

function summarizeLocationGroups(rows = [], options = {}) {
  const minMinutes = Number.isInteger(options.minMinutes) && options.minMinutes > 0
    ? options.minMinutes
    : MINUTE_LOGGER_LOCATION_NOISE_MINUTES;
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : MINUTE_LOGGER_LOCATION_GROUP_LIMIT;
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map(normalizeLocationStatRow)
    .filter((row) => row.minutes > 0 && row.latitude !== null && row.longitude !== null);
  const groups = normalizedRows
    .filter((row) => row.minutes >= minMinutes)
    .sort((a, b) => {
      if (b.minutes !== a.minutes) {
        return b.minutes - a.minutes;
      }
      return String(a.groupKey).localeCompare(String(b.groupKey));
    });
  const noiseRows = normalizedRows.filter((row) => row.minutes < minMinutes);
  const totalLocationMinutes = normalizedRows.reduce((sum, row) => sum + row.minutes, 0);
  const groupedLocationMinutes = groups.reduce((sum, row) => sum + row.minutes, 0);

  return {
    groups: groups.slice(0, limit),
    totalLocationMinutes,
    groupedLocationMinutes,
    noiseLocationMinutes: noiseRows.reduce((sum, row) => sum + row.minutes, 0),
    noiseGroupCount: noiseRows.length,
    totalGroupCount: groups.length,
    noiseThresholdMinutes: minMinutes,
    precisionDecimals: MINUTE_LOGGER_LOCATION_GROUP_PRECISION,
  };
}

async function fetchLocationStats(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const rows = await requestModel.aggregate([
    {
      $match: {
        endpointPath,
        receivedAt: { $gte: since },
        'location.latitude': { $gte: -90, $lte: 90 },
        'location.longitude': { $gte: -180, $lte: 180 },
        'location.groupKey': { $type: 'string', $ne: '' },
      },
    },
    {
      $group: {
        _id: '$location.groupKey',
        minutes: { $sum: 1 },
        latitude: { $avg: '$location.latitude' },
        longitude: { $avg: '$location.longitude' },
        devices: { $addToSet: '$deviceId' },
        packages: { $addToSet: '$package' },
        firstSeen: { $min: '$receivedAt' },
        lastSeen: { $max: '$receivedAt' },
      },
    },
    {
      $project: {
        _id: 0,
        groupKey: '$_id',
        latitude: 1,
        longitude: 1,
        minutes: 1,
        deviceCount: { $size: '$devices' },
        packageCount: { $size: '$packages' },
        firstSeen: 1,
        lastSeen: 1,
      },
    },
    { $sort: { minutes: -1, lastSeen: -1, groupKey: 1 } },
  ]);

  return summarizeLocationGroups(rows, {
    minMinutes: options.minMinutes,
    limit: options.limit,
  });
}

async function fetchHourlySpread(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const timezone = options.timezone || getDashboardTimeZone();
  const rows = await requestModel.aggregate([
    {
      $match: {
        endpointPath,
        receivedAt: { $gte: since },
      },
    },
    {
      $project: {
        hour: {
          $hour: {
            date: '$receivedAt',
            timezone,
          },
        },
      },
    },
    {
      $group: {
        _id: '$hour',
        minutes: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const rowMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    rowMap.set(Number(row._id), Number(row.minutes) || 0);
  });

  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    minutes: rowMap.get(hour) || 0,
  }));
}

function getTimeBucketForHour(hour) {
  return TIME_BUCKETS.find((bucket) => {
    if (bucket.startHour <= bucket.endHour) {
      return hour >= bucket.startHour && hour <= bucket.endHour;
    }

    return hour >= bucket.startHour || hour <= bucket.endHour;
  }) || TIME_BUCKETS[0];
}

function summarizeTimeBuckets(hourlySpread = [], dayCount = MINUTE_LOGGER_RAW_RETENTION_DAYS) {
  const bucketMap = new Map(TIME_BUCKETS.map((bucket) => [
    bucket.key,
    {
      ...bucket,
      minutes: 0,
      averagePerDay: 0,
    },
  ]));

  hourlySpread.forEach((row) => {
    const hour = Number(row.hour);
    const minutes = Number(row.minutes) || 0;
    const bucket = getTimeBucketForHour(hour);
    bucketMap.get(bucket.key).minutes += minutes;
  });

  const safeDayCount = Math.max(1, Number(dayCount) || MINUTE_LOGGER_RAW_RETENTION_DAYS);
  const buckets = TIME_BUCKETS.map((bucket) => {
    const value = bucketMap.get(bucket.key);
    return {
      ...value,
      averagePerDay: value.minutes / safeDayCount,
    };
  });

  const busiest = buckets.reduce((best, bucket) => {
    return bucket.minutes > best.minutes ? bucket : best;
  }, buckets[0]);

  return {
    buckets,
    busiest,
  };
}

async function getDistinctCount(model, field, match) {
  if (!model || typeof model.distinct !== 'function') {
    return 0;
  }

  const rows = await leanExec(model.distinct(field, match));
  return Array.isArray(rows) ? rows.filter(Boolean).length : 0;
}

async function getMinuteLoggerDashboard(options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const statModel = options.statModel || MinuteLoggerStat;
  const endpointPath = options.endpointPath || ensureMinuteLoggerPath();
  const now = new Date(options.now || Date.now());
  const rawWindowStart = new Date(now.getTime() - (MINUTE_LOGGER_RAW_RETENTION_DAYS * DAY_MS));
  const since24h = new Date(now.getTime() - DAY_MS);
  const recentLimit = Number.isInteger(options.recentLimit) && options.recentLimit > 0
    ? Math.min(options.recentLimit, MINUTE_LOGGER_RECENT_LIMIT)
    : MINUTE_LOGGER_RECENT_LIMIT;
  const rawMatch = { endpointPath };
  const rawWindowMatch = {
    endpointPath,
    receivedAt: { $gte: rawWindowStart },
  };

  const [
    totalRawRequests,
    requestsLast24h,
    activeDevicesLast24h,
    packageCountLast60d,
    recentRequests,
    packageStats,
    deviceStats,
    locationStats,
    hourlySpread,
    dailyMinuteStats,
    monthlyMinuteStats,
  ] = await Promise.all([
    requestModel.countDocuments(rawMatch),
    requestModel.countDocuments({
      endpointPath,
      receivedAt: { $gte: since24h },
    }),
    getDistinctCount(requestModel, 'deviceId', {
      endpointPath,
      receivedAt: { $gte: since24h },
    }),
    getDistinctCount(requestModel, 'package', rawWindowMatch),
    leanExec(requestModel.find(rawMatch)
      .sort({ receivedAt: -1 })
      .limit(recentLimit)),
    fetchPackageStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchDeviceStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchLocationStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchHourlySpread(endpointPath, { requestModel, since: rawWindowStart }),
    fetchDailyMinuteStats(endpointPath, { statModel, now }),
    fetchMonthlyMinuteStats(endpointPath, { statModel, now }),
  ]);
  const timeBucketSummary = summarizeTimeBuckets(hourlySpread, MINUTE_LOGGER_RAW_RETENTION_DAYS);

  return {
    endpointPath,
    generatedAt: now,
    rawRetentionDays: MINUTE_LOGGER_RAW_RETENTION_DAYS,
    statsRetentionYears: MINUTE_LOGGER_STATS_RETENTION_YEARS,
    totalRawRequests: Number(totalRawRequests) || 0,
    requestsLast24h: Number(requestsLast24h) || 0,
    activeDevicesLast24h,
    packageCountLast60d,
    recentLimit,
    recentRequests: Array.isArray(recentRequests) ? recentRequests : [],
    packageStats,
    deviceStats,
    locationStats,
    hourlySpread,
    timeBucketStats: timeBucketSummary.buckets,
    busiestTimeBucket: timeBucketSummary.busiest,
    dailyMinuteStats,
    monthlyMinuteStats,
  };
}

module.exports = {
  MINUTE_LOGGER_RAW_RETENTION_DAYS,
  MINUTE_LOGGER_LOCATION_GROUP_LIMIT,
  MINUTE_LOGGER_LOCATION_GROUP_PRECISION,
  MINUTE_LOGGER_LOCATION_NOISE_MINUTES,
  MINUTE_LOGGER_RECENT_LIMIT,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME: MinuteLoggerRequest.collection.collectionName,
  MINUTE_LOGGER_RESPONSE_BODY,
  MINUTE_LOGGER_STAT_COLLECTION_NAME: MinuteLoggerStat.collection.collectionName,
  MINUTE_LOGGER_STATS_RETENTION_YEARS,
  TIME_BUCKETS,
  UNKNOWN_DIMENSION,
  buildCompleteDayRanges,
  buildLocationGroupKey,
  buildMonthRanges,
  buildPeriodInfo,
  buildRequestRecord,
  fetchDailyMinuteStats,
  fetchDeviceStats,
  fetchHourlySpread,
  fetchLocationStats,
  fetchMonthlyMinuteStats,
  fetchPackageStats,
  getDeviceId,
  getLocation,
  getMinuteLoggerDashboard,
  getPackageName,
  incrementMinuteLoggerStats,
  normalizeDimension,
  parseLocationValue,
  recordMinuteLoggerRequest,
  serializeValue,
  summarizeLocationGroups,
  summarizeTimeBuckets,
};
