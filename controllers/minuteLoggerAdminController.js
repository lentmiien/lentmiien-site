const logger = require('../utils/logger');
const {
  MinuteLoggerLocationGroupSettingsError,
  MINUTE_LOGGER_RAW_RETENTION_DAYS,
  MINUTE_LOGGER_RECENT_LIMIT,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME,
  MINUTE_LOGGER_STAT_COLLECTION_NAME,
  MINUTE_LOGGER_STATS_RETENTION_YEARS,
  getMinuteLoggerDashboard,
  updateMinuteLoggerLocationGroupSettings,
} = require('../services/minuteLoggerService');
const {
  formatDateTime,
  formatMinuteDuration,
  formatNumber,
  mapDailyMinuteStats,
} = require('../utils/requestCounterDashboardView');

const METERS_PER_LATITUDE_DEGREE = 111320;
const LOCATION_PREVIEW_WIDTH = 160;
const LOCATION_PREVIEW_HEIGHT = 120;
const LOCATION_PREVIEW_CELL_HEIGHT = 86;
const LOCATION_PREVIEW_MIN_CELL_WIDTH = 36;
const LOCATION_PREVIEW_PADDING_Y = 14;

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

function parseFeedback(query = {}) {
  const status = typeof query.status === 'string' ? query.status : '';
  const message = typeof query.message === 'string' ? query.message : '';
  if (!status || !message) {
    return null;
  }

  return {
    status: status === 'success' ? 'success' : 'error',
    message,
  };
}

function redirectWithFeedback(res, status, message) {
  return res.redirect(
    `/admin/minute-logger?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`
  );
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function roundToNearest(value, nearest = 1) {
  const number = Number(value);
  const increment = Number(nearest) || 1;

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number / increment) * increment;
}

function formatMeters(value, nearest = 1) {
  return `${formatNumber(roundToNearest(value, nearest))} m`;
}

function getRepresentativeLatitude(stats = {}, groups = []) {
  const explicitLatitude = Number(stats.representativeLatitude);
  if (Number.isFinite(explicitLatitude)) {
    return explicitLatitude;
  }

  const firstGroupLatitude = Number(groups[0]?.latitude);
  return Number.isFinite(firstGroupLatitude) ? firstGroupLatitude : null;
}

function buildLocationPrecisionDetails(precisionDecimals, representativeLatitude) {
  const precision = Number(precisionDecimals);
  const latitude = Number(representativeLatitude);

  if (!Number.isInteger(precision) || precision < 0 || !Number.isFinite(latitude)) {
    return null;
  }

  const degreeStep = 10 ** -precision;
  const latitudeMeters = METERS_PER_LATITUDE_DEGREE * degreeStep;
  const longitudeMeters = latitudeMeters * Math.cos(Math.abs(latitude) * Math.PI / 180);
  const diagonalMeters = Math.sqrt((latitudeMeters ** 2) + (longitudeMeters ** 2));
  const halfLatitudeMeters = latitudeMeters / 2;
  const halfLongitudeMeters = longitudeMeters / 2;
  const latitudeText = formatCoordinate(latitude, 2);

  return {
    summary: `${precision} decimals = ${degreeStep.toFixed(precision)} degrees. Near latitude ${latitudeText}, one group cell is about ${formatMeters(latitudeMeters)} x ${formatMeters(longitudeMeters)}.`,
    coverage: `Rounded groups cover about +/-${formatMeters(halfLatitudeMeters)} north/south and +/-${formatMeters(halfLongitudeMeters)} east/west from center; corner-to-corner is about ${formatMeters(diagonalMeters, 10)}.`,
  };
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

function buildLastKnownLocationCard(location) {
  const name = String(location?.name || '').trim();
  if (!name) {
    return null;
  }

  const deviceId = String(location.deviceId || '').trim();
  const receivedAtDisplay = formatDateTime(location.receivedAt);
  const helperParts = [
    deviceId ? `Device ${deviceId}` : '',
    receivedAtDisplay && receivedAtDisplay !== 'N/A' ? receivedAtDisplay : '',
  ].filter(Boolean);

  return {
    label: 'Last Known Location',
    value: name,
    helper: helperParts.length ? helperParts.join(' - ') : 'Latest incoming request',
  };
}

function buildOverviewCards(dashboard) {
  const busiest = dashboard.busiestTimeBucket || {};
  const locationStats = dashboard.locationStats || {};
  const locationGroupCount = Number(locationStats.totalGroupCount)
    || (Array.isArray(locationStats.groups) ? locationStats.groups.length : 0);
  const locatedMinutes = Number(locationStats.totalLocationMinutes) || 0;
  const lastKnownLocationCard = buildLastKnownLocationCard(dashboard.lastKnownLocation);

  const cards = [
    {
      label: 'Last 24 Hours',
      value: `${formatNumber(dashboard.requestsLast24h)} min`,
      helper: `${formatNumber(dashboard.activeDevicesLast24h)} active devices`,
      tone: dashboard.requestsLast24h > 0 ? 'ok' : '',
    },
  ];

  if (lastKnownLocationCard) {
    cards.push(lastKnownLocationCard);
  }

  cards.push(
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
  );

  return cards;
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

function parseGroupKeyCenter(groupKey) {
  const parts = String(groupKey || '').split(',');
  if (parts.length !== 2) {
    return null;
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function buildLocationGroupTitle(row, coordinateLabel) {
  const name = String(row.name || '').trim();
  const hideCoordinates = Boolean(name && row.hideCoordinates);

  if (!name) {
    return coordinateLabel;
  }

  return hideCoordinates ? name : `${name} (${coordinateLabel})`;
}

function projectLocationPoint(point, bounds, rect) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const xRatio = clamp((longitude - bounds.minLongitude) / (bounds.maxLongitude - bounds.minLongitude), 0, 1);
  const yRatio = clamp((bounds.maxLatitude - latitude) / (bounds.maxLatitude - bounds.minLatitude), 0, 1);

  return {
    x: Number((rect.x + (xRatio * rect.width)).toFixed(2)),
    y: Number((rect.y + (yRatio * rect.height)).toFixed(2)),
  };
}

function buildLocationGroupPreview(row, precisionDecimals) {
  const groupCenter = parseGroupKeyCenter(row.groupKey);
  const fallbackLatitude = Number(row.latitude);
  const fallbackLongitude = Number(row.longitude);
  const latitude = groupCenter?.latitude ?? (Number.isFinite(fallbackLatitude) ? fallbackLatitude : null);
  const longitude = groupCenter?.longitude ?? (Number.isFinite(fallbackLongitude) ? fallbackLongitude : null);
  const precision = Number.isInteger(Number(precisionDecimals)) && Number(precisionDecimals) >= 0
    ? Number(precisionDecimals)
    : 3;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const degreeStep = 10 ** -precision;
  const cellWidthRatio = Math.max(
    LOCATION_PREVIEW_MIN_CELL_WIDTH / LOCATION_PREVIEW_CELL_HEIGHT,
    Math.abs(Math.cos(Math.abs(latitude) * Math.PI / 180))
  );
  const rect = {
    width: Number((LOCATION_PREVIEW_CELL_HEIGHT * cellWidthRatio).toFixed(2)),
    height: LOCATION_PREVIEW_CELL_HEIGHT,
  };
  rect.x = Number(((LOCATION_PREVIEW_WIDTH - rect.width) / 2).toFixed(2));
  rect.y = LOCATION_PREVIEW_PADDING_Y;

  const bounds = {
    minLatitude: latitude - (degreeStep / 2),
    maxLatitude: latitude + (degreeStep / 2),
    minLongitude: longitude - (degreeStep / 2),
    maxLongitude: longitude + (degreeStep / 2),
  };
  const pointSamples = Array.isArray(row.pointSamples) ? row.pointSamples : [];
  const points = pointSamples
    .map((point) => projectLocationPoint(point, bounds, rect))
    .filter(Boolean);
  const centerPoint = projectLocationPoint({ latitude, longitude }, bounds, rect);

  return {
    width: LOCATION_PREVIEW_WIDTH,
    height: LOCATION_PREVIEW_HEIGHT,
    rect,
    points,
    pointCount: points.length,
    centerPoint,
  };
}

function mapLocationStats(stats = {}) {
  const groups = Array.isArray(stats.groups) ? stats.groups : [];
  const maxMinutes = Math.max(1, ...groups.map((row) => Number(row.minutes) || 0));
  const totalLocationMinutes = Number(stats.totalLocationMinutes) || 0;
  const groupedLocationMinutes = Number(stats.groupedLocationMinutes) || 0;
  const noiseLocationMinutes = Number(stats.noiseLocationMinutes) || 0;
  const noiseThresholdMinutes = Number(stats.noiseThresholdMinutes) || 0;
  const representativeLatitude = getRepresentativeLatitude(stats, groups);

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
    precisionDetails: buildLocationPrecisionDetails(stats.precisionDecimals, representativeLatitude),
    groups: groups.map((row) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const minutes = Number(row.minutes) || 0;
      const coordinateLabel = row.groupKey || `${formatCoordinate(latitude, 3)},${formatCoordinate(longitude, 3)}`;
      const pointSamples = Array.isArray(row.pointSamples) ? row.pointSamples : [];
      const preview = buildLocationGroupPreview(row, stats.precisionDecimals);
      const name = String(row.name || '').trim();
      const hideCoordinates = Boolean(name && row.hideCoordinates);

      return {
        groupKey: row.groupKey,
        name,
        hideCoordinates,
        titleDisplay: buildLocationGroupTitle({ name, hideCoordinates }, coordinateLabel),
        coordinateLabel,
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
        pointSampleCountDisplay: formatNumber(pointSamples.length),
        preview,
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
      feedback: parseFeedback(req.query),
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
      feedback: null,
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

exports.updateLocationGroupSettings = async (req, res) => {
  try {
    const settings = await updateMinuteLoggerLocationGroupSettings(req.body || {}, {
      updatedBy: req.user?.name || null,
    });

    logger.notice('Minute logger location group settings updated by admin', {
      category: 'minute-logger',
      metadata: {
        groupKey: settings.groupKey,
        hasName: Boolean(settings.name),
        hideCoordinates: settings.hideCoordinates,
        user: req.user?.name || 'unknown',
      },
    });

    return redirectWithFeedback(
      res,
      'success',
      settings.name ? 'Location group saved.' : 'Location group label cleared.'
    );
  } catch (error) {
    if (error instanceof MinuteLoggerLocationGroupSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to update minute logger location group settings', {
      category: 'minute-logger',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save location group.');
  }
};
