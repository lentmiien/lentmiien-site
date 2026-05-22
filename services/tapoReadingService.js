const DEFAULT_TIME_ZONE = process.env.TAPO_TIME_ZONE || process.env.TZ || 'Asia/Tokyo';
const DEFAULT_RAW_RETENTION_DAYS = 7;
const DEFAULT_DAILY_RETENTION_DAYS = 365 * 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class TapoValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TapoValidationError';
    this.statusCode = 400;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRawRetentionDays() {
  return parsePositiveInteger(process.env.TAPO_READING_RETENTION_DAYS, DEFAULT_RAW_RETENTION_DAYS);
}

function getDailyRetentionDays() {
  return parsePositiveInteger(process.env.TAPO_DAILY_SNAPSHOT_RETENTION_DAYS, DEFAULT_DAILY_RETENTION_DAYS);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeviceName(value) {
  const deviceName = normalizeString(value);
  if (!deviceName) {
    throw new TapoValidationError('Missing device_name.');
  }
  return deviceName;
}

function normalizeDeviceNameKey(deviceName) {
  return deviceName.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = normalizeNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    const parsed = normalizeBoolean(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizeDateInput(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalizedText = text.replace(/(\.\d{3})\d+((?:Z)|(?:[+-]\d{2}:?\d{2}))$/i, '$1$2');
  const date = new Date(normalizedText);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function dateKeyFromDate(date, timeZone = DEFAULT_TIME_ZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (lookup.year && lookup.month && lookup.day) {
      return `${lookup.year}-${lookup.month}-${lookup.day}`;
    }
  } catch (error) {
    // Fall back to UTC when the configured time zone is invalid.
  }
  return date.toISOString().slice(0, 10);
}

function deriveLocalKeys(record, timestampUtc, timeZone = DEFAULT_TIME_ZONE) {
  const features = isPlainObject(record.features) ? record.features : {};
  const deviceTime = normalizeString(features.device_time);
  const deviceDateMatch = deviceTime.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateKey = deviceDateMatch ? deviceDateMatch[1] : dateKeyFromDate(timestampUtc, timeZone);
  return {
    dateKey,
    monthKey: dateKey.slice(0, 7),
  };
}

function datePartsFromDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  return { year, month, day };
}

function monthPartsFromMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map((part) => Number.parseInt(part, 10));
  return { year, month };
}

function normalizeMetrics(record) {
  const metrics = isPlainObject(record.metrics) ? record.metrics : {};
  const features = isPlainObject(record.features) ? record.features : {};

  return {
    current_power: firstNumber(metrics.current_power, features.current_consumption),
    today_energy: firstNumber(metrics.today_energy, features.consumption_today),
    this_month_energy: firstNumber(metrics.this_month_energy, features.consumption_this_month),
    total_energy: firstNumber(metrics.total_energy, features.total_energy),
    voltage: firstNumber(metrics.voltage, features.voltage),
    current: firstNumber(metrics.current, features.current),
    state: firstBoolean(metrics.state, features.state),
    rssi: firstNumber(metrics.rssi, features.rssi),
    signal_level: firstNumber(metrics.signal_level, features.signal_level),
    overheated: firstBoolean(metrics.overheated, features.overheated),
    overloaded: firstBoolean(metrics.overloaded, features.overloaded),
  };
}

function buildSnapshotBase(normalized, consumptionKwh, expiresAt = null) {
  return {
    deviceName: normalized.deviceName,
    deviceNameKey: normalized.deviceNameKey,
    consumptionKwh,
    source: normalized.source,
    readingId: normalized.readingId,
    readingKind: normalized.kind,
    deviceIp: normalized.deviceIp,
    model: normalized.model,
    currentPowerW: normalized.metrics.current_power,
    lastReadingAt: normalized.timestampUtc,
    bucketStartUtc: normalized.bucketStartUtc,
    metrics: normalized.metrics,
    features: normalized.features,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function normalizeTapoRecord(record, payload = {}, options = {}) {
  if (!isPlainObject(record)) {
    throw new TapoValidationError('Each Tapo record must be an object.');
  }

  const deviceName = normalizeDeviceName(record.device_name);
  const deviceNameKey = normalizeDeviceNameKey(deviceName);
  const timestampUtc = normalizeDateInput(record.timestamp_utc);
  if (!timestampUtc) {
    throw new TapoValidationError(`Invalid timestamp_utc for ${deviceName}.`);
  }
  const bucketStartUtc = normalizeDateInput(record.bucket_start_utc) || timestampUtc;
  const source = normalizeString(payload.source || record.source) || null;
  const kind = normalizeString(record.kind) || 'sample';
  const metrics = normalizeMetrics(record);
  const features = isPlainObject(record.features) ? record.features : {};
  const localKeys = deriveLocalKeys(record, timestampUtc, options.timeZone || DEFAULT_TIME_ZONE);
  const rawRetentionDays = parsePositiveInteger(options.rawRetentionDays, getRawRetentionDays());
  const dailyRetentionDays = parsePositiveInteger(options.dailyRetentionDays, getDailyRetentionDays());
  const dedupeKey = `${deviceNameKey}|${kind}|${bucketStartUtc.toISOString()}`;

  const normalized = {
    source,
    readingId: normalizeString(record.reading_id) || null,
    dedupeKey,
    kind,
    deviceName,
    deviceNameKey,
    deviceIp: normalizeString(record.device_ip) || null,
    model: normalizeString(record.model) || null,
    timestampUtc,
    bucketStartUtc,
    localDateKey: localKeys.dateKey,
    localMonthKey: localKeys.monthKey,
    metrics,
    features,
    featureErrors: Array.isArray(record.feature_errors) ? record.feature_errors : [],
    collector: isPlainObject(record.collector) ? record.collector : {},
    rawRecord: record,
    receivedAt: options.now instanceof Date ? options.now : new Date(),
    expiresAt: addDays(timestampUtc, rawRetentionDays),
  };

  const dailyParts = datePartsFromDateKey(localKeys.dateKey);
  const monthParts = monthPartsFromMonthKey(localKeys.monthKey);
  const todayEnergy = metrics.today_energy;
  const monthEnergy = metrics.this_month_energy;

  return {
    rawReading: normalized,
    dailySnapshot: todayEnergy === null ? null : {
      ...buildSnapshotBase(normalized, todayEnergy, addDays(timestampUtc, dailyRetentionDays)),
      dateKey: localKeys.dateKey,
      year: dailyParts.year,
      month: dailyParts.month,
      day: dailyParts.day,
    },
    monthlySnapshot: monthEnergy === null ? null : {
      ...buildSnapshotBase(normalized, monthEnergy),
      monthKey: localKeys.monthKey,
      year: monthParts.year,
      month: monthParts.month,
    },
  };
}

function isDuplicateKeyError(error) {
  if (!error) {
    return false;
  }
  if (error.code === 11000) {
    return true;
  }
  return Array.isArray(error.writeErrors) && error.writeErrors.some((item) => item && item.code === 11000);
}

function getResultCount(result, key) {
  if (!result) {
    return 0;
  }
  if (Number.isFinite(result[key])) {
    return result[key];
  }
  if (key === 'upsertedCount' && result.upserted) {
    return Array.isArray(result.upserted) ? result.upserted.length : 1;
  }
  return 0;
}

async function upsertFreshSnapshot(Model, identity, snapshot) {
  try {
    const insertResult = await Model.updateOne(
      identity,
      { $setOnInsert: snapshot },
      { upsert: true, setDefaultsOnInsert: true }
    );
    if (getResultCount(insertResult, 'upsertedCount') > 0) {
      return 'created';
    }
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
  }

  const updateResult = await Model.updateOne(
    {
      ...identity,
      $or: [
        { lastReadingAt: { $lt: snapshot.lastReadingAt } },
        { lastReadingAt: { $exists: false } },
      ],
    },
    { $set: snapshot }
  );

  if (
    getResultCount(updateResult, 'matchedCount') > 0
    || getResultCount(updateResult, 'modifiedCount') > 0
  ) {
    return 'updated';
  }
  return 'unchanged';
}

function incrementSnapshotSummary(summary, key, status) {
  if (!summary[key][status]) {
    summary[key][status] = 0;
  }
  summary[key][status] += 1;
}

class TapoReadingService {
  constructor(models, options = {}) {
    this.TapoReading = models.TapoReading;
    this.TapoDailyConsumptionSnapshot = models.TapoDailyConsumptionSnapshot;
    this.TapoMonthlyConsumptionSnapshot = models.TapoMonthlyConsumptionSnapshot;
    this.options = options;
  }

  async saveBatch(payload, options = {}) {
    if (!isPlainObject(payload)) {
      throw new TapoValidationError('Expected a JSON object payload.');
    }
    if (!Array.isArray(payload.records)) {
      throw new TapoValidationError('Expected payload.records to be an array.');
    }

    const mergedOptions = {
      ...this.options,
      ...options,
    };
    const summary = {
      received: payload.records.length,
      valid: 0,
      inserted: 0,
      duplicates: 0,
      invalid: 0,
      failed: 0,
      dailySnapshots: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
      monthlySnapshots: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    };
    const results = [];

    for (const [index, record] of payload.records.entries()) {
      let normalized;
      try {
        normalized = normalizeTapoRecord(record, payload, mergedOptions);
        summary.valid += 1;
      } catch (error) {
        summary.invalid += 1;
        results.push({
          index,
          status: 'invalid',
          message: error.message,
        });
        continue;
      }

      const rawReading = normalized.rawReading;
      let rawStatus = 'inserted';
      let dailySnapshotStatus = 'skipped';
      let monthlySnapshotStatus = 'skipped';

      try {
        await this.TapoReading.create(rawReading);
        summary.inserted += 1;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          rawStatus = 'duplicate';
          summary.duplicates += 1;
        } else {
          summary.failed += 1;
          results.push({
            index,
            status: 'failed',
            readingId: rawReading.readingId,
            deviceName: rawReading.deviceName,
            message: error.message,
          });
          continue;
        }
      }

      try {
        if (normalized.dailySnapshot) {
          dailySnapshotStatus = await upsertFreshSnapshot(
            this.TapoDailyConsumptionSnapshot,
            {
              deviceNameKey: rawReading.deviceNameKey,
              dateKey: normalized.dailySnapshot.dateKey,
            },
            normalized.dailySnapshot
          );
        }
        incrementSnapshotSummary(summary, 'dailySnapshots', dailySnapshotStatus);

        if (normalized.monthlySnapshot) {
          monthlySnapshotStatus = await upsertFreshSnapshot(
            this.TapoMonthlyConsumptionSnapshot,
            {
              deviceNameKey: rawReading.deviceNameKey,
              monthKey: normalized.monthlySnapshot.monthKey,
            },
            normalized.monthlySnapshot
          );
        }
        incrementSnapshotSummary(summary, 'monthlySnapshots', monthlySnapshotStatus);
      } catch (error) {
        summary.failed += 1;
        results.push({
          index,
          status: 'failed',
          readingId: rawReading.readingId,
          deviceName: rawReading.deviceName,
          message: error.message,
        });
        continue;
      }

      results.push({
        index,
        status: rawStatus,
        readingId: rawReading.readingId,
        deviceName: rawReading.deviceName,
        bucketStartUtc: rawReading.bucketStartUtc.toISOString(),
        dailySnapshot: dailySnapshotStatus,
        monthlySnapshot: monthlySnapshotStatus,
      });
    }

    return {
      status: summary.failed || summary.invalid ? 'partial' : 'saved',
      source: normalizeString(payload.source) || null,
      summary,
      results,
    };
  }
}

function toIsoString(value) {
  const date = normalizeDateInput(value);
  return date ? date.toISOString() : null;
}

function getMetricValue(entry, key) {
  return normalizeNumber(entry && entry.metrics ? entry.metrics[key] : null);
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (normalizeNumber(value) || 0), 0);
}

function latestByKey(entries, keySelector, dateSelector) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = keySelector(entry);
    if (!key) return;
    const date = normalizeDateInput(dateSelector(entry));
    const current = map.get(key);
    const currentDate = current ? normalizeDateInput(dateSelector(current)) : null;
    if (!current || (date && (!currentDate || date > currentDate))) {
      map.set(key, entry);
    }
  });
  return map;
}

function buildTapoDashboardData({
  readings = [],
  dailySnapshots = [],
  monthlySnapshots = [],
  totalRawCount = 0,
} = {}) {
  const latestReadings = latestByKey(readings, (entry) => entry.deviceName, (entry) => entry.timestampUtc);
  const latestDailyKey = dailySnapshots.reduce((latest, entry) => (
    entry.dateKey && entry.dateKey > latest ? entry.dateKey : latest
  ), '');
  const latestMonthKey = monthlySnapshots.reduce((latest, entry) => (
    entry.monthKey && entry.monthKey > latest ? entry.monthKey : latest
  ), '');
  const currentDailySnapshots = dailySnapshots.filter((entry) => entry.dateKey === latestDailyKey);
  const currentMonthlySnapshots = monthlySnapshots.filter((entry) => entry.monthKey === latestMonthKey);
  const dailyByDevice = new Map(currentDailySnapshots.map((entry) => [entry.deviceName, entry]));
  const monthlyByDevice = new Map(currentMonthlySnapshots.map((entry) => [entry.deviceName, entry]));
  const deviceNames = new Set([
    ...Array.from(latestReadings.keys()),
    ...currentDailySnapshots.map((entry) => entry.deviceName),
    ...currentMonthlySnapshots.map((entry) => entry.deviceName),
  ]);
  const powerValues = readings
    .map((entry) => getMetricValue(entry, 'current_power'))
    .filter((value) => value !== null);
  const latestReadingAt = readings.reduce((latest, entry) => {
    const date = normalizeDateInput(entry.timestampUtc);
    return date && (!latest || date > latest) ? date : latest;
  }, null);

  const deviceStats = Array.from(deviceNames).map((deviceName) => {
    const latest = latestReadings.get(deviceName) || {};
    const daily = dailyByDevice.get(deviceName) || {};
    const monthly = monthlyByDevice.get(deviceName) || {};
    return {
      deviceName,
      deviceIp: latest.deviceIp || daily.deviceIp || monthly.deviceIp || null,
      model: latest.model || daily.model || monthly.model || null,
      currentPowerW: getMetricValue(latest, 'current_power'),
      todayKwh: normalizeNumber(daily.consumptionKwh),
      monthKwh: normalizeNumber(monthly.consumptionKwh),
      voltage: getMetricValue(latest, 'voltage'),
      current: getMetricValue(latest, 'current'),
      rssi: getMetricValue(latest, 'rssi'),
      signalLevel: getMetricValue(latest, 'signal_level'),
      state: latest.metrics ? normalizeBoolean(latest.metrics.state) : null,
      lastReadingAt: toIsoString(latest.timestampUtc || daily.lastReadingAt || monthly.lastReadingAt),
    };
  }).sort((a, b) => {
    const monthDiff = (b.monthKwh || 0) - (a.monthKwh || 0);
    if (monthDiff !== 0) return monthDiff;
    return a.deviceName.localeCompare(b.deviceName);
  });

  return {
    generatedAt: new Date().toISOString(),
    latestDailyKey: latestDailyKey || null,
    latestMonthKey: latestMonthKey || null,
    stats: {
      deviceCount: deviceNames.size,
      rawReadingsInWindow: readings.length,
      rawReadingsTotal: totalRawCount,
      totalCurrentPowerW: sumNumbers(Array.from(latestReadings.values()).map((entry) => getMetricValue(entry, 'current_power'))),
      totalTodayKwh: sumNumbers(currentDailySnapshots.map((entry) => entry.consumptionKwh)),
      totalMonthKwh: sumNumbers(currentMonthlySnapshots.map((entry) => entry.consumptionKwh)),
      peakPowerW: powerValues.length ? Math.max(...powerValues) : null,
      averagePowerW: powerValues.length ? sumNumbers(powerValues) / powerValues.length : null,
      latestReadingAt: latestReadingAt ? latestReadingAt.toISOString() : null,
    },
    deviceStats,
    powerSeries: readings.map((entry) => ({
      deviceName: entry.deviceName,
      timestamp: toIsoString(entry.timestampUtc),
      currentPowerW: getMetricValue(entry, 'current_power'),
    })).filter((entry) => entry.timestamp && entry.currentPowerW !== null),
    dailySeries: dailySnapshots.map((entry) => ({
      deviceName: entry.deviceName,
      dateKey: entry.dateKey,
      consumptionKwh: normalizeNumber(entry.consumptionKwh),
    })).filter((entry) => entry.dateKey && entry.consumptionKwh !== null),
    monthlySeries: monthlySnapshots.map((entry) => ({
      deviceName: entry.deviceName,
      monthKey: entry.monthKey,
      consumptionKwh: normalizeNumber(entry.consumptionKwh),
    })).filter((entry) => entry.monthKey && entry.consumptionKwh !== null),
  };
}

function batchResultIdentifier(result) {
  if (!result) {
    return null;
  }
  if (result.readingId) {
    return result.readingId;
  }
  return Number.isFinite(result.index) ? `index:${result.index}` : null;
}

function buildTapoBatchResponse(result) {
  const rows = Array.isArray(result && result.results) ? result.results : [];
  const accepted = rows
    .filter((row) => row.status === 'inserted')
    .map(batchResultIdentifier)
    .filter(Boolean);
  const duplicates = rows
    .filter((row) => row.status === 'duplicate')
    .map(batchResultIdentifier)
    .filter(Boolean);
  const failed = rows
    .filter((row) => row.status === 'failed' || row.status === 'invalid')
    .map((row) => ({
      reading_id: row.readingId || null,
      index: row.index,
      message: row.message || 'Unable to save reading.',
    }));

  return {
    ok: failed.length === 0,
    accepted,
    duplicates,
    failed,
  };
}

module.exports = {
  TapoReadingService,
  TapoValidationError,
  buildTapoDashboardData,
  buildTapoBatchResponse,
  dateKeyFromDate,
  isDuplicateKeyError,
  normalizeDateInput,
  normalizeTapoRecord,
  upsertFreshSnapshot,
};
