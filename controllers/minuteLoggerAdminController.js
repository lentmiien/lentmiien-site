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

function formatCoordinate(value, digits = 5) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : 'N/A';
}

function buildMapUrl(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
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
  const locationStats = dashboard.locationStats || {};
  const locationGroupCount = Number(locationStats.totalGroupCount)
    || (Array.isArray(locationStats.groups) ? locationStats.groups.length : 0);
  const locatedMinutes = Number(locationStats.totalLocationMinutes) || 0;

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
      label: 'Location Groups',
      value: formatNumber(locationGroupCount),
      helper: locatedMinutes > 0
        ? `${formatNumber(locationStats.groupedLocationMinutes)} grouped min, ${formatNumber(locationStats.noiseLocationMinutes)} noise min`
        : 'No location points yet',
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

function mapLocationStats(stats = {}) {
  const groups = Array.isArray(stats.groups) ? stats.groups : [];
  const maxMinutes = Math.max(1, ...groups.map((row) => Number(row.minutes) || 0));
  const totalLocationMinutes = Number(stats.totalLocationMinutes) || 0;
  const groupedLocationMinutes = Number(stats.groupedLocationMinutes) || 0;
  const noiseLocationMinutes = Number(stats.noiseLocationMinutes) || 0;
  const noiseThresholdMinutes = Number(stats.noiseThresholdMinutes) || 0;

  return {
    totalLocationMinutes,
    totalLocationMinutesDisplay: `${formatNumber(totalLocationMinutes)} min`,
    groupedLocationMinutes,
    groupedLocationMinutesDisplay: `${formatNumber(groupedLocationMinutes)} min`,
    noiseLocationMinutes,
    noiseLocationMinutesDisplay: `${formatNumber(noiseLocationMinutes)} min`,
    noiseGroupCountDisplay: formatNumber(stats.noiseGroupCount),
    noiseThresholdMinutes,
    noiseThresholdDisplay: `${formatNumber(noiseThresholdMinutes)} min`,
    totalGroupCountDisplay: formatNumber(stats.totalGroupCount),
    precisionDisplay: `${formatNumber(stats.precisionDecimals)} decimals`,
    groups: groups.map((row) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const minutes = Number(row.minutes) || 0;

      return {
        groupKey: row.groupKey,
        minutes,
        minutesDisplay: `${formatNumber(minutes)} min`,
        percent: Math.round((minutes / maxMinutes) * 100),
        shareDisplay: totalLocationMinutes > 0
          ? `${formatDecimal((minutes / totalLocationMinutes) * 100)}% of located minutes`
          : '0.0% of located minutes',
        deviceCountDisplay: formatNumber(row.deviceCount),
        packageCountDisplay: formatNumber(row.packageCount),
        firstSeenDisplay: formatDateTime(row.firstSeen),
        lastSeenDisplay: formatDateTime(row.lastSeen),
        coordinateDisplay: `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`,
        mapUrl: buildMapUrl(latitude, longitude),
      };
    }),
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
  const latitude = Number(row?.location?.latitude);
  const longitude = Number(row?.location?.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    id: row._id ? String(row._id) : '',
    receivedAtDisplay: formatDateTime(row.receivedAt),
    method: row.method || 'POST',
    deviceId: row.deviceId || 'unknown',
    packageName: row.package || 'unknown',
    ip: row.ip || 'N/A',
    requestPath: row.requestPath || 'N/A',
    userAgent: row.userAgent || 'N/A',
    locationDisplay: hasLocation ? `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}` : 'N/A',
    locationMapUrl: hasLocation ? buildMapUrl(latitude, longitude) : null,
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
      locationStats: mapLocationStats(dashboard.locationStats),
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
      locationStats: mapLocationStats(),
      hourlySpread: [],
      timeBucketStats: [],
      recentRequests: [],
    });
  }
};
