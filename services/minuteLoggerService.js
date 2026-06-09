const MinuteLoggerRequest = require('../models/minute_logger_request');
const MinuteLoggerStat = require('../models/minute_logger_stat');
const MinuteLoggerLocationGroup = require('../models/minute_logger_location_group');
const { ensureMinuteLoggerPath } = require('../utils/minuteLoggerPath');

const MINUTE_LOGGER_RAW_RETENTION_DAYS = 60;
const MINUTE_LOGGER_STATS_RETENTION_YEARS = 10;
const MINUTE_LOGGER_RECENT_LIMIT = 50;
const UNKNOWN_DIMENSION = 'unknown';
const MINUTE_LOGGER_UNUSED_PACKAGE = 'unused';
const MINUTE_LOGGER_RESPONSE_BODY = { message: 'OK' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_LOGGER_LOCATION_GROUP_PRECISION = 3;
const MINUTE_LOGGER_LOCATION_NOISE_MINUTES = 3;
const MINUTE_LOGGER_LOCATION_GROUP_LIMIT = 20;
const MINUTE_LOGGER_LOCATION_POINT_SAMPLE_LIMIT = 180;
const MINUTE_LOGGER_LOCATION_GROUP_NAME_MAX_LENGTH = 80;
const MINUTE_LOGGER_ANALYTICS_POINT_SAMPLE_LIMIT = 420;
const MINUTE_LOGGER_BATTERY_WINDOW_HOURS = 12;
const MINUTE_LOGGER_BATTERY_MIN = 0;
const MINUTE_LOGGER_BATTERY_MAX = 100;
const MINUTE_LOGGER_BATTERY_TEMP_C_MIN = -50;
const MINUTE_LOGGER_BATTERY_TEMP_C_MAX = 120;
const MINUTE_LOGGER_BATTERY_PACKAGE_COLORS = [
  '#FF6A1F',
  '#19E3E3',
  '#17C696',
  '#FFC247',
  '#FF7E79',
  '#7C8CFF',
  '#B86BFF',
  '#33B1FF',
  '#B9E769',
  '#FF9F45',
  '#55D6BE',
  '#F45B69',
];

const TIME_BUCKETS = [
  { key: 'morning', label: 'Morning', startHour: 5, endHour: 11 },
  { key: 'afternoon', label: 'Afternoon', startHour: 12, endHour: 16 },
  { key: 'evening', label: 'Evening', startHour: 17, endHour: 21 },
  { key: 'night', label: 'Night', startHour: 22, endHour: 4 },
];

class MinuteLoggerLocationGroupSettingsError extends Error {
  constructor(message, status = 400, code = 'invalid_location_group_settings') {
    super(message);
    this.name = 'MinuteLoggerLocationGroupSettingsError';
    this.status = status;
    this.code = code;
  }
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

function normalizeLocationGroupKey(value) {
  const candidate = firstPresentValue(value);
  const text = String(candidate ?? '').trim();
  const parts = text.split(',');

  if (parts.length !== 2) {
    throw new MinuteLoggerLocationGroupSettingsError('Location group must be a latitude,longitude pair.');
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    throw new MinuteLoggerLocationGroupSettingsError('Location group coordinates are out of range.');
  }

  return `${parts[0].trim()},${parts[1].trim()}`;
}

function normalizeLocationGroupName(value) {
  return String(firstPresentValue(value) ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, MINUTE_LOGGER_LOCATION_GROUP_NAME_MAX_LENGTH);
}

function parseBooleanInput(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => parseBooleanInput(entry));
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function parseActiveInput(value) {
  const candidate = firstPresentValue(value);

  if (candidate === undefined || candidate === null) {
    return true;
  }

  if (typeof candidate === 'boolean') {
    return candidate;
  }

  if (typeof candidate === 'number') {
    return candidate !== 0;
  }

  const text = String(candidate).trim().toLowerCase();
  if (!text) {
    return true;
  }

  return !['0', 'false', 'no', 'off', 'inactive', 'unused', 'idle'].includes(text);
}

function normalizeLocationGroupSetting(raw = {}) {
  const name = normalizeLocationGroupName(raw.name);

  return {
    endpointPath: raw.endpointPath || '',
    groupKey: raw.groupKey || '',
    name,
    hideCoordinates: Boolean(raw.hideCoordinates && name),
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

function getRequestActive(req) {
  return parseActiveInput(
    getInputValue(req, ['active', 'isActive', 'deviceActive'], ['x-active', 'x-device-active'])
  );
}

function isActiveUsageRequest(row = {}) {
  return row.active !== false
    && String(row.package || '').trim().toLowerCase() !== MINUTE_LOGGER_UNUSED_PACKAGE;
}

function buildActiveUsageMatch(match = {}) {
  return {
    ...match,
    active: { $ne: false },
    package: { $ne: MINUTE_LOGGER_UNUSED_PACKAGE },
  };
}

function parseNumericInput(value) {
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

  const match = text.replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/u);
  if (!match) {
    return null;
  }

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parseBoundedNumber(value, min, max, digits = null) {
  const number = parseNumericInput(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    return null;
  }

  if (Number.isInteger(digits) && digits >= 0) {
    return Number(number.toFixed(digits));
  }

  return number;
}

function parseBatteryPercent(value) {
  return parseBoundedNumber(value, MINUTE_LOGGER_BATTERY_MIN, MINUTE_LOGGER_BATTERY_MAX, 1);
}

function parseBatteryTempC(value) {
  return parseBoundedNumber(value, MINUTE_LOGGER_BATTERY_TEMP_C_MIN, MINUTE_LOGGER_BATTERY_TEMP_C_MAX, 1);
}

function getBatteryPercent(req) {
  return parseBatteryPercent(getInputValue(
    req,
    ['battery', 'batteryPercent', 'battery_percent', 'batteryLevel', 'battery_level'],
    ['x-battery', 'x-battery-percent', 'x-battery-level']
  ));
}

function getBatteryTempC(req) {
  return parseBatteryTempC(getInputValue(
    req,
    ['battery_temp', 'batteryTemp', 'batteryTempC', 'battery_temperature', 'battery_temperature_c'],
    ['x-battery-temp', 'x-battery-temp-c', 'x-battery-temperature']
  ));
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

function parseDateKey(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function buildDayRangeFromDateKey(dateKey) {
  const start = parseDateKey(dateKey);

  if (!start) {
    return null;
  }

  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return {
    dateKey: formatDayKey(start),
    start,
    end,
  };
}

function getMinuteOfDay(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return (date.getHours() * 60) + date.getMinutes();
}

function createCountBucket() {
  return {
    minutes: 0,
    devices: new Set(),
    packages: new Set(),
    firstSeen: null,
    lastSeen: null,
    locatedMinutes: 0,
  };
}

function updateSeenRange(bucket, receivedAt) {
  const date = receivedAt ? new Date(receivedAt) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return;
  }

  if (!bucket.firstSeen || date < bucket.firstSeen) {
    bucket.firstSeen = date;
  }

  if (!bucket.lastSeen || date > bucket.lastSeen) {
    bucket.lastSeen = date;
  }
}

function getSafeRequestDate(row = {}) {
  const date = new Date(row.receivedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValidRequestLocation(row = {}) {
  const latitude = Number(row?.location?.latitude);
  const longitude = Number(row?.location?.longitude);
  return isValidLatitude(latitude) && isValidLongitude(longitude);
}

function getRequestLatitude(row = {}) {
  const latitude = Number(row?.location?.latitude);
  return isValidLatitude(latitude) ? latitude : null;
}

function getRequestLongitude(row = {}) {
  const longitude = Number(row?.location?.longitude);
  return isValidLongitude(longitude) ? longitude : null;
}

function getRowBatteryPercent(row = {}) {
  const normalized = parseBatteryPercent(row.battery);
  if (normalized !== null) {
    return normalized;
  }

  const body = row && typeof row.body === 'object' && !Array.isArray(row.body) ? row.body : {};
  return parseBatteryPercent(firstPresentValue([
    body.battery,
    body.batteryPercent,
    body.battery_percent,
    body.batteryLevel,
    body.battery_level,
  ]));
}

function getRowBatteryTempC(row = {}) {
  const normalized = parseBatteryTempC(row.batteryTempC);
  if (normalized !== null) {
    return normalized;
  }

  const body = row && typeof row.body === 'object' && !Array.isArray(row.body) ? row.body : {};
  return parseBatteryTempC(firstPresentValue([
    body.battery_temp,
    body.batteryTemp,
    body.batteryTempC,
    body.battery_temperature,
    body.battery_temperature_c,
  ]));
}

function createReadingAccumulator() {
  return {
    count: 0,
    total: 0,
    min: null,
    max: null,
    latest: null,
    latestAt: null,
    latestDeviceId: null,
  };
}

function addReading(accumulator, value, row = {}) {
  if (!Number.isFinite(value)) {
    return;
  }

  const receivedAt = getSafeRequestDate(row);
  const deviceId = normalizeDimension(row.deviceId, UNKNOWN_DIMENSION);

  accumulator.count += 1;
  accumulator.total += value;
  accumulator.min = accumulator.min === null ? value : Math.min(accumulator.min, value);
  accumulator.max = accumulator.max === null ? value : Math.max(accumulator.max, value);

  if (
    accumulator.latest === null
    || (receivedAt && (!accumulator.latestAt || receivedAt >= accumulator.latestAt))
  ) {
    accumulator.latest = value;
    accumulator.latestAt = receivedAt;
    accumulator.latestDeviceId = deviceId;
  }
}

function finalizeReadingAccumulator(accumulator) {
  const count = Number(accumulator.count) || 0;

  return {
    count,
    average: count > 0 ? accumulator.total / count : null,
    min: accumulator.min,
    max: accumulator.max,
    latest: accumulator.latest,
    latestAt: accumulator.latestAt,
    latestDeviceId: accumulator.latestDeviceId,
  };
}

function summarizeBatteryReadings(rows = []) {
  const battery = createReadingAccumulator();
  const batteryTempC = createReadingAccumulator();
  const deviceMap = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const batteryValue = getRowBatteryPercent(row);
    const tempValue = getRowBatteryTempC(row);

    if (batteryValue === null && tempValue === null) {
      return;
    }

    const deviceId = normalizeDimension(row.deviceId, UNKNOWN_DIMENSION);
    if (!deviceMap.has(deviceId)) {
      deviceMap.set(deviceId, {
        deviceId,
        battery: createReadingAccumulator(),
        batteryTempC: createReadingAccumulator(),
      });
    }

    const device = deviceMap.get(deviceId);
    addReading(battery, batteryValue, row);
    addReading(device.battery, batteryValue, row);
    addReading(batteryTempC, tempValue, row);
    addReading(device.batteryTempC, tempValue, row);
  });

  const deviceStats = Array.from(deviceMap.values())
    .map((device) => ({
      deviceId: device.deviceId,
      battery: finalizeReadingAccumulator(device.battery),
      batteryTempC: finalizeReadingAccumulator(device.batteryTempC),
    }))
    .sort((left, right) => {
      const leftLatest = Math.max(
        new Date(left.battery.latestAt || 0).getTime(),
        new Date(left.batteryTempC.latestAt || 0).getTime()
      );
      const rightLatest = Math.max(
        new Date(right.battery.latestAt || 0).getTime(),
        new Date(right.batteryTempC.latestAt || 0).getTime()
      );

      if (rightLatest !== leftLatest) {
        return rightLatest - leftLatest;
      }

      return left.deviceId.localeCompare(right.deviceId);
    });

  return {
    battery: finalizeReadingAccumulator(battery),
    batteryTempC: finalizeReadingAccumulator(batteryTempC),
    deviceStats,
  };
}

function hashString(value) {
  return String(value || '').split('').reduce((hash, character) => {
    return ((hash << 5) - hash) + character.charCodeAt(0);
  }, 0);
}

function getBatteryPackageColor(packageName) {
  const safeIndex = Math.abs(hashString(packageName)) % MINUTE_LOGGER_BATTERY_PACKAGE_COLORS.length;
  return MINUTE_LOGGER_BATTERY_PACKAGE_COLORS[safeIndex % MINUTE_LOGGER_BATTERY_PACKAGE_COLORS.length];
}

function buildBatteryDashboardPackageRows(rows = []) {
  const packageCounts = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!isActiveUsageRequest(row)) {
      return;
    }

    const packageName = normalizeDimension(row.package, UNKNOWN_DIMENSION);
    packageCounts.set(packageName, (packageCounts.get(packageName) || 0) + 1);
  });

  return Array.from(packageCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .map((entry) => ({
      ...entry,
      color: getBatteryPackageColor(entry.name),
    }));
}

function buildBatteryDashboardPoints(rows = [], packages = []) {
  const packageIndexByName = new Map((Array.isArray(packages) ? packages : [])
    .map((entry, index) => [entry.name, index]));

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const receivedAt = getSafeRequestDate(row);

      if (!receivedAt) {
        return null;
      }

      const packageName = isActiveUsageRequest(row)
        ? normalizeDimension(row.package, UNKNOWN_DIMENSION)
        : null;
      const packageIndex = packageName && packageIndexByName.has(packageName)
        ? packageIndexByName.get(packageName)
        : null;

      return {
        t: receivedAt.getTime(),
        b: getRowBatteryPercent(row),
        c: getRowBatteryTempC(row),
        p: packageIndex,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
}

function parseLocationGroupKeyCenter(groupKey) {
  const parts = String(groupKey || '').split(',');

  if (parts.length !== 2) {
    return null;
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function buildLocationBounds(points = [], fallbackSettings = []) {
  const coordinates = [];

  (Array.isArray(points) ? points : []).forEach((point) => {
    const latitude = Number(point?.latitude ?? point?.location?.latitude);
    const longitude = Number(point?.longitude ?? point?.location?.longitude);

    if (isValidLatitude(latitude) && isValidLongitude(longitude)) {
      coordinates.push({ latitude, longitude });
    }
  });

  (Array.isArray(fallbackSettings) ? fallbackSettings : []).forEach((setting) => {
    const center = parseLocationGroupKeyCenter(setting.groupKey);

    if (center) {
      coordinates.push(center);
    }
  });

  if (!coordinates.length) {
    return null;
  }

  return coordinates.reduce((bounds, point) => ({
    minLatitude: Math.min(bounds.minLatitude, point.latitude),
    maxLatitude: Math.max(bounds.maxLatitude, point.latitude),
    minLongitude: Math.min(bounds.minLongitude, point.longitude),
    maxLongitude: Math.max(bounds.maxLongitude, point.longitude),
  }), {
    minLatitude: coordinates[0].latitude,
    maxLatitude: coordinates[0].latitude,
    minLongitude: coordinates[0].longitude,
    maxLongitude: coordinates[0].longitude,
  });
}

function isPointWithinBounds(point, bounds) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);

  if (!bounds || !isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return false;
  }

  return latitude >= bounds.minLatitude
    && latitude <= bounds.maxLatitude
    && longitude >= bounds.minLongitude
    && longitude <= bounds.maxLongitude;
}

function ensureNamedLocationLabelBucket(bucketsByName, name) {
  const normalizedName = normalizeLocationGroupName(name);

  if (!normalizedName) {
    return null;
  }

  if (!bucketsByName.has(normalizedName)) {
    bucketsByName.set(normalizedName, {
      name: normalizedName,
      groupKeys: new Set(),
      latitudeTotal: 0,
      longitudeTotal: 0,
      pointCount: 0,
      fallbackLatitudeTotal: 0,
      fallbackLongitudeTotal: 0,
      fallbackCount: 0,
      hideCoordinates: true,
    });
  }

  return bucketsByName.get(normalizedName);
}

function addNamedLocationLabelCoordinate(bucket, latitude, longitude, weight = 1, fallback = false) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const count = Number(weight) || 0;

  if (!bucket || !isValidLatitude(lat) || !isValidLongitude(lon) || count <= 0) {
    return;
  }

  if (fallback) {
    bucket.fallbackLatitudeTotal += lat * count;
    bucket.fallbackLongitudeTotal += lon * count;
    bucket.fallbackCount += count;
    return;
  }

  bucket.latitudeTotal += lat * count;
  bucket.longitudeTotal += lon * count;
  bucket.pointCount += count;
}

function createNamedLocationLabelBuckets(namedSettings = []) {
  const bucketsByName = new Map();

  (Array.isArray(namedSettings) ? namedSettings : []).forEach((setting) => {
    const bucket = ensureNamedLocationLabelBucket(bucketsByName, setting?.name);

    if (!bucket) {
      return;
    }

    const groupKey = String(setting.groupKey || '').trim();
    if (groupKey) {
      bucket.groupKeys.add(groupKey);
    }
    bucket.hideCoordinates = bucket.hideCoordinates && Boolean(setting.hideCoordinates);

    const latitude = Number(setting.latitude);
    const longitude = Number(setting.longitude);
    const center = isValidLatitude(latitude) && isValidLongitude(longitude)
      ? { latitude, longitude }
      : parseLocationGroupKeyCenter(groupKey);

    if (center) {
      addNamedLocationLabelCoordinate(bucket, center.latitude, center.longitude, 1, true);
    }
  });

  return bucketsByName;
}

function buildNamedLocationNameLookup(namedSettings = []) {
  const nameByGroupKey = new Map();

  (Array.isArray(namedSettings) ? namedSettings : []).forEach((setting) => {
    const groupKey = String(setting?.groupKey || '').trim();
    const name = normalizeLocationGroupName(setting?.name);

    if (groupKey && name) {
      nameByGroupKey.set(groupKey, name);
    }
  });

  return nameByGroupKey;
}

function getLocationPointLatitude(point = {}) {
  const latitude = Number(point?.latitude ?? point?.location?.latitude);
  return isValidLatitude(latitude) ? latitude : null;
}

function getLocationPointLongitude(point = {}) {
  const longitude = Number(point?.longitude ?? point?.location?.longitude);
  return isValidLongitude(longitude) ? longitude : null;
}

function getLocationPointGroupKey(point = {}) {
  const explicitGroupKey = String(point?.groupKey || point?.location?.groupKey || '').trim();
  if (explicitGroupKey) {
    return explicitGroupKey;
  }

  const latitude = getLocationPointLatitude(point);
  const longitude = getLocationPointLongitude(point);

  if (latitude !== null && longitude !== null) {
    return buildLocationGroupKey(latitude, longitude);
  }

  return '';
}

function addNamedLocationLabelPoint(bucketsByName, nameByGroupKey, point = {}) {
  const groupKey = getLocationPointGroupKey(point);
  const name = normalizeLocationGroupName(point?.name) || nameByGroupKey.get(groupKey);
  const bucket = ensureNamedLocationLabelBucket(bucketsByName, name);
  const latitude = getLocationPointLatitude(point);
  const longitude = getLocationPointLongitude(point);

  if (!bucket || latitude === null || longitude === null) {
    return;
  }

  if (groupKey) {
    bucket.groupKeys.add(groupKey);
  }
  addNamedLocationLabelCoordinate(bucket, latitude, longitude);
}

function addNamedLocationAggregateRow(bucketsByName, nameByGroupKey, row = {}) {
  const groupKey = String(row.groupKey || row._id || '').trim();
  const name = nameByGroupKey.get(groupKey);
  const bucket = ensureNamedLocationLabelBucket(bucketsByName, name);
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const count = Number(row.count || row.minutes) || 0;

  if (!bucket || !groupKey || !isValidLatitude(latitude) || !isValidLongitude(longitude) || count <= 0) {
    return;
  }

  bucket.groupKeys.add(groupKey);
  addNamedLocationLabelCoordinate(bucket, latitude, longitude, count);
}

function finalizeNamedLocationLabelBuckets(bucketsByName, bounds = null) {
  return Array.from(bucketsByName.values())
    .map((bucket) => {
      const pointCount = Number(bucket.pointCount) || 0;
      const fallbackCount = Number(bucket.fallbackCount) || 0;
      const count = pointCount || fallbackCount;

      if (count <= 0) {
        return null;
      }

      const latitudeTotal = pointCount ? bucket.latitudeTotal : bucket.fallbackLatitudeTotal;
      const longitudeTotal = pointCount ? bucket.longitudeTotal : bucket.fallbackLongitudeTotal;

      return {
        name: bucket.name,
        groupKey: Array.from(bucket.groupKeys).sort().join('|'),
        groupKeys: Array.from(bucket.groupKeys).sort(),
        latitude: latitudeTotal / count,
        longitude: longitudeTotal / count,
        pointCount,
        hideCoordinates: Boolean(bucket.hideCoordinates),
      };
    })
    .filter(Boolean)
    .filter((label) => !bounds || isPointWithinBounds(label, bounds))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildNamedLocationLabels(namedSettings = [], bounds = null, points = []) {
  const bucketsByName = createNamedLocationLabelBuckets(namedSettings);
  const nameByGroupKey = buildNamedLocationNameLookup(namedSettings);

  (Array.isArray(points) ? points : []).forEach((point) => {
    addNamedLocationLabelPoint(bucketsByName, nameByGroupKey, point);
  });

  return finalizeNamedLocationLabelBuckets(bucketsByName, bounds);
}

function sampleEvenly(rows = [], limit = MINUTE_LOGGER_ANALYTICS_POINT_SAMPLE_LIMIT) {
  const source = Array.isArray(rows) ? rows : [];
  const safeLimit = Number.isInteger(limit) && limit > 0
    ? limit
    : MINUTE_LOGGER_ANALYTICS_POINT_SAMPLE_LIMIT;

  if (source.length <= safeLimit) {
    return source.slice();
  }

  if (safeLimit === 1) {
    return [source[0]];
  }

  const step = (source.length - 1) / (safeLimit - 1);
  return Array.from({ length: safeLimit }, (_, index) => source[Math.round(index * step)]);
}

function mapBreakdownBucket(name, bucket) {
  return {
    name,
    minutes: bucket.minutes,
    deviceCount: bucket.devices.size,
    packageCount: bucket.packages.size,
    firstSeen: bucket.firstSeen,
    lastSeen: bucket.lastSeen,
    locatedMinutes: bucket.locatedMinutes,
  };
}

function sortBreakdownRows(rows = []) {
  return rows.slice().sort((left, right) => {
    if (right.minutes !== left.minutes) {
      return right.minutes - left.minutes;
    }

    return String(left.name).localeCompare(String(right.name));
  });
}

function buildRequestBreakdown(rows = [], keyGetter = () => UNKNOWN_DIMENSION) {
  const buckets = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = normalizeDimension(keyGetter(row), UNKNOWN_DIMENSION);

    if (!buckets.has(key)) {
      buckets.set(key, createCountBucket());
    }

    const bucket = buckets.get(key);
    bucket.minutes += 1;
    bucket.devices.add(normalizeDimension(row.deviceId, UNKNOWN_DIMENSION));
    bucket.packages.add(normalizeDimension(row.package, UNKNOWN_DIMENSION));
    if (hasValidRequestLocation(row)) {
      bucket.locatedMinutes += 1;
    }
    updateSeenRange(bucket, row.receivedAt);
  });

  return sortBreakdownRows(Array.from(buckets.entries()).map(([name, bucket]) => {
    return mapBreakdownBucket(name, bucket);
  }));
}

function buildHourlyCounts(rows = []) {
  const minutesByHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    minutes: 0,
  }));

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = getSafeRequestDate(row);

    if (date) {
      minutesByHour[date.getHours()].minutes += 1;
    }
  });

  return minutesByHour;
}

function buildDailyCounts(rows = [], ranges = []) {
  const safeRanges = Array.isArray(ranges) ? ranges : [];
  const hasRangeFilter = safeRanges.length > 0;
  const rowMap = new Map(safeRanges
    .map((range) => [range.dateKey, 0]));

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = getSafeRequestDate(row);

    if (!date) {
      return;
    }

    const dateKey = formatDayKey(date);
    if (hasRangeFilter && !rowMap.has(dateKey)) {
      return;
    }

    rowMap.set(dateKey, (rowMap.get(dateKey) || 0) + 1);
  });

  return Array.from(rowMap.entries()).map(([dateKey, minutes]) => ({
    dateKey,
    minutes,
  }));
}

function buildTransitionRows(rows = [], keyGetter = () => UNKNOWN_DIMENSION, limit = 8) {
  const counts = new Map();
  let previousKey = null;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const currentKey = normalizeDimension(keyGetter(row), UNKNOWN_DIMENSION);

    if (previousKey !== null && previousKey !== currentKey) {
      const key = `${previousKey}\u0000${currentKey}`;
      const existing = counts.get(key) || {
        from: previousKey,
        to: currentKey,
        count: 0,
      };
      existing.count += 1;
      counts.set(key, existing);
    }

    previousKey = currentKey;
  });

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
    .slice(0, limit);
}

function buildQuietGapSummary(rows = []) {
  let longestGapMinutes = 0;
  let longestGapStart = null;
  let longestGapEnd = null;

  for (let index = 1; index < rows.length; index += 1) {
    const previous = getSafeRequestDate(rows[index - 1]);
    const current = getSafeRequestDate(rows[index]);

    if (!previous || !current) {
      continue;
    }

    const gapMinutes = Math.max(0, Math.round((current.getTime() - previous.getTime()) / 60000) - 1);

    if (gapMinutes > longestGapMinutes) {
      longestGapMinutes = gapMinutes;
      longestGapStart = previous;
      longestGapEnd = current;
    }
  }

  return {
    longestGapMinutes,
    longestGapStart,
    longestGapEnd,
  };
}

function buildDevicePackageMatrix(rows = [], limit = 10) {
  const deviceMap = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const deviceId = normalizeDimension(row.deviceId, UNKNOWN_DIMENSION);
    const packageName = normalizeDimension(row.package, UNKNOWN_DIMENSION);

    if (!deviceMap.has(deviceId)) {
      deviceMap.set(deviceId, {
        deviceId,
        minutes: 0,
        packages: new Map(),
      });
    }

    const device = deviceMap.get(deviceId);
    device.minutes += 1;
    device.packages.set(packageName, (device.packages.get(packageName) || 0) + 1);
  });

  return Array.from(deviceMap.values())
    .map((device) => ({
      deviceId: device.deviceId,
      minutes: device.minutes,
      packages: Array.from(device.packages.entries())
        .map(([name, minutes]) => ({ name, minutes }))
        .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name))
        .slice(0, 5),
    }))
    .sort((left, right) => right.minutes - left.minutes || left.deviceId.localeCompare(right.deviceId))
    .slice(0, limit);
}

function buildLocationGroupSummaries(rows = [], settingsByKey = new Map(), options = {}) {
  const groupsByKey = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!hasValidRequestLocation(row)) {
      return;
    }

    const groupKey = getRequestLocationGroupKey(row);
    const latitude = getRequestLatitude(row);
    const longitude = getRequestLongitude(row);

    if (!groupKey || latitude === null || longitude === null) {
      return;
    }

    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        groupKey,
        minutes: 0,
        latitudeTotal: 0,
        longitudeTotal: 0,
        devices: new Set(),
        packages: new Set(),
        firstSeen: null,
        lastSeen: null,
        pointSamples: [],
      });
    }

    const group = groupsByKey.get(groupKey);
    group.minutes += 1;
    group.latitudeTotal += latitude;
    group.longitudeTotal += longitude;
    group.devices.add(normalizeDimension(row.deviceId, UNKNOWN_DIMENSION));
    group.packages.add(normalizeDimension(row.package, UNKNOWN_DIMENSION));
    group.pointSamples.push({
      latitude,
      longitude,
      receivedAt: row.receivedAt || null,
    });
    updateSeenRange(group, row.receivedAt);
  });

  const sampleLimit = Number.isInteger(options.pointSampleLimit) && options.pointSampleLimit > 0
    ? options.pointSampleLimit
    : MINUTE_LOGGER_LOCATION_POINT_SAMPLE_LIMIT;

  return Array.from(groupsByKey.values())
    .map((group) => {
      const setting = settingsByKey.get(group.groupKey) || {};

      return {
        groupKey: group.groupKey,
        latitude: group.minutes > 0 ? group.latitudeTotal / group.minutes : null,
        longitude: group.minutes > 0 ? group.longitudeTotal / group.minutes : null,
        minutes: group.minutes,
        deviceCount: group.devices.size,
        packageCount: group.packages.size,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        pointSamples: sampleEvenly(group.pointSamples, sampleLimit),
        name: setting.name || '',
        hideCoordinates: Boolean(setting.hideCoordinates),
      };
    })
    .sort((left, right) => {
      if (right.minutes !== left.minutes) {
        return right.minutes - left.minutes;
      }

      return String(left.groupKey).localeCompare(String(right.groupKey));
    });
}

function buildRequestRecord(req, options = {}) {
  const now = new Date(options.now || Date.now());
  const endpointPath = options.endpointPath || req?.baseUrl || '';
  const active = getRequestActive(req);
  const packageName = active ? getPackageName(req) : MINUTE_LOGGER_UNUSED_PACKAGE;
  const deviceId = getDeviceId(req);
  const location = getLocation(req);
  const battery = getBatteryPercent(req);
  const batteryTempC = getBatteryTempC(req);

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
    active,
    location,
    battery,
    batteryTempC,
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
  if (isActiveUsageRequest(record)) {
    await incrementMinuteLoggerStats({
      now,
      endpointPath: record.endpointPath,
      deviceId: record.deviceId,
      package: record.package,
    }, {
      statModel,
    });
  }

  return {
    logged: true,
    active: record.active,
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
        package: { $ne: MINUTE_LOGGER_UNUSED_PACKAGE },
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
        package: { $ne: MINUTE_LOGGER_UNUSED_PACKAGE },
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
  const match = buildActiveUsageMatch({ endpointPath });

  if (since) {
    match.receivedAt = { $gte: since };
  }

  const rows = await requestModel.aggregate([
    {
      $match: match,
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
  const match = buildActiveUsageMatch({ endpointPath });

  if (since) {
    match.receivedAt = { $gte: since };
  }

  const rows = await requestModel.aggregate([
    {
      $match: match,
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

async function fetchBatteryStats(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const match = {
    endpointPath,
    $or: [
      { battery: { $gte: MINUTE_LOGGER_BATTERY_MIN, $lte: MINUTE_LOGGER_BATTERY_MAX } },
      { batteryTempC: { $gte: MINUTE_LOGGER_BATTERY_TEMP_C_MIN, $lte: MINUTE_LOGGER_BATTERY_TEMP_C_MAX } },
      { 'body.battery': { $exists: true } },
      { 'body.batteryPercent': { $exists: true } },
      { 'body.battery_percent': { $exists: true } },
      { 'body.batteryLevel': { $exists: true } },
      { 'body.battery_level': { $exists: true } },
      { 'body.battery_temp': { $exists: true } },
      { 'body.batteryTemp': { $exists: true } },
      { 'body.batteryTempC': { $exists: true } },
      { 'body.battery_temperature': { $exists: true } },
      { 'body.battery_temperature_c': { $exists: true } },
    ],
  };

  if (since) {
    match.receivedAt = { $gte: since };
  }

  const rows = await leanExec(requestModel.find(match)
    .sort({ receivedAt: 1 })
    .select({
      deviceId: 1,
      battery: 1,
      batteryTempC: 1,
      body: 1,
      receivedAt: 1,
    }));

  return summarizeBatteryReadings(rows);
}

async function getMinuteLoggerLocationGroupSettings(endpointPath, groupKeys = [], options = {}) {
  const settingsModel = options.settingsModel || MinuteLoggerLocationGroup;
  const keys = Array.from(new Set((Array.isArray(groupKeys) ? groupKeys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)));

  if (!keys.length || !endpointPath) {
    return new Map();
  }

  const rows = await leanExec(settingsModel.find({
    endpointPath,
    groupKey: { $in: keys },
  }));
  const settingsByKey = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || !row.groupKey) {
      return;
    }

    settingsByKey.set(row.groupKey, normalizeLocationGroupSetting(row));
  });

  return settingsByKey;
}

async function fetchNamedLocationGroupSettings(endpointPath, options = {}) {
  const settingsModel = options.settingsModel || MinuteLoggerLocationGroup;

  if (!endpointPath) {
    return [];
  }

  const rows = await leanExec(settingsModel.find({
    endpointPath,
    name: { $type: 'string', $ne: '' },
  })
    .sort({ name: 1, groupKey: 1 }));

  return (Array.isArray(rows) ? rows : [])
    .map(normalizeLocationGroupSetting)
    .filter((row) => row.name)
    .map((row) => {
      const center = parseLocationGroupKeyCenter(row.groupKey);

      return {
        ...row,
        latitude: center ? center.latitude : null,
        longitude: center ? center.longitude : null,
      };
    });
}

async function fetchNamedLocationCenterLabels(endpointPath, namedSettings = [], options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const groupKeys = Array.from(new Set((Array.isArray(namedSettings) ? namedSettings : [])
    .map((setting) => String(setting?.groupKey || '').trim())
    .filter(Boolean)));

  if (!endpointPath || !groupKeys.length || typeof requestModel.aggregate !== 'function') {
    return [];
  }

  const match = {
    endpointPath,
    'location.groupKey': { $in: groupKeys },
    'location.latitude': { $gte: -90, $lte: 90 },
    'location.longitude': { $gte: -180, $lte: 180 },
  };

  if (options.since) {
    match.receivedAt = { $gte: options.since };
  }

  const rows = await requestModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$location.groupKey',
        count: { $sum: 1 },
        latitude: { $avg: '$location.latitude' },
        longitude: { $avg: '$location.longitude' },
      },
    },
    {
      $project: {
        _id: 0,
        groupKey: '$_id',
        count: 1,
        latitude: 1,
        longitude: 1,
      },
    },
  ]);
  const bucketsByName = createNamedLocationLabelBuckets(namedSettings);
  const nameByGroupKey = buildNamedLocationNameLookup(namedSettings);

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    addNamedLocationAggregateRow(bucketsByName, nameByGroupKey, row);
  });

  return finalizeNamedLocationLabelBuckets(bucketsByName)
    .filter((label) => label.pointCount > 0);
}

function getRequestLocationGroupKey(request = {}) {
  const explicitGroupKey = String(request?.location?.groupKey || '').trim();
  if (explicitGroupKey) {
    return explicitGroupKey;
  }

  const latitude = Number(request?.location?.latitude);
  const longitude = Number(request?.location?.longitude);
  if (isValidLatitude(latitude) && isValidLongitude(longitude)) {
    return buildLocationGroupKey(latitude, longitude);
  }

  return '';
}

async function fetchLastKnownNamedLocation(endpointPath, recentRequests = [], options = {}) {
  const latestRequest = Array.isArray(recentRequests) ? recentRequests[0] : null;
  const groupKey = getRequestLocationGroupKey(latestRequest);

  if (!endpointPath || !latestRequest || !groupKey) {
    return null;
  }

  const settingsByKey = await getMinuteLoggerLocationGroupSettings(endpointPath, [groupKey], {
    settingsModel: options.settingsModel,
  });
  const setting = settingsByKey.get(groupKey);
  const name = normalizeLocationGroupName(setting?.name);

  if (!name) {
    return null;
  }

  const latitude = Number(latestRequest?.location?.latitude);
  const longitude = Number(latestRequest?.location?.longitude);

  return {
    name,
    groupKey,
    hideCoordinates: Boolean(setting.hideCoordinates),
    deviceId: normalizeDimension(latestRequest.deviceId, UNKNOWN_DIMENSION),
    package: normalizeDimension(latestRequest.package, UNKNOWN_DIMENSION),
    receivedAt: latestRequest.receivedAt || null,
    latitude: isValidLatitude(latitude) ? latitude : null,
    longitude: isValidLongitude(longitude) ? longitude : null,
  };
}

async function updateMinuteLoggerLocationGroupSettings(input = {}, options = {}) {
  const settingsModel = options.settingsModel || MinuteLoggerLocationGroup;
  const endpointPath = options.endpointPath || ensureMinuteLoggerPath();
  const groupKey = normalizeLocationGroupKey(input.groupKey);
  const name = normalizeLocationGroupName(input.name);
  const hideCoordinates = Boolean(name && parseBooleanInput(input.hideCoordinates));
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;

  if (!name && !hideCoordinates) {
    await leanExec(settingsModel.deleteOne({ endpointPath, groupKey }));
    return normalizeLocationGroupSetting({ endpointPath, groupKey });
  }

  const updated = await leanExec(settingsModel.findOneAndUpdate(
    { endpointPath, groupKey },
    {
      $set: {
        name,
        hideCoordinates,
        updatedBy,
      },
      $setOnInsert: {
        endpointPath,
        groupKey,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeLocationGroupSetting(updated);
}

async function fetchLocationPointSamples(endpointPath, groupKeys = [], options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, MINUTE_LOGGER_LOCATION_POINT_SAMPLE_LIMIT)
    : MINUTE_LOGGER_LOCATION_POINT_SAMPLE_LIMIT;
  const keys = Array.from(new Set((Array.isArray(groupKeys) ? groupKeys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)));
  const samplesByKey = new Map(keys.map((key) => [key, []]));

  if (!endpointPath || !keys.length) {
    return samplesByKey;
  }

  await Promise.all(keys.map(async (groupKey) => {
    const rows = await leanExec(requestModel.find({
      endpointPath,
      receivedAt: { $gte: since },
      'location.groupKey': groupKey,
      'location.latitude': { $gte: -90, $lte: 90 },
      'location.longitude': { $gte: -180, $lte: 180 },
    })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .select({
        'location.latitude': 1,
        'location.longitude': 1,
        receivedAt: 1,
      }));

    samplesByKey.set(groupKey, (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const latitude = Number(row?.location?.latitude);
        const longitude = Number(row?.location?.longitude);

        if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
          return null;
        }

        return {
          latitude,
          longitude,
          receivedAt: row.receivedAt || null,
        };
      })
      .filter(Boolean));
  }));

  return samplesByKey;
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
    pointSamples: Array.isArray(row.pointSamples) ? row.pointSamples : [],
    name: normalizeLocationGroupName(row.name),
    hideCoordinates: Boolean(row.hideCoordinates && row.name),
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
  const summary = summarizeLocationGroups(rows, {
    minMinutes: options.minMinutes,
    limit: options.limit,
  });
  const groupKeys = summary.groups.map((group) => group.groupKey).filter(Boolean);
  const [
    pointSamplesByKey,
    settingsByKey,
  ] = await Promise.all([
    fetchLocationPointSamples(endpointPath, groupKeys, {
      requestModel,
      since,
      limit: options.pointSampleLimit,
    }),
    getMinuteLoggerLocationGroupSettings(endpointPath, groupKeys, {
      settingsModel: options.locationGroupSettingsModel,
    }),
  ]);

  summary.groups = summary.groups.map((group) => {
    const setting = settingsByKey.get(group.groupKey) || {};

    return {
      ...group,
      pointSamples: pointSamplesByKey.get(group.groupKey) || [],
      name: setting.name || '',
      hideCoordinates: Boolean(setting.hideCoordinates),
    };
  });

  return summary;
}

function buildLocationTimeline(rows = [], settingsByKey = new Map(), namedSettings = [], realNamedLocationLabels = []) {
  const points = (Array.isArray(rows) ? rows : [])
    .filter(hasValidRequestLocation)
    .map((row) => {
      const groupKey = getRequestLocationGroupKey(row);
      const setting = settingsByKey.get(groupKey) || {};
      const latitude = getRequestLatitude(row);
      const longitude = getRequestLongitude(row);
      const receivedAt = getSafeRequestDate(row);

      if (!receivedAt || latitude === null || longitude === null) {
        return null;
      }

      return {
        latitude,
        longitude,
        groupKey,
        name: setting.name || '',
        deviceId: normalizeDimension(row.deviceId, UNKNOWN_DIMENSION),
        package: normalizeDimension(row.package, UNKNOWN_DIMENSION),
        receivedAt,
        minuteOfDay: getMinuteOfDay(receivedAt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.receivedAt - right.receivedAt);
  const activeNameByGroupKey = buildNamedLocationNameLookup(namedSettings);
  const activeNames = new Set(points
    .map((point) => normalizeLocationGroupName(point.name) || activeNameByGroupKey.get(point.groupKey))
    .filter(Boolean));
  const activeRealLabels = (Array.isArray(realNamedLocationLabels) ? realNamedLocationLabels : [])
    .filter((label) => activeNames.has(normalizeLocationGroupName(label.name)));
  const labelsByName = new Map(activeRealLabels.map((label) => [normalizeLocationGroupName(label.name), label]));

  buildNamedLocationLabels(namedSettings, null, points).forEach((label) => {
    const name = normalizeLocationGroupName(label.name);
    if (activeNames.has(name) && !labelsByName.has(name)) {
      labelsByName.set(name, label);
    }
  });

  const labels = Array.from(labelsByName.values());
  const bounds = buildLocationBounds([...points, ...labels]);

  return {
    bounds,
    labels: labels.filter((label) => !bounds || isPointWithinBounds(label, bounds)),
    points,
    defaultMinute: points.length ? points[points.length - 1].minuteOfDay : 720,
  };
}

async function getMinuteLoggerDailyAnalytics(dateKey, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const endpointPath = options.endpointPath || ensureMinuteLoggerPath();
  const range = buildDayRangeFromDateKey(dateKey);
  const now = new Date(options.now || Date.now());
  const rawWindowStart = new Date(now.getTime() - (MINUTE_LOGGER_RAW_RETENTION_DAYS * DAY_MS));

  if (!range) {
    return null;
  }

  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: range.start,
      $lt: range.end,
    },
  })
    .sort({ receivedAt: 1 })
    .select({
      deviceId: 1,
      package: 1,
      active: 1,
      location: 1,
      battery: 1,
      batteryTempC: 1,
      receivedAt: 1,
      ip: 1,
      requestPath: 1,
      userAgent: 1,
      body: 1,
    }));
  const requests = Array.isArray(rows) ? rows : [];
  const activeRequests = requests.filter(isActiveUsageRequest);
  const inactiveRequests = requests.filter((row) => !isActiveUsageRequest(row));
  const locatedRequests = requests.filter(hasValidRequestLocation);
  const activeLocatedRequests = activeRequests.filter(hasValidRequestLocation);
  const locationGroupKeys = Array.from(new Set(locatedRequests
    .map(getRequestLocationGroupKey)
    .filter(Boolean)));
  const [
    settingsByKey,
    namedSettings,
  ] = await Promise.all([
    getMinuteLoggerLocationGroupSettings(endpointPath, locationGroupKeys, {
      settingsModel: options.locationGroupSettingsModel,
    }),
    fetchNamedLocationGroupSettings(endpointPath, {
      settingsModel: options.locationGroupSettingsModel,
    }),
  ]);
  const realNamedLocationLabels = await fetchNamedLocationCenterLabels(endpointPath, namedSettings, {
    requestModel,
    since: rawWindowStart,
  });
  const hourlySpread = buildHourlyCounts(activeRequests);
  const timeBucketSummary = summarizeTimeBuckets(hourlySpread, 1);
  const firstRequest = activeRequests[0] || null;
  const lastRequest = activeRequests[activeRequests.length - 1] || null;
  const namedLocationMinutes = locatedRequests.reduce((sum, row) => {
    const groupKey = getRequestLocationGroupKey(row);
    const setting = settingsByKey.get(groupKey);
    return sum + (setting?.name ? 1 : 0);
  }, 0);

  return {
    endpointPath,
    generatedAt: now,
    dateKey: range.dateKey,
    dayStart: range.start,
    dayEnd: range.end,
    totalMinutes: activeRequests.length,
    totalRawRequests: requests.length,
    inactiveRequests: inactiveRequests.length,
    locatedMinutes: locatedRequests.length,
    activeLocatedMinutes: activeLocatedRequests.length,
    unlocatedMinutes: requests.length - locatedRequests.length,
    namedLocationMinutes,
    deviceCount: new Set(activeRequests.map((row) => normalizeDimension(row.deviceId, UNKNOWN_DIMENSION))).size,
    packageCount: new Set(activeRequests.map((row) => normalizeDimension(row.package, UNKNOWN_DIMENSION))).size,
    firstSeen: firstRequest?.receivedAt || null,
    lastSeen: lastRequest?.receivedAt || null,
    quietGap: buildQuietGapSummary(activeRequests),
    packageStats: buildRequestBreakdown(activeRequests, (row) => row.package),
    deviceStats: buildRequestBreakdown(activeRequests, (row) => row.deviceId),
    devicePackageMatrix: buildDevicePackageMatrix(activeRequests),
    batteryStats: summarizeBatteryReadings(requests),
    locationGroups: buildLocationGroupSummaries(locatedRequests, settingsByKey, {
      pointSampleLimit: options.pointSampleLimit,
    }),
    hourlySpread,
    timeBucketStats: timeBucketSummary.buckets,
    busiestTimeBucket: timeBucketSummary.busiest,
    packageTransitions: buildTransitionRows(activeRequests, (row) => row.package),
    namedLocationTransitions: buildTransitionRows(locatedRequests, (row) => {
      const groupKey = getRequestLocationGroupKey(row);
      const setting = settingsByKey.get(groupKey);
      return setting?.name || groupKey || UNKNOWN_DIMENSION;
    }),
    locationTimeline: buildLocationTimeline(locatedRequests, settingsByKey, namedSettings, realNamedLocationLabels),
    recentRequests: requests.slice(-25).reverse(),
  };
}

function getNamedLocationNameMap(namedSettings = []) {
  const map = new Map();

  (Array.isArray(namedSettings) ? namedSettings : []).forEach((setting) => {
    const name = normalizeLocationGroupName(setting.name);

    if (!name) {
      return;
    }

    if (!map.has(name)) {
      map.set(name, {
        name,
        settings: [],
        groupKeys: [],
      });
    }

    const group = map.get(name);
    group.settings.push(setting);
    group.groupKeys.push(setting.groupKey);
  });

  return map;
}

function buildNamedLocationGroups(namedSettings = [], requests = [], options = {}) {
  const namedByName = getNamedLocationNameMap(namedSettings);
  const nameByGroupKey = new Map();

  namedByName.forEach((group) => {
    group.groupKeys.forEach((groupKey) => {
      nameByGroupKey.set(groupKey, group.name);
    });
  });

  const rowsByName = new Map(Array.from(namedByName.keys()).map((name) => [name, []]));
  (Array.isArray(requests) ? requests : []).forEach((row) => {
    const groupKey = getRequestLocationGroupKey(row);
    const name = nameByGroupKey.get(groupKey);

    if (name) {
      rowsByName.get(name).push(row);
    }
  });

  const dayRanges = buildCompleteDayRanges(options.now || new Date(), 14);

  return Array.from(namedByName.values())
    .map((group) => {
      const rows = rowsByName.get(group.name) || [];
      const locatedRows = rows.filter(hasValidRequestLocation);
      const settingsByKey = new Map(group.settings.map((setting) => [setting.groupKey, setting]));
      const locationPoints = locatedRows
        .map((row) => {
          const latitude = getRequestLatitude(row);
          const longitude = getRequestLongitude(row);
          const receivedAt = getSafeRequestDate(row);

          if (latitude === null || longitude === null || !receivedAt) {
            return null;
          }

          return {
            latitude,
            longitude,
            receivedAt,
            groupKey: getRequestLocationGroupKey(row),
            deviceId: normalizeDimension(row.deviceId, UNKNOWN_DIMENSION),
            package: normalizeDimension(row.package, UNKNOWN_DIMENSION),
          };
        })
        .filter(Boolean);
      const points = sampleEvenly(locationPoints, options.pointSampleLimit || MINUTE_LOGGER_ANALYTICS_POINT_SAMPLE_LIMIT);
      const bounds = buildLocationBounds(locationPoints, group.settings);
      const locationGroups = buildLocationGroupSummaries(locatedRows, settingsByKey, {
        pointSampleLimit: options.pointSampleLimit,
      });
      const deviceSet = new Set(rows.map((row) => normalizeDimension(row.deviceId, UNKNOWN_DIMENSION)));
      const packageSet = new Set(rows.map((row) => normalizeDimension(row.package, UNKNOWN_DIMENSION)));
      const firstSeen = rows.reduce((first, row) => {
        const date = getSafeRequestDate(row);
        if (!date) return first;
        return !first || date < first ? date : first;
      }, null);
      const lastSeen = rows.reduce((last, row) => {
        const date = getSafeRequestDate(row);
        if (!date) return last;
        return !last || date > last ? date : last;
      }, null);
      const hourlySpread = buildHourlyCounts(rows);
      const timeBucketSummary = summarizeTimeBuckets(hourlySpread, MINUTE_LOGGER_RAW_RETENTION_DAYS);

      return {
        name: group.name,
        groupKeys: group.groupKeys,
        settings: group.settings,
        totalMinutes: rows.length,
        locatedMinutes: locatedRows.length,
        deviceCount: deviceSet.size,
        packageCount: packageSet.size,
        firstSeen,
        lastSeen,
        packageStats: buildRequestBreakdown(rows, (row) => row.package).slice(0, 8),
        deviceStats: buildRequestBreakdown(rows, (row) => row.deviceId).slice(0, 8),
        locationGroups,
        hourlySpread,
        timeBucketStats: timeBucketSummary.buckets,
        busiestTimeBucket: timeBucketSummary.busiest,
        dailyTrend: buildDailyCounts(rows, dayRanges),
        pointCloud: {
          bounds,
          points,
          labels: buildNamedLocationLabels(group.settings, bounds, locationPoints),
        },
      };
    })
    .sort((left, right) => right.totalMinutes - left.totalMinutes || left.name.localeCompare(right.name));
}

async function getMinuteLoggerNamedLocationAnalytics(options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const endpointPath = options.endpointPath || ensureMinuteLoggerPath();
  const now = new Date(options.now || Date.now());
  const since = new Date(now.getTime() - (MINUTE_LOGGER_RAW_RETENTION_DAYS * DAY_MS));
  const namedSettings = await fetchNamedLocationGroupSettings(endpointPath, {
    settingsModel: options.locationGroupSettingsModel,
  });
  const groupKeys = Array.from(new Set(namedSettings.map((setting) => setting.groupKey).filter(Boolean)));
  const requests = groupKeys.length
    ? await leanExec(requestModel.find({
      endpointPath,
      receivedAt: { $gte: since },
      'location.groupKey': { $in: groupKeys },
    })
      .sort({ receivedAt: 1 })
      .select({
        deviceId: 1,
        package: 1,
        location: 1,
        receivedAt: 1,
      }))
    : [];
  const rows = Array.isArray(requests) ? requests : [];
  const groups = buildNamedLocationGroups(namedSettings, rows, {
    now,
    pointSampleLimit: options.pointSampleLimit,
  });
  const locatedMinutes = rows.filter(hasValidRequestLocation).length;
  const totalMinutes = groups.reduce((sum, group) => sum + group.totalMinutes, 0);
  const activeGroups = groups.filter((group) => group.totalMinutes > 0);

  return {
    endpointPath,
    generatedAt: now,
    since,
    rawRetentionDays: MINUTE_LOGGER_RAW_RETENTION_DAYS,
    namedLocationCount: groups.length,
    namedLocationGroupCount: groupKeys.length,
    activeNamedLocationCount: activeGroups.length,
    totalMinutes,
    locatedMinutes,
    deviceCount: new Set(rows.map((row) => normalizeDimension(row.deviceId, UNKNOWN_DIMENSION))).size,
    packageCount: new Set(rows.map((row) => normalizeDimension(row.package, UNKNOWN_DIMENSION))).size,
    busiestLocation: groups[0] || null,
    groups,
  };
}

async function getMinuteLoggerBatteryDashboard(options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const endpointPath = options.endpointPath || ensureMinuteLoggerPath();
  const now = new Date(options.now || Date.now());
  const rawRetentionDays = Number.isInteger(options.rawRetentionDays) && options.rawRetentionDays > 0
    ? options.rawRetentionDays
    : MINUTE_LOGGER_RAW_RETENTION_DAYS;
  const windowHours = Number.isInteger(options.windowHours) && options.windowHours > 0
    ? options.windowHours
    : MINUTE_LOGGER_BATTERY_WINDOW_HOURS;
  const retentionStart = new Date(now.getTime() - (rawRetentionDays * DAY_MS));
  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: retentionStart,
      $lte: now,
    },
  })
    .sort({ receivedAt: 1 })
    .select({
      deviceId: 1,
      package: 1,
      active: 1,
      battery: 1,
      batteryTempC: 1,
      body: 1,
      receivedAt: 1,
    }));
  const requests = Array.isArray(rows) ? rows : [];
  const packages = buildBatteryDashboardPackageRows(requests);
  const points = buildBatteryDashboardPoints(requests, packages);
  const noActivePointCount = requests.reduce((count, row) => {
    return count + (isActiveUsageRequest(row) ? 0 : 1);
  }, 0);

  return {
    endpointPath,
    generatedAt: now,
    rawRetentionDays,
    retentionStart,
    retentionEnd: now,
    windowHours,
    pointCount: points.length,
    noActivePointCount,
    packages,
    points,
    batteryStats: summarizeBatteryReadings(requests),
  };
}

async function fetchHourlySpread(endpointPath, options = {}) {
  const requestModel = options.requestModel || MinuteLoggerRequest;
  const since = options.since;
  const timezone = options.timezone || getDashboardTimeZone();
  const match = buildActiveUsageMatch({ endpointPath });

  if (since) {
    match.receivedAt = { $gte: since };
  }

  const rows = await requestModel.aggregate([
    {
      $match: match,
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
  const active24hMatch = buildActiveUsageMatch({
    endpointPath,
    receivedAt: { $gte: since24h },
  });
  const activeRawWindowMatch = buildActiveUsageMatch(rawWindowMatch);

  const [
    totalRawRequests,
    requestsLast24h,
    activeDevicesLast24h,
    packageCountLast60d,
    recentRequests,
    packageStats,
    deviceStats,
    batteryStats,
    locationStats,
    hourlySpread,
    dailyMinuteStats,
    monthlyMinuteStats,
  ] = await Promise.all([
    requestModel.countDocuments(rawMatch),
    requestModel.countDocuments(active24hMatch),
    getDistinctCount(requestModel, 'deviceId', active24hMatch),
    getDistinctCount(requestModel, 'package', activeRawWindowMatch),
    leanExec(requestModel.find(rawMatch)
      .sort({ receivedAt: -1 })
      .limit(recentLimit)),
    fetchPackageStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchDeviceStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchBatteryStats(endpointPath, { requestModel, since: rawWindowStart }),
    fetchLocationStats(endpointPath, {
      requestModel,
      since: rawWindowStart,
      locationGroupSettingsModel: options.locationGroupSettingsModel,
    }),
    fetchHourlySpread(endpointPath, { requestModel, since: rawWindowStart }),
    fetchDailyMinuteStats(endpointPath, { statModel, now }),
    fetchMonthlyMinuteStats(endpointPath, { statModel, now }),
  ]);
  const timeBucketSummary = summarizeTimeBuckets(hourlySpread, MINUTE_LOGGER_RAW_RETENTION_DAYS);
  const lastKnownLocation = await fetchLastKnownNamedLocation(endpointPath, recentRequests, {
    settingsModel: options.locationGroupSettingsModel,
  });

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
    batteryStats,
    locationStats,
    lastKnownLocation,
    hourlySpread,
    timeBucketStats: timeBucketSummary.buckets,
    busiestTimeBucket: timeBucketSummary.busiest,
    dailyMinuteStats,
    monthlyMinuteStats,
  };
}

module.exports = {
  MinuteLoggerLocationGroupSettingsError,
  MINUTE_LOGGER_ANALYTICS_POINT_SAMPLE_LIMIT,
  MINUTE_LOGGER_RAW_RETENTION_DAYS,
  MINUTE_LOGGER_LOCATION_GROUP_LIMIT,
  MINUTE_LOGGER_LOCATION_GROUP_NAME_MAX_LENGTH,
  MINUTE_LOGGER_LOCATION_GROUP_PRECISION,
  MINUTE_LOGGER_LOCATION_NOISE_MINUTES,
  MINUTE_LOGGER_LOCATION_POINT_SAMPLE_LIMIT,
  MINUTE_LOGGER_BATTERY_WINDOW_HOURS,
  MINUTE_LOGGER_RECENT_LIMIT,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME: MinuteLoggerRequest.collection.collectionName,
  MINUTE_LOGGER_RESPONSE_BODY,
  MINUTE_LOGGER_STAT_COLLECTION_NAME: MinuteLoggerStat.collection.collectionName,
  MINUTE_LOGGER_STATS_RETENTION_YEARS,
  MINUTE_LOGGER_UNUSED_PACKAGE,
  TIME_BUCKETS,
  UNKNOWN_DIMENSION,
  buildActiveUsageMatch,
  buildCompleteDayRanges,
  buildDayRangeFromDateKey,
  buildLocationGroupKey,
  buildMonthRanges,
  buildPeriodInfo,
  buildRequestRecord,
  fetchBatteryStats,
  fetchDailyMinuteStats,
  fetchDeviceStats,
  fetchHourlySpread,
  fetchLastKnownNamedLocation,
  fetchLocationStats,
  fetchMonthlyMinuteStats,
  fetchNamedLocationGroupSettings,
  fetchPackageStats,
  getMinuteLoggerLocationGroupSettings,
  getDeviceId,
  getLocation,
  getMinuteLoggerBatteryDashboard,
  getMinuteLoggerDailyAnalytics,
  getMinuteLoggerDashboard,
  getMinuteLoggerNamedLocationAnalytics,
  getPackageName,
  getRequestActive,
  getBatteryPercent,
  getBatteryTempC,
  incrementMinuteLoggerStats,
  isActiveUsageRequest,
  normalizeDimension,
  parseActiveInput,
  parseBatteryPercent,
  parseBatteryTempC,
  parseLocationValue,
  recordMinuteLoggerRequest,
  serializeValue,
  summarizeBatteryReadings,
  summarizeLocationGroups,
  summarizeTimeBuckets,
  updateMinuteLoggerLocationGroupSettings,
};
