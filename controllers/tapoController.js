const logger = require('../utils/logger');
const {
  TapoReading,
  TapoDailyConsumptionSnapshot,
  TapoMonthlyConsumptionSnapshot,
} = require('../database');
const {
  TapoReadingService,
  TapoValidationError,
  buildTapoDashboardData,
  buildTapoBatchResponse,
  dateKeyFromDate,
} = require('../services/tapoReadingService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RAW_DAYS = 7;
const DEFAULT_DAILY_DAYS = 90;
const DEFAULT_MONTHS = 36;
const MAX_RAW_DAYS = 31;
const MAX_DAILY_DAYS = 1095;
const MAX_MONTHS = 120;
const DEFAULT_TIME_ZONE = process.env.TAPO_TIME_ZONE || process.env.TZ || 'Asia/Tokyo';

const tapoReadingService = new TapoReadingService({
  TapoReading,
  TapoDailyConsumptionSnapshot,
  TapoMonthlyConsumptionSnapshot,
});

function parseRange(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function shiftMonthKey(monthKey, deltaMonths) {
  const [year, month] = String(monthKey).split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthKey;
  }
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return shifted.toISOString().slice(0, 7);
}

exports.saveBatch = async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await tapoReadingService.saveBatch(payload);

    res.set({
      'X-Tapo-Ingestion-Status': result.status,
      'X-Tapo-Readings-Inserted': String(result.summary.inserted),
      'X-Tapo-Readings-Duplicates': String(result.summary.duplicates),
      'X-Tapo-Readings-Failed': String(result.summary.failed),
    });

    const responseBody = buildTapoBatchResponse(result);
    if (req.query.summary === 'true' || req.query.ingestion === 'true') {
      responseBody.ingestion = {
        status: result.status,
        summary: result.summary,
        results: result.results,
      };
    }

    return res.json(responseBody);
  } catch (error) {
    if (error instanceof TapoValidationError || error.statusCode === 400) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    logger.error('Failed to save Tapo reading batch', {
      category: 'tapo',
      metadata: { error: error.message },
    });
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

exports.dashboard = async (req, res) => {
  const rawDays = parseRange(req.query.rawDays, DEFAULT_RAW_DAYS, MAX_RAW_DAYS);
  const dailyDays = parseRange(req.query.dailyDays, DEFAULT_DAILY_DAYS, MAX_DAILY_DAYS);
  const monthlyMonths = parseRange(req.query.months, DEFAULT_MONTHS, MAX_MONTHS);
  const now = new Date();
  const rawSince = new Date(now.getTime() - rawDays * MS_PER_DAY);
  const dailyStartKey = dateKeyFromDate(
    new Date(now.getTime() - (dailyDays - 1) * MS_PER_DAY),
    DEFAULT_TIME_ZONE
  );
  const currentMonthKey = dateKeyFromDate(now, DEFAULT_TIME_ZONE).slice(0, 7);
  const monthStartKey = shiftMonthKey(currentMonthKey, -monthlyMonths + 1);

  try {
    const [readings, dailySnapshots, monthlySnapshots, totalRawCount] = await Promise.all([
      TapoReading.find({ timestampUtc: { $gte: rawSince } })
        .sort({ timestampUtc: 1 })
        .select({
          deviceName: 1,
          deviceIp: 1,
          model: 1,
          timestampUtc: 1,
          metrics: 1,
        })
        .lean(),
      TapoDailyConsumptionSnapshot.find({ dateKey: { $gte: dailyStartKey } })
        .sort({ dateKey: 1, deviceName: 1 })
        .select({
          deviceName: 1,
          deviceIp: 1,
          model: 1,
          dateKey: 1,
          consumptionKwh: 1,
          lastReadingAt: 1,
        })
        .lean(),
      TapoMonthlyConsumptionSnapshot.find({ monthKey: { $gte: monthStartKey } })
        .sort({ monthKey: 1, deviceName: 1 })
        .select({
          deviceName: 1,
          deviceIp: 1,
          model: 1,
          monthKey: 1,
          consumptionKwh: 1,
          lastReadingAt: 1,
        })
        .lean(),
      TapoReading.countDocuments(),
    ]);

    const tapoDashboard = buildTapoDashboardData({
      readings,
      dailySnapshots,
      monthlySnapshots,
      totalRawCount,
    });

    return res.render('admin_tapo_dashboard', {
      tapoDashboard,
      rawDays,
      dailyDays,
      monthlyMonths,
      timeZone: DEFAULT_TIME_ZONE,
      loadError: null,
    });
  } catch (error) {
    logger.error('Failed to load Tapo dashboard', {
      category: 'tapo',
      metadata: { error: error.message },
    });
    return res.render('admin_tapo_dashboard', {
      tapoDashboard: buildTapoDashboardData(),
      rawDays,
      dailyDays,
      monthlyMonths,
      timeZone: DEFAULT_TIME_ZONE,
      loadError: 'Unable to load Tapo dashboard right now.',
    });
  }
};
