const logger = require('../utils/logger');
const {
  MINUTE_LOGGER_RAW_RETENTION_DAYS,
  MINUTE_LOGGER_RECENT_LIMIT,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME,
  MINUTE_LOGGER_STAT_COLLECTION_NAME,
  MINUTE_LOGGER_STATS_RETENTION_YEARS,
  getMinuteLoggerDashboard,
} = require('../services/minuteLoggerService');
const {
  formatDateTime,
  formatMinuteDuration,
  formatNumber,
  mapDailyMinuteStats,
} = require('../utils/requestCounterDashboardView');

function formatDecimal(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '0.0';
}

function formatPayload(payload) {
  if (payload === null || payload === undefined) {
    return 'null';
  }

  try {
    const text = JSON.stringify(payload, null, 2);
    return text.length > 2400 ? `${text.slice(0, 2400)}\n...` : text;
  } catch (error) {
    return `Unable to serialize body: ${error.message}`;
  }
}

function buildOverviewCards(dashboard) {
  const busiest = dashboard.busiestTimeBucket || {};

  return [
    {
      label: 'Last 24 Hours',
      value: `${formatNumber(dashboard.requestsLast24h)} min`,
      helper: `${formatNumber(dashboard.activeDevicesLast24h)} active devices`,
      tone: dashboard.requestsLast24h > 0 ? 'ok' : '',
    },
    {
      label: 'Raw Retained Minutes',
      value: formatNumber(dashboard.totalRawRequests),
      helper: `${dashboard.rawRetentionDays}-day raw retention`,
    },
    {
      label: 'Packages',
      value: formatNumber(dashboard.packageCountLast60d),
      helper: `Seen in the last ${dashboard.rawRetentionDays} days`,
    },
    {
      label: 'Busiest Time',
      value: busiest.label || 'N/A',
      helper: `${formatDecimal(busiest.averagePerDay || 0)} min/day average`,
    },
    {
      label: 'Rollup Retention',
      value: `${dashboard.statsRetentionYears} years`,
      helper: 'Daily and monthly usage stats',
    },
  ];
}

function mapPackageStat(row) {
  return {
    packageName: row.package || 'unknown',
    minutes: Number(row.minutes) || 0,
    minutesDisplay: `${formatNumber(row.minutes)} min`,
    deviceCountDisplay: formatNumber(row.deviceCount),
    lastSeenDisplay: formatDateTime(row.lastSeen),
  };
}

function mapDeviceStat(row) {
  return {
    deviceId: row.deviceId || 'unknown',
    minutes: Number(row.minutes) || 0,
    minutesDisplay: `${formatNumber(row.minutes)} min`,
    packageCountDisplay: formatNumber(row.packageCount),
    lastSeenDisplay: formatDateTime(row.lastSeen),
  };
}

function mapHourlySpread(rows = []) {
  const maxMinutes = Math.max(1, ...rows.map((row) => Number(row.minutes) || 0));

  return rows.map((row) => {
    const hour = Number(row.hour) || 0;
    const minutes = Number(row.minutes) || 0;

    return {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      minutes,
      minutesDisplay: formatNumber(minutes),
      percent: Math.round((minutes / maxMinutes) * 100),
    };
  });
}

function mapTimeBucket(row) {
  return {
    key: row.key,
    label: row.label,
    minutesDisplay: `${formatNumber(row.minutes)} min`,
    averageDisplay: `${formatDecimal(row.averagePerDay)} min/day`,
  };
}

function mapMonthlyStat(row) {
  return {
    monthKey: row.monthKey,
    totalMinutes: Number(row.totalMinutes) || 0,
    totalDurationDisplay: formatMinuteDuration(row.totalMinutes),
    totalMinutesDisplay: formatNumber(row.totalMinutes),
    deviceCountDisplay: formatNumber(row.deviceCount),
    packageCountDisplay: formatNumber(row.packageCount),
  };
}

function mapRecentRequest(row) {
  return {
    id: row._id ? String(row._id) : '',
    receivedAtDisplay: formatDateTime(row.receivedAt),
    method: row.method || 'POST',
    deviceId: row.deviceId || 'unknown',
    packageName: row.package || 'unknown',
    ip: row.ip || 'N/A',
    requestPath: row.requestPath || 'N/A',
    userAgent: row.userAgent || 'N/A',
    bodyJson: formatPayload(row.body || {}),
  };
}

exports.dashboard = async (req, res) => {
  try {
    const dashboard = await getMinuteLoggerDashboard();

    return res.render('admin_minute_logger', {
      loadError: null,
      generatedAtDisplay: formatDateTime(dashboard.generatedAt),
      endpointPath: dashboard.endpointPath,
      rawCollectionName: MINUTE_LOGGER_REQUEST_COLLECTION_NAME,
      statCollectionName: MINUTE_LOGGER_STAT_COLLECTION_NAME,
      rawRetentionDays: MINUTE_LOGGER_RAW_RETENTION_DAYS,
      statsRetentionYears: MINUTE_LOGGER_STATS_RETENTION_YEARS,
      recentLimit: MINUTE_LOGGER_RECENT_LIMIT,
      overviewCards: buildOverviewCards(dashboard),
      dailyMinuteStats: mapDailyMinuteStats(dashboard.dailyMinuteStats),
      monthlyMinuteStats: dashboard.monthlyMinuteStats.map(mapMonthlyStat),
      packageStats: dashboard.packageStats.slice(0, 12).map(mapPackageStat),
      deviceStats: dashboard.deviceStats.slice(0, 12).map(mapDeviceStat),
      hourlySpread: mapHourlySpread(dashboard.hourlySpread),
      timeBucketStats: dashboard.timeBucketStats.map(mapTimeBucket),
      recentRequests: dashboard.recentRequests.map(mapRecentRequest),
    });
  } catch (error) {
    logger.error('Failed to load minute logger admin dashboard', {
      category: 'minute-logger',
      metadata: { error: error.message },
    });

    return res.status(500).render('admin_minute_logger', {
      loadError: 'Unable to load minute logger data right now.',
      generatedAtDisplay: formatDateTime(new Date()),
      endpointPath: 'N/A',
      rawCollectionName: MINUTE_LOGGER_REQUEST_COLLECTION_NAME,
      statCollectionName: MINUTE_LOGGER_STAT_COLLECTION_NAME,
      rawRetentionDays: MINUTE_LOGGER_RAW_RETENTION_DAYS,
      statsRetentionYears: MINUTE_LOGGER_STATS_RETENTION_YEARS,
      recentLimit: MINUTE_LOGGER_RECENT_LIMIT,
      overviewCards: [],
      dailyMinuteStats: [],
      monthlyMinuteStats: [],
      packageStats: [],
      deviceStats: [],
      hourlySpread: [],
      timeBucketStats: [],
      recentRequests: [],
    });
  }
};
