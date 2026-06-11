const logger = require('../utils/logger');
const {
  MinuteLoggerLocationGroupSettingsError,
  MINUTE_LOGGER_BATTERY_INTERPOLATION_GAP_MINUTES,
  MINUTE_LOGGER_RAW_RETENTION_DAYS,
  MINUTE_LOGGER_RECENT_LIMIT,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME,
  MINUTE_LOGGER_STAT_COLLECTION_NAME,
  MINUTE_LOGGER_STATS_RETENTION_YEARS,
  MINUTE_LOGGER_UNUSED_PACKAGE,
  getMinuteLoggerBatteryDashboard,
  getMinuteLoggerDailyAnalytics,
  getMinuteLoggerDashboard,
  getMinuteLoggerNamedLocationAnalytics,
  parseBatteryPercent,
  parseBatteryTempC,
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
const LOCATION_CLOUD_WIDTH = 520;
const LOCATION_CLOUD_HEIGHT = 280;
const LOCATION_CLOUD_PADDING = 18;

function formatDecimal(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '0.0';
}

function formatPercent(value, digits = 1) {
  return `${formatDecimal(value, digits)}%`;
}

function formatCoordinate(value, digits = 5) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : 'N/A';
}

function formatBatteryPercent(value) {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }

  const number = Number(value);
  return Number.isFinite(number) ? `${formatDecimal(number, 0)}%` : 'N/A';
}

function formatBatteryTempC(value) {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }

  const number = Number(value);
  return Number.isFinite(number) ? `${formatDecimal(number, 1)} C` : 'N/A';
}

function formatBatteryDeltaPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatDecimal(Math.max(0, number), 1)}%` : '0.0%';
}

function formatBatteryRate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${formatDecimal(number, 1)}%/hr` : 'N/A';
}

function formatTimeOfDay(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateOnly(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimeRange(start, end) {
  const startDisplay = formatTimeOfDay(start);
  const endDisplay = formatTimeOfDay(end);

  if (startDisplay === 'N/A' || endDisplay === 'N/A') {
    return 'N/A';
  }

  return `${startDisplay} - ${endDisplay}`;
}

function formatShare(part, total) {
  const denominator = Number(total) || 0;
  return denominator > 0 ? formatPercent(((Number(part) || 0) / denominator) * 100) : '0.0%';
}

function safeJson(data) {
  return JSON.stringify(data || {}).replace(/</gu, '\\u003c');
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

function formatApproxDistance(value) {
  const meters = Number(value);

  if (!Number.isFinite(meters) || meters < 0) {
    return null;
  }

  if (meters >= 1000) {
    const kilometers = meters / 1000;
    const digits = kilometers >= 10 ? 1 : 2;
    return `${formatDecimal(kilometers, digits)} km`;
  }

  return `${formatNumber(Math.round(meters))} m`;
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
  const distanceDisplay = formatApproxDistance(location.nearestDistanceMeters);
  const isApproximate = Boolean(location.isApproximate && distanceDisplay);
  const helperParts = [
    isApproximate ? `About ${distanceDisplay} away` : '',
    deviceId ? `Device ${deviceId}` : '',
    receivedAtDisplay && receivedAtDisplay !== 'N/A' ? receivedAtDisplay : '',
  ].filter(Boolean);

  return {
    label: 'Last Known Location',
    value: isApproximate ? `Near ${name}` : name,
    helper: helperParts.length ? helperParts.join(' - ') : 'Latest incoming request',
  };
}

function buildBatteryCard(metric, label, formatter, helperLabel) {
  const count = Number(metric?.count) || 0;

  if (count <= 0) {
    return null;
  }

  const helperParts = [
    `Avg ${formatter(metric.average)}`,
    `min ${formatter(metric.min)}`,
    `max ${formatter(metric.max)}`,
    `${formatNumber(count)} ${helperLabel}`,
  ];
  const latestDevice = String(metric.latestDeviceId || '').trim();
  if (latestDevice) {
    helperParts.unshift(`Device ${latestDevice}`);
  }

  return {
    label,
    value: formatter(metric.latest),
    helper: helperParts.join(' - '),
  };
}

function buildBatteryOverviewCards(batteryStats = {}) {
  return [
    buildBatteryCard(batteryStats.battery, 'Battery Left', formatBatteryPercent, 'readings'),
    buildBatteryCard(batteryStats.batteryTempC, 'Battery Temp', formatBatteryTempC, 'readings'),
  ].filter(Boolean);
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

  cards.push(...buildBatteryOverviewCards(dashboard.batteryStats));

  cards.push(
    {
      label: 'Raw Retained Pings',
      value: formatNumber(dashboard.totalRawRequests),
      helper: `${dashboard.rawRetentionDays}-day raw retention`,
    },
    {
      label: 'Packages',
      value: formatNumber(dashboard.packageCountLast60d),
      helper: `Active in the last ${dashboard.rawRetentionDays} days`,
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
        ? `${formatNumber(locationStats.groupedLocationMinutes)} grouped points, ${formatNumber(locationStats.noiseLocationMinutes)} noise points`
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

  const longitudeSpan = bounds.maxLongitude - bounds.minLongitude;
  const latitudeSpan = bounds.maxLatitude - bounds.minLatitude;
  const xRatio = longitudeSpan === 0
    ? 0.5
    : clamp((longitude - bounds.minLongitude) / longitudeSpan, 0, 1);
  const yRatio = latitudeSpan === 0
    ? 0.5
    : clamp((bounds.maxLatitude - latitude) / latitudeSpan, 0, 1);

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

function mapDailyMinuteStatsLatestFirst(rows = []) {
  return mapDailyMinuteStats(rows)
    .slice()
    .reverse()
    .map((day) => ({
      ...day,
      detailsUrl: `/admin/minute-logger/daily/${encodeURIComponent(day.dateKey)}`,
    }));
}

function getRecentRequestBattery(row) {
  const normalized = parseBatteryPercent(row?.battery);
  if (normalized !== null) {
    return normalized;
  }

  const body = row && typeof row.body === 'object' && !Array.isArray(row.body) ? row.body : {};
  return parseBatteryPercent([
    body.battery,
    body.batteryPercent,
    body.battery_percent,
    body.batteryLevel,
    body.battery_level,
  ]);
}

function getRecentRequestBatteryTempC(row) {
  const normalized = parseBatteryTempC(row?.batteryTempC);
  if (normalized !== null) {
    return normalized;
  }

  const body = row && typeof row.body === 'object' && !Array.isArray(row.body) ? row.body : {};
  return parseBatteryTempC([
    body.battery_temp,
    body.batteryTemp,
    body.batteryTempC,
    body.battery_temperature,
    body.battery_temperature_c,
  ]);
}

function mapRecentRequest(row) {
  const latitude = Number(row?.location?.latitude);
  const longitude = Number(row?.location?.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const battery = getRecentRequestBattery(row);
  const batteryTempC = getRecentRequestBatteryTempC(row);

  return {
    id: row._id ? String(row._id) : '',
    receivedAtDisplay: formatDateTime(row.receivedAt),
    activeDisplay: row.active === false ? 'Background' : 'Active',
    method: row.method || 'POST',
    deviceId: row.deviceId || 'unknown',
    packageName: row.package || 'unknown',
    ip: row.ip || 'N/A',
    requestPath: row.requestPath || 'N/A',
    userAgent: row.userAgent || 'N/A',
    locationDisplay: hasLocation ? `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}` : 'N/A',
    locationMapUrl: hasLocation ? buildMapUrl(latitude, longitude) : null,
    batteryDisplay: formatBatteryPercent(battery),
    batteryTempDisplay: formatBatteryTempC(batteryTempC),
    bodyJson: formatPayload(row.body || {}),
  };
}

function mapBreakdownRow(row, totalMinutes = 0, labelKey = 'name') {
  const minutes = Number(row.minutes) || 0;

  return {
    name: row[labelKey] || row.name || 'unknown',
    minutes,
    minutesDisplay: `${formatNumber(minutes)} min`,
    durationDisplay: formatMinuteDuration(minutes),
    shareDisplay: formatShare(minutes, totalMinutes),
    deviceCountDisplay: formatNumber(row.deviceCount),
    packageCountDisplay: formatNumber(row.packageCount),
    locatedShareDisplay: formatShare(row.locatedMinutes, minutes),
    firstSeenDisplay: formatDateTime(row.firstSeen),
    lastSeenDisplay: formatDateTime(row.lastSeen),
  };
}

function mapTransitionRow(row) {
  return {
    from: row.from || 'unknown',
    to: row.to || 'unknown',
    count: Number(row.count) || 0,
    countDisplay: formatNumber(row.count),
  };
}

function mapDevicePackageRow(row) {
  const minutes = Number(row.minutes) || 0;

  return {
    deviceId: row.deviceId || 'unknown',
    minutes,
    minutesDisplay: `${formatNumber(minutes)} min`,
    packages: (Array.isArray(row.packages) ? row.packages : []).map((entry) => ({
      name: entry.name || 'unknown',
      minutes: Number(entry.minutes) || 0,
      minutesDisplay: `${formatNumber(entry.minutes)} min`,
      shareDisplay: formatShare(entry.minutes, minutes),
    })),
  };
}

function buildRawLocationStats(groups = [], totalLocationMinutes = 0) {
  return mapLocationStats({
    groups,
    totalLocationMinutes,
    groupedLocationMinutes: totalLocationMinutes,
    noiseLocationMinutes: 0,
    noiseGroupCount: 0,
    totalGroupCount: groups.length,
    noiseThresholdMinutes: 1,
    precisionDecimals: 3,
  });
}

function buildDailyOverviewCards(analytics = {}) {
  const totalMinutes = Number(analytics.totalMinutes) || 0;
  const totalRawRequests = Number(analytics.totalRawRequests) || totalMinutes;
  const inactiveRequests = Number(analytics.inactiveRequests) || Math.max(0, totalRawRequests - totalMinutes);
  const locatedMinutes = Number(analytics.locatedMinutes) || 0;
  const namedLocationMinutes = Number(analytics.namedLocationMinutes) || 0;
  const quietGapMinutes = Number(analytics.quietGap?.longestGapMinutes) || 0;
  const activeSpanMinutes = analytics.firstSeen && analytics.lastSeen
    ? Math.max(1, Math.round((new Date(analytics.lastSeen).getTime() - new Date(analytics.firstSeen).getTime()) / 60000) + 1)
    : 0;

  const cards = [
    {
      label: 'Total Minutes',
      value: `${formatNumber(totalMinutes)} min`,
      helper: `${formatDecimal(totalMinutes / 60)} active hours logged`,
      tone: totalMinutes > 0 ? 'ok' : '',
    },
    {
      label: 'Located Points',
      value: formatNumber(locatedMinutes),
      helper: `${formatShare(locatedMinutes, totalRawRequests)} of logged pings`,
    },
    {
      label: 'Named Locations',
      value: formatNumber(namedLocationMinutes),
      helper: `${formatShare(namedLocationMinutes, locatedMinutes)} of located points`,
    },
    {
      label: 'Active Devices',
      value: formatNumber(analytics.deviceCount),
      helper: `${formatNumber(analytics.packageCount)} active packages seen`,
    },
    {
      label: 'Active Span',
      value: activeSpanMinutes ? formatMinuteDuration(activeSpanMinutes) : 'N/A',
      helper: analytics.firstSeen && analytics.lastSeen ? formatTimeRange(analytics.firstSeen, analytics.lastSeen) : 'No requests',
    },
    {
      label: 'Longest Quiet Gap',
      value: formatMinuteDuration(quietGapMinutes),
      helper: quietGapMinutes > 0
        ? formatTimeRange(analytics.quietGap.longestGapStart, analytics.quietGap.longestGapEnd)
        : 'No gap between logged minutes',
    },
    ...buildBatteryOverviewCards(analytics.batteryStats),
  ];

  if (inactiveRequests > 0) {
    cards.splice(1, 0, {
      label: 'Background Pings',
      value: formatNumber(inactiveRequests),
      helper: `${formatShare(inactiveRequests, totalRawRequests)} of logged pings`,
    });
  }

  return cards;
}

function buildNamedLocationOverviewCards(analytics = {}) {
  const totalMinutes = Number(analytics.totalMinutes) || 0;
  const busiest = analytics.busiestLocation || {};

  return [
    {
      label: 'Named Locations',
      value: formatNumber(analytics.namedLocationCount),
      helper: `${formatNumber(analytics.activeNamedLocationCount)} active in raw retention`,
      tone: analytics.namedLocationCount > 0 ? 'ok' : '',
    },
    {
      label: 'Location Groups',
      value: formatNumber(analytics.namedLocationGroupCount),
      helper: 'Saved named coordinate cells',
    },
    {
      label: 'Named Minutes',
      value: `${formatNumber(totalMinutes)} min`,
      helper: `Last ${analytics.rawRetentionDays || MINUTE_LOGGER_RAW_RETENTION_DAYS} days`,
    },
    {
      label: 'Busiest Location',
      value: busiest.name || 'N/A',
      helper: busiest.totalMinutes ? `${formatNumber(busiest.totalMinutes)} min` : 'No named activity',
    },
    {
      label: 'Devices',
      value: formatNumber(analytics.deviceCount),
      helper: `${formatNumber(analytics.packageCount)} packages at named locations`,
    },
  ];
}

function mapBatteryPackageAnalytics(packageStats = []) {
  return (Array.isArray(packageStats) ? packageStats : []).map((entry) => {
    const observedPoints = Number(entry.observedPoints) || 0;
    const inferredMinutes = Number(entry.inferredMinutes) || 0;
    const totalMinutes = Number(entry.totalMinutes) || observedPoints + inferredMinutes;
    const battery = entry.battery || {};
    const batteryTempC = entry.batteryTempC || {};

    return {
      name: entry.name || 'unknown',
      color: entry.color || '#19E3E3',
      observedPoints,
      inferredMinutes,
      totalMinutes,
      observedPointsDisplay: formatNumber(observedPoints),
      inferredMinutesDisplay: inferredMinutes > 0 ? formatMinuteDuration(inferredMinutes) : '0 minutes',
      totalMinutesDisplay: formatMinuteDuration(totalMinutes),
      deviceCountDisplay: formatNumber(entry.deviceCount),
      averageChargeDisplay: formatBatteryPercent(battery.average),
      averageTempDisplay: formatBatteryTempC(batteryTempC.average),
      maxTempDisplay: formatBatteryTempC(batteryTempC.max),
      chargeDropDisplay: formatBatteryDeltaPercent(entry.chargeDropPercent),
      chargeDropSamplesDisplay: formatNumber(entry.chargeDropSamples),
      drainRateDisplay: formatBatteryRate(entry.drainRatePercentPerHour),
    };
  });
}

function mapBatteryChargingPackageStats(packageStats = []) {
  return (Array.isArray(packageStats) ? packageStats : []).map((entry) => ({
    name: entry.name || 'unknown',
    color: entry.color || '#19E3E3',
    intervalCountDisplay: formatNumber(entry.intervalCount),
    totalGainDisplay: formatBatteryDeltaPercent(entry.totalGainPercent),
    totalDurationDisplay: formatMinuteDuration(entry.totalMinutes),
    averageSpeedDisplay: formatBatteryRate(entry.averageSpeedPercentPerHour),
    maxSpeedDisplay: formatBatteryRate(entry.maxSpeedPercentPerHour),
    averageTempDisplay: formatBatteryTempC(entry.batteryTempC?.average),
    deviceCountDisplay: formatNumber(entry.deviceCount),
  }));
}

function mapBatteryChargingSummary(charging = {}) {
  const intervalCount = Number(charging.intervalCount) || 0;
  const tempCount = Number(charging.batteryTempC?.count) || 0;

  return {
    hasCharging: intervalCount > 0,
    intervalCount,
    intervalCountDisplay: formatNumber(intervalCount),
    totalGainDisplay: formatBatteryDeltaPercent(charging.totalGainPercent),
    totalDurationDisplay: formatMinuteDuration(charging.totalMinutes),
    averageSpeedDisplay: formatBatteryRate(charging.averageSpeedPercentPerHour),
    maxSpeedDisplay: formatBatteryRate(charging.maxSpeedPercentPerHour),
    averageTempDisplay: formatBatteryTempC(charging.batteryTempC?.average),
    maxTempDisplay: formatBatteryTempC(charging.batteryTempC?.max),
    tempCountDisplay: formatNumber(tempCount),
    deviceCountDisplay: formatNumber(charging.deviceCount),
  };
}

function buildBatteryDashboardOverviewCards(dashboard = {}) {
  const windowHours = Number(dashboard.windowHours) || 12;
  const rawRetentionDays = Number(dashboard.rawRetentionDays) || MINUTE_LOGGER_RAW_RETENTION_DAYS;
  const packages = Array.isArray(dashboard.packages) ? dashboard.packages : [];
  const points = Array.isArray(dashboard.points) ? dashboard.points : [];
  const noActivePointCount = Number(dashboard.noActivePointCount) || 0;
  const batteryAnalytics = dashboard.batteryAnalytics || {};
  const charging = batteryAnalytics.charging || {};
  const inferredUnusedMinutes = Number(batteryAnalytics.inferredUnusedMinutes)
    || Number(dashboard.inferredUnusedMinutes)
    || 0;
  const cards = [
    ...buildBatteryOverviewCards(dashboard.batteryStats),
    {
      label: 'Retained Points',
      value: formatNumber(points.length),
      helper: `${rawRetentionDays}-day raw retention`,
      tone: points.length > 0 ? 'ok' : '',
    },
    {
      label: 'Packages',
      value: formatNumber(packages.length),
      helper: noActivePointCount > 0
        ? `${formatNumber(noActivePointCount)} pings without package context`
        : 'Explicit unused pings are included',
    },
  ];

  if (inferredUnusedMinutes > 0) {
    cards.push({
      label: 'Inferred Unused',
      value: formatMinuteDuration(inferredUnusedMinutes),
      helper: `Empty minutes before ${MINUTE_LOGGER_UNUSED_PACKAGE} pings`,
    });
  }

  if (Number(batteryAnalytics.totalChargeDropPercent) > 0) {
    cards.push({
      label: 'Charge Drop',
      value: formatBatteryDeltaPercent(batteryAnalytics.totalChargeDropPercent),
      helper: `${formatNumber(batteryAnalytics.chargeDropSamples)} decreases, charging ignored`,
    });
  }

  if (Number(charging.intervalCount) > 0) {
    cards.push({
      label: 'Charging',
      value: formatBatteryDeltaPercent(charging.totalGainPercent),
      helper: `${formatBatteryRate(charging.averageSpeedPercentPerHour)} over ${formatMinuteDuration(charging.totalMinutes)}`,
    });
  }

  if (Number(charging.batteryTempC?.count) > 0) {
    cards.push({
      label: 'Charging Temp',
      value: formatBatteryTempC(charging.batteryTempC.average),
      helper: `max ${formatBatteryTempC(charging.batteryTempC.max)}`,
    });
  }

  cards.push({
    label: 'Window',
    value: `${formatNumber(windowHours)} hr`,
    helper: `Slider range covers ${rawRetentionDays} days`,
  });

  return cards;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildBatteryDashboardPayload(dashboard = {}) {
  const retentionStart = new Date(dashboard.retentionStart);
  const retentionEnd = new Date(dashboard.retentionEnd || dashboard.generatedAt || Date.now());

  return {
    retentionStartMs: Number.isNaN(retentionStart.getTime()) ? null : retentionStart.getTime(),
    retentionEndMs: Number.isNaN(retentionEnd.getTime()) ? Date.now() : retentionEnd.getTime(),
    rawRetentionDays: dashboard.rawRetentionDays || MINUTE_LOGGER_RAW_RETENTION_DAYS,
    windowHours: Number(dashboard.windowHours) || 12,
    unusedPackageName: MINUTE_LOGGER_UNUSED_PACKAGE,
    interpolationGapMinutes: MINUTE_LOGGER_BATTERY_INTERPOLATION_GAP_MINUTES,
    packages: (Array.isArray(dashboard.packages) ? dashboard.packages : []).map((entry) => ({
      name: entry.name || 'unknown',
      color: entry.color || '#19E3E3',
    })),
    points: (Array.isArray(dashboard.points) ? dashboard.points : []).map((point) => ({
      t: Number(point.t),
      b: normalizeOptionalNumber(point.b),
      c: normalizeOptionalNumber(point.c),
      p: Number.isInteger(point.p) ? point.p : null,
    })).filter((point) => Number.isFinite(point.t)),
  };
}

function mapBatteryPackageLegend(packages = []) {
  return (Array.isArray(packages) ? packages : []).map((entry) => ({
    name: entry.name || 'unknown',
    color: entry.color || '#19E3E3',
    count: Number(entry.count) || 0,
    countDisplay: formatNumber(entry.count),
  }));
}

function buildBatteryDashboardViewModel(dashboard = {}, options = {}) {
  const retentionStart = dashboard.retentionStart || null;
  const retentionEnd = dashboard.retentionEnd || dashboard.generatedAt || new Date();
  const packages = Array.isArray(dashboard.packages) ? dashboard.packages : [];
  const noActivePointCount = Number(dashboard.noActivePointCount) || 0;
  const batteryAnalytics = dashboard.batteryAnalytics || {};
  const inferredUnusedMinutes = Number(batteryAnalytics.inferredUnusedMinutes)
    || Number(dashboard.inferredUnusedMinutes)
    || 0;

  return {
    pageTitle: 'Minute Logger Battery Tracker',
    loadError: options.loadError || null,
    generatedAtDisplay: formatDateTime(dashboard.generatedAt || new Date()),
    endpointPath: dashboard.endpointPath || 'N/A',
    rawRetentionDays: dashboard.rawRetentionDays || MINUTE_LOGGER_RAW_RETENTION_DAYS,
    retentionStartDisplay: formatDateTime(retentionStart),
    retentionEndDisplay: formatDateTime(retentionEnd),
    windowHours: Number(dashboard.windowHours) || 12,
    pointCountDisplay: formatNumber(dashboard.pointCount || (dashboard.points || []).length),
    noActivePointCountDisplay: formatNumber(noActivePointCount),
    inferredUnusedMinutesDisplay: formatMinuteDuration(inferredUnusedMinutes),
    packageCountDisplay: formatNumber(packages.length),
    overviewCards: dashboard.generatedAt ? buildBatteryDashboardOverviewCards(dashboard) : [],
    batteryPackageStats: mapBatteryPackageAnalytics(batteryAnalytics.packageStats),
    chargingSummary: mapBatteryChargingSummary(batteryAnalytics.charging),
    chargingPackageStats: mapBatteryChargingPackageStats(batteryAnalytics.charging?.packageStats),
    packageLegend: mapBatteryPackageLegend(packages),
    noActivePackageLegend: {
      name: 'No package context',
      color: 'rgba(154, 163, 178, 0.22)',
      count: noActivePointCount,
      countDisplay: formatNumber(noActivePointCount),
    },
    batteryTrackerJson: safeJson(buildBatteryDashboardPayload(dashboard)),
  };
}

function buildLocationPointCloud(pointCloud = {}) {
  const bounds = pointCloud.bounds;

  if (!bounds) {
    return null;
  }

  const rect = {
    x: LOCATION_CLOUD_PADDING,
    y: LOCATION_CLOUD_PADDING,
    width: LOCATION_CLOUD_WIDTH - (LOCATION_CLOUD_PADDING * 2),
    height: LOCATION_CLOUD_HEIGHT - (LOCATION_CLOUD_PADDING * 2),
  };
  const points = (Array.isArray(pointCloud.points) ? pointCloud.points : [])
    .map((point) => {
      const projected = projectLocationPoint(point, bounds, rect);

      if (!projected) {
        return null;
      }

      return {
        ...projected,
        title: [
          point.package || '',
          point.deviceId || '',
          formatDateTime(point.receivedAt),
        ].filter(Boolean).join(' - '),
      };
    })
    .filter(Boolean);
  const labels = (Array.isArray(pointCloud.labels) ? pointCloud.labels : [])
    .map((label) => {
      const projected = projectLocationPoint(label, bounds, rect);

      if (!projected) {
        return null;
      }

      return {
        ...projected,
        name: label.name,
      };
    })
    .filter(Boolean);

  return {
    width: LOCATION_CLOUD_WIDTH,
    height: LOCATION_CLOUD_HEIGHT,
    rect,
    points,
    labels,
    boundsDisplay: `${formatCoordinate(bounds.minLatitude, 4)}, ${formatCoordinate(bounds.minLongitude, 4)} to ${formatCoordinate(bounds.maxLatitude, 4)}, ${formatCoordinate(bounds.maxLongitude, 4)}`,
  };
}

function mapDailyTrend(rows = []) {
  const maxMinutes = Math.max(1, ...(Array.isArray(rows) ? rows : []).map((row) => Number(row.minutes) || 0));

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const minutes = Number(row.minutes) || 0;

    return {
      dateKey: row.dateKey,
      label: String(row.dateKey || '').slice(5),
      minutes,
      minutesDisplay: `${formatNumber(minutes)} min`,
      percent: Math.round((minutes / maxMinutes) * 100),
    };
  });
}

function mapNamedLocationGroup(group = {}, totalNamedMinutes = 0) {
  const locationStats = buildRawLocationStats(group.locationGroups || [], group.locatedMinutes || 0);
  const maxPackageMinutes = Math.max(1, ...(group.packageStats || []).map((row) => Number(row.minutes) || 0));
  const maxDeviceMinutes = Math.max(1, ...(group.deviceStats || []).map((row) => Number(row.minutes) || 0));
  const maxLocationMinutes = Math.max(1, ...locationStats.groups.map((row) => Number(row.minutes) || 0));

  return {
    name: group.name,
    totalMinutes: Number(group.totalMinutes) || 0,
    totalMinutesDisplay: `${formatNumber(group.totalMinutes)} min`,
    shareDisplay: formatShare(group.totalMinutes, totalNamedMinutes),
    locatedMinutesDisplay: `${formatNumber(group.locatedMinutes)} min`,
    groupCountDisplay: formatNumber((group.groupKeys || []).length),
    deviceCountDisplay: formatNumber(group.deviceCount),
    packageCountDisplay: formatNumber(group.packageCount),
    firstSeenDisplay: formatDateTime(group.firstSeen),
    lastSeenDisplay: formatDateTime(group.lastSeen),
    busiestTimeDisplay: group.busiestTimeBucket?.label || 'N/A',
    busiestTimeHelper: group.busiestTimeBucket
      ? `${formatNumber(group.busiestTimeBucket.minutes)} min`
      : 'No activity',
    packageStats: (group.packageStats || []).map((row) => mapBreakdownRow(row, group.totalMinutes)),
    deviceStats: (group.deviceStats || []).map((row) => mapBreakdownRow(row, group.totalMinutes)),
    locationStats,
    maxPackageMinutes,
    maxDeviceMinutes,
    maxLocationMinutes,
    hourlySpread: mapHourlySpread(group.hourlySpread || []),
    dailyTrend: mapDailyTrend(group.dailyTrend || []),
    pointCloud: buildLocationPointCloud(group.pointCloud),
  };
}

function buildTimelinePayload(timeline = {}) {
  const bounds = timeline.bounds || null;
  const defaultMinute = Number(timeline.defaultMinute);

  return {
    bounds,
    labels: (Array.isArray(timeline.labels) ? timeline.labels : []).map((label) => ({
      name: label.name,
      latitude: Number(label.latitude),
      longitude: Number(label.longitude),
    })).filter((label) => Number.isFinite(label.latitude) && Number.isFinite(label.longitude)),
    points: (Array.isArray(timeline.points) ? timeline.points : []).map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      minuteOfDay: Number(point.minuteOfDay) || 0,
      name: point.name || '',
      package: point.package || 'unknown',
      deviceId: point.deviceId || 'unknown',
      receivedAt: point.receivedAt ? new Date(point.receivedAt).toISOString() : null,
    })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
    defaultMinute: Number.isFinite(defaultMinute) ? defaultMinute : 720,
  };
}

function buildAdjacentDateUrl(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setDate(date.getDate() + offset);
  return `/admin/minute-logger/daily/${encodeURIComponent(formatDateOnly(date))}`;
}

function formatBoundsDisplay(bounds) {
  if (!bounds) {
    return 'No location bounds';
  }

  return `${formatCoordinate(bounds.minLatitude, 4)}, ${formatCoordinate(bounds.minLongitude, 4)} to ${formatCoordinate(bounds.maxLatitude, 4)}, ${formatCoordinate(bounds.maxLongitude, 4)}`;
}

function buildDailyAnalyticsViewModel(analytics = {}, options = {}) {
  const totalMinutes = Number(analytics.totalMinutes) || 0;
  const locationStats = buildRawLocationStats(analytics.locationGroups || [], analytics.locatedMinutes || 0);
  const timelinePayload = buildTimelinePayload(analytics.locationTimeline || {});

  return {
    pageTitle: `Minute Logger Daily Analytics - ${analytics.dateKey || options.dateKey || ''}`,
    loadError: options.loadError || null,
    generatedAtDisplay: formatDateTime(analytics.generatedAt || new Date()),
    endpointPath: analytics.endpointPath || 'N/A',
    dateKey: analytics.dateKey || options.dateKey || 'N/A',
    dateDisplay: analytics.dateKey || options.dateKey || 'N/A',
    previousDateUrl: analytics.dateKey ? buildAdjacentDateUrl(analytics.dateKey, -1) : null,
    nextDateUrl: analytics.dateKey ? buildAdjacentDateUrl(analytics.dateKey, 1) : null,
    overviewCards: analytics.dateKey ? buildDailyOverviewCards(analytics) : [],
    hourlySpread: mapHourlySpread(analytics.hourlySpread || []),
    timeBucketStats: (analytics.timeBucketStats || []).map(mapTimeBucket),
    busiestTimeBucket: analytics.busiestTimeBucket ? mapTimeBucket(analytics.busiestTimeBucket) : null,
    packageStats: (analytics.packageStats || []).slice(0, 12).map((row) => mapBreakdownRow(row, totalMinutes)),
    deviceStats: (analytics.deviceStats || []).slice(0, 12).map((row) => mapBreakdownRow(row, totalMinutes)),
    devicePackageMatrix: (analytics.devicePackageMatrix || []).map(mapDevicePackageRow),
    locationStats,
    maxPackageMinutes: Math.max(1, ...(analytics.packageStats || []).map((row) => Number(row.minutes) || 0)),
    maxDeviceMinutes: Math.max(1, ...(analytics.deviceStats || []).map((row) => Number(row.minutes) || 0)),
    maxLocationMinutes: Math.max(1, ...locationStats.groups.map((row) => Number(row.minutes) || 0)),
    packageTransitions: (analytics.packageTransitions || []).map(mapTransitionRow),
    namedLocationTransitions: (analytics.namedLocationTransitions || []).map(mapTransitionRow),
    timelineJson: safeJson(timelinePayload),
    timelinePointCountDisplay: formatNumber(timelinePayload.points.length),
    timelineLabelCountDisplay: formatNumber(timelinePayload.labels.length),
    timelineBoundsDisplay: formatBoundsDisplay(timelinePayload.bounds),
    recentRequests: (analytics.recentRequests || []).map(mapRecentRequest),
  };
}

function buildNamedLocationAnalyticsViewModel(analytics = {}, options = {}) {
  const totalNamedMinutes = Number(analytics.totalMinutes) || 0;
  const groups = (analytics.groups || []).map((group) => mapNamedLocationGroup(group, totalNamedMinutes));

  return {
    pageTitle: 'Minute Logger Location Analytics',
    loadError: options.loadError || null,
    generatedAtDisplay: formatDateTime(analytics.generatedAt || new Date()),
    endpointPath: analytics.endpointPath || 'N/A',
    rawRetentionDays: analytics.rawRetentionDays || MINUTE_LOGGER_RAW_RETENTION_DAYS,
    sinceDisplay: formatDateTime(analytics.since),
    overviewCards: analytics.generatedAt ? buildNamedLocationOverviewCards(analytics) : [],
    groups,
    totalNamedMinutes,
    totalNamedMinutesDisplay: `${formatNumber(totalNamedMinutes)} min`,
    maxNamedLocationMinutes: Math.max(1, ...groups.map((group) => Number(group.totalMinutes) || 0)),
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
      dailyMinuteStats: mapDailyMinuteStatsLatestFirst(dashboard.dailyMinuteStats),
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

exports.batteryDashboard = async (req, res) => {
  try {
    const dashboard = await getMinuteLoggerBatteryDashboard();

    return res.render('admin_minute_logger_battery', buildBatteryDashboardViewModel(dashboard));
  } catch (error) {
    logger.error('Failed to load minute logger battery dashboard', {
      category: 'minute-logger',
      metadata: { error: error.message },
    });

    return res.status(500).render('admin_minute_logger_battery', buildBatteryDashboardViewModel({}, {
      loadError: 'Unable to load minute logger battery data right now.',
    }));
  }
};

exports.dailyAnalytics = async (req, res) => {
  const dateKey = String(req.params.dateKey || '').trim();

  try {
    const analytics = await getMinuteLoggerDailyAnalytics(dateKey);

    if (!analytics) {
      return res.status(404).render('admin_minute_logger_daily', buildDailyAnalyticsViewModel({}, {
        dateKey,
        loadError: 'Daily analytics date must use YYYY-MM-DD.',
      }));
    }

    return res.render('admin_minute_logger_daily', buildDailyAnalyticsViewModel(analytics));
  } catch (error) {
    logger.error('Failed to load minute logger daily analytics', {
      category: 'minute-logger',
      metadata: {
        dateKey,
        error: error.message,
      },
    });

    return res.status(500).render('admin_minute_logger_daily', buildDailyAnalyticsViewModel({}, {
      dateKey,
      loadError: 'Unable to load daily minute logger analytics right now.',
    }));
  }
};

exports.namedLocationAnalytics = async (req, res) => {
  try {
    const analytics = await getMinuteLoggerNamedLocationAnalytics();

    return res.render('admin_minute_logger_locations', buildNamedLocationAnalyticsViewModel(analytics));
  } catch (error) {
    logger.error('Failed to load minute logger named location analytics', {
      category: 'minute-logger',
      metadata: { error: error.message },
    });

    return res.status(500).render('admin_minute_logger_locations', buildNamedLocationAnalyticsViewModel({}, {
      loadError: 'Unable to load named location analytics right now.',
    }));
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
