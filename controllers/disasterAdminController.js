const logger = require('../utils/logger');
const {
  DisasterAlert,
  DisasterIngestionState,
  DisasterWeatherObservation,
  DisasterWeatherSnapshot,
} = require('../database');
const disasterIngestionService = require('../services/disasterIngestionService');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const TIME_ZONE = 'Asia/Tokyo';
const DASHBOARD_WINDOW_HOURS = 24;
const DASHBOARD_SCOPE_CHAIN = ['横浜旭区', '横浜', '神奈川県'];

const CATEGORY_LABELS = {
  earthquake: 'Earthquake',
  typhoon: 'Typhoon',
  extreme_weather: 'Extreme Weather',
  flood: 'Flood',
  landslide: 'Landslide',
  tornado: 'Tornado',
  tsunami: 'Tsunami',
  volcano: 'Volcano',
  ashfall: 'Ashfall',
  other: 'Other',
};

const SEVERITY_LABELS = {
  emergency: 'Emergency',
  warning: 'Warning',
  watch: 'Watch',
  advisory: 'Advisory',
  info: 'Info',
  cleared: 'Cleared',
};

function formatDateTime(value) {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateTimeLong(value) {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function dateKeyInTokyo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  });
  return `${values.year}-${values.month}-${values.day}`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function formatConfidence(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'N/A';
}

function compactList(values, max = 4) {
  const normalized = Array.isArray(values) ? values.filter(Boolean) : [];
  if (normalized.length <= max) {
    return normalized.join(', ');
  }
  return `${normalized.slice(0, max).join(', ')} +${normalized.length - max}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || 'Other';
}

function severityLabel(severity) {
  return SEVERITY_LABELS[severity] || severity || 'Info';
}

function alertTime(alert) {
  return alert.eventAt || alert.reportAt || alert.entryUpdatedAt || alert.createdAt;
}

function buildAlertDetail(alert) {
  if (alert.category === 'earthquake') {
    const eq = alert.earthquake || {};
    return [
      eq.hypocenterName,
      eq.magnitude ? `M${formatNumber(eq.magnitude, 1)}` : null,
      Number.isFinite(eq.depthKm) ? `${formatNumber(eq.depthKm, 0)} km deep` : null,
      eq.maxIntensity ? `max ${eq.maxIntensity}` : null,
      `横浜旭区 ${eq.yokohamaAsahiIntensity || '0'}`,
    ].filter(Boolean).join(' · ');
  }

  if (alert.category === 'typhoon') {
    const typhoon = alert.typhoon || {};
    return [
      typhoon.name ? `${typhoon.name}${typhoon.number ? ` ${typhoon.number}` : ''}` : null,
      Number.isFinite(typhoon.maxWindProbability) ? `${typhoon.maxWindProbability}% max storm-wind probability` : null,
      typhoon.maxWindProbabilityArea,
    ].filter(Boolean).join(' · ');
  }

  const hazardText = compactList(alert.weather?.hazardNames || alert.hazards?.map((hazard) => hazard.name), 3);
  const areaText = compactList(alert.weather?.areaNames || alert.areas?.map((area) => area.name), 3);
  return [hazardText, areaText].filter(Boolean).join(' · ');
}

function mapAlert(alert) {
  const time = alertTime(alert);
  return {
    id: String(alert._id),
    category: alert.category || 'other',
    categoryLabel: categoryLabel(alert.category),
    severity: alert.severity || 'info',
    severityLabel: severityLabel(alert.severity),
    severityScore: alert.severityScore || 0,
    source: alert.source || 'unknown',
    title: alert.title || alert.sourceEntryTitle || 'Untitled alert',
    headline: alert.headline || alert.summary || '',
    summary: alert.summary || alert.headline || '',
    detail: buildAlertDetail(alert),
    timeDisplay: formatDateTime(time),
    reportAtDisplay: formatDateTime(alert.reportAt),
    sourceUpdatedDisplay: formatDateTime(alert.entryUpdatedAt),
    confidenceDisplay: formatConfidence(alert.confidence),
    sourceUrl: alert.sourceUrl,
    eventId: alert.eventId || 'N/A',
    hazardsDisplay: compactList(alert.hazards?.map((hazard) => hazard.name), 5),
    areasDisplay: compactList(alert.areas?.map((area) => area.name), 5),
    verifications: (alert.verifications || []).map((verification) => ({
      source: verification.source,
      status: verification.status,
      matched: verification.matched,
      confidenceDisplay: formatConfidence(verification.confidence),
      note: verification.note,
    })),
  };
}

function mapWeatherSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }
  const hourly = (snapshot.hourly || []).slice(0, 12).map((entry) => ({
    timeDisplay: formatDateTime(entry.time),
    temperatureDisplay: Number.isFinite(entry.temperatureC) ? `${Math.round(entry.temperatureC)} C` : 'N/A',
    precipitationDisplay: Number.isFinite(entry.precipitationMm) ? `${entry.precipitationMm.toFixed(1)} mm` : 'N/A',
    windDisplay: Number.isFinite(entry.windGustMs)
      ? `${entry.windGustMs.toFixed(1)} m/s gust`
      : (Number.isFinite(entry.windSpeedMs) ? `${entry.windSpeedMs.toFixed(1)} m/s` : 'N/A'),
    description: entry.description || 'N/A',
  }));

  return {
    source: snapshot.source,
    locationName: snapshot.locationName,
    fetchedAtDisplay: formatDateTimeLong(snapshot.fetchedAt),
    summary: snapshot.summary || 'No forecast summary available.',
    hourly,
  };
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseFeedback(query = {}) {
  if (!query.status || !query.message) {
    return null;
  }
  return {
    status: query.status === 'success' ? 'success' : 'error',
    message: String(query.message),
  };
}

function buildHistoryFilter(query = {}) {
  const filter = {};
  if (query.category && query.category !== 'all') {
    filter.category = query.category;
  }
  if (query.source && query.source !== 'all') {
    filter.source = query.source;
  }
  return filter;
}

function timeWindowFilter(since) {
  return {
    $or: [
      { eventAt: { $gte: since } },
      { reportAt: { $gte: since } },
      { entryUpdatedAt: { $gte: since } },
      { createdAt: { $gte: since } },
    ],
  };
}

function scopeFilter(scope) {
  const regex = new RegExp(escapeRegex(scope), 'i');
  const filters = [
    { 'areas.name': regex },
    { 'areas.prefecture': regex },
    { 'weather.areaNames': regex },
    { 'typhoon.affectedAreas.name': regex },
    { 'typhoon.affectedAreas.prefecture': regex },
    { title: regex },
    { headline: regex },
    { sourceEntryContent: regex },
  ];

  if (scope === '横浜旭区') {
    filters.push({
      category: 'earthquake',
      'earthquake.yokohamaAsahiIntensity': { $nin: ['0', '', null] },
    });
  }

  return { $or: filters };
}

function dashboardFilter(scope, since) {
  return {
    $and: [
      timeWindowFilter(since),
      scopeFilter(scope),
    ],
  };
}

async function selectDashboardScope(since) {
  const triedScopes = [];
  for (const scope of DASHBOARD_SCOPE_CHAIN) {
    const count = await DisasterAlert.countDocuments(dashboardFilter(scope, since));
    triedScopes.push({ scope, count });
    if (count > 0) {
      return { scope, count, triedScopes };
    }
  }
  return {
    scope: DASHBOARD_SCOPE_CHAIN[0],
    count: 0,
    triedScopes,
  };
}

function buildAlertTimeline(alerts, now = new Date()) {
  const start = new Date(now.getTime() - (DASHBOARD_WINDOW_HOURS - 1) * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const buckets = Array.from({ length: DASHBOARD_WINDOW_HOURS }, (_, index) => {
    const bucketStart = new Date(start.getTime() + index * 60 * 60 * 1000);
    return {
      key: bucketStart.toISOString(),
      label: new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: '2-digit' }).format(bucketStart),
      count: 0,
      maxSeverityScore: 0,
      percent: 0,
    };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  alerts.forEach((alert) => {
    const date = new Date(alertTime(alert));
    if (Number.isNaN(date.getTime())) return;
    date.setMinutes(0, 0, 0);
    const bucket = byKey.get(date.toISOString());
    if (!bucket) return;
    bucket.count += 1;
    bucket.maxSeverityScore = Math.max(bucket.maxSeverityScore, alert.severityScore || 0);
  });

  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  buckets.forEach((bucket) => {
    bucket.percent = Math.max(bucket.count ? 8 : 0, Math.round((bucket.count / maxCount) * 100));
  });
  return buckets;
}

function buildWeatherChartFromSnapshot(snapshot) {
  const hourly = (snapshot?.hourly || []).slice(0, 24);
  const temps = hourly.map((entry) => entry.temperatureC).filter(Number.isFinite);
  const rain = hourly.map((entry) => entry.precipitationMm).filter(Number.isFinite);
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 1;
  const maxRain = Math.max(1, ...rain);

  return hourly.map((entry) => {
    const tempRange = Math.max(1, maxTemp - minTemp);
    const tempPercent = Number.isFinite(entry.temperatureC)
      ? Math.round(((entry.temperatureC - minTemp) / tempRange) * 100)
      : 0;
    return {
      timeDisplay: formatDateTime(entry.time),
      temperatureDisplay: Number.isFinite(entry.temperatureC) ? `${Math.round(entry.temperatureC)} C` : 'N/A',
      rainDisplay: Number.isFinite(entry.precipitationMm) ? `${entry.precipitationMm.toFixed(1)} mm` : 'N/A',
      tempPercent: Math.max(8, tempPercent),
      rainPercent: Number.isFinite(entry.precipitationMm)
        ? Math.round((entry.precipitationMm / maxRain) * 100)
        : 0,
    };
  });
}

function mapWeatherObservation(entry) {
  return {
    id: String(entry._id),
    source: entry.source,
    locationName: entry.locationName,
    observedAtDisplay: formatDateTimeLong(entry.observedAt),
    bucketDisplay: formatDateTime(entry.bucketStartAt),
    temperatureDisplay: Number.isFinite(entry.temperatureC) ? `${entry.temperatureC.toFixed(1)} C` : 'N/A',
    precipitationDisplay: Number.isFinite(entry.precipitationMm) ? `${entry.precipitationMm.toFixed(1)} mm` : 'N/A',
    windDisplay: Number.isFinite(entry.windGustMs)
      ? `${entry.windGustMs.toFixed(1)} m/s gust`
      : (Number.isFinite(entry.windSpeedMs) ? `${entry.windSpeedMs.toFixed(1)} m/s` : 'N/A'),
    humidityDisplay: Number.isFinite(entry.humidityPercent) ? `${entry.humidityPercent}%` : 'N/A',
    pressureDisplay: Number.isFinite(entry.pressureHpa) ? `${entry.pressureHpa.toFixed(0)} hPa` : 'N/A',
    description: entry.description || 'N/A',
  };
}

function buildWeatherObservationChart(observations) {
  const source = [...observations].sort((a, b) => new Date(a.bucketStartAt) - new Date(b.bucketStartAt));
  const temps = source.map((entry) => entry.temperatureC).filter(Number.isFinite);
  const rain = source.map((entry) => entry.precipitationMm).filter(Number.isFinite);
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 1;
  const maxRain = Math.max(1, ...rain);

  return source.map((entry) => {
    const tempRange = Math.max(1, maxTemp - minTemp);
    const tempPercent = Number.isFinite(entry.temperatureC)
      ? Math.round(((entry.temperatureC - minTemp) / tempRange) * 100)
      : 0;
    return {
      timeDisplay: formatDateTime(entry.bucketStartAt),
      temperatureDisplay: Number.isFinite(entry.temperatureC) ? `${entry.temperatureC.toFixed(1)} C` : 'N/A',
      rainDisplay: Number.isFinite(entry.precipitationMm) ? `${entry.precipitationMm.toFixed(1)} mm` : 'N/A',
      tempPercent: Math.max(8, tempPercent),
      rainPercent: Number.isFinite(entry.precipitationMm)
        ? Math.round((entry.precipitationMm / maxRain) * 100)
        : 0,
    };
  });
}

exports.dashboard = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(`${dateKeyInTokyo(now)}T00:00:00+09:00`);
    const dashboardSince = new Date(now.getTime() - DASHBOARD_WINDOW_HOURS * 60 * 60 * 1000);
    const selectedScope = await selectDashboardScope(dashboardSince);
    const localFilter = dashboardFilter(selectedScope.scope, dashboardSince);
    const [
      latestAlerts,
      timelineAlerts,
      latestEarthquake,
      latestTyphoon,
      latestWeather,
      state,
      weatherSnapshot,
      weatherObservations,
      totalAlerts,
      todayAlerts,
      localWindowCount,
    ] = await Promise.all([
      DisasterAlert.find(localFilter).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).limit(24).lean(),
      DisasterAlert.find(localFilter)
        .sort({ eventAt: -1, reportAt: -1, createdAt: -1 })
        .limit(240)
        .select({ eventAt: 1, reportAt: 1, entryUpdatedAt: 1, createdAt: 1, severityScore: 1 })
        .lean(),
      DisasterAlert.findOne({ ...localFilter, category: 'earthquake' }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterAlert.findOne({ ...localFilter, category: 'typhoon' }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterAlert.findOne({ ...localFilter, category: { $in: ['extreme_weather', 'flood', 'landslide', 'tornado'] } }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterIngestionState.findOne({ key: 'default' }).lean(),
      DisasterWeatherSnapshot.findOne({}).sort({ fetchedAt: -1 }).lean(),
      DisasterWeatherObservation.find({ bucketStartAt: { $gte: dashboardSince } }).sort({ bucketStartAt: 1 }).lean(),
      DisasterAlert.countDocuments(),
      DisasterAlert.countDocuments({ createdAt: { $gte: todayStart } }),
      DisasterAlert.countDocuments(localFilter),
    ]);

    const categoryCountsRaw = await DisasterAlert.aggregate([
      { $match: localFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const categoryCounts = categoryCountsRaw.map((entry) => ({
      category: entry._id || 'other',
      label: categoryLabel(entry._id),
      count: entry.count,
    }));

    return res.render('admin_disaster_dashboard', {
      pageTitle: 'Disaster Dashboard',
      feedback: parseFeedback(req.query),
      loadError: null,
      generatedAtDisplay: formatDateTimeLong(new Date()),
      latestAlerts: latestAlerts.map(mapAlert),
      dashboardScope: {
        scope: selectedScope.scope,
        windowHours: DASHBOARD_WINDOW_HOURS,
        fallbackChain: selectedScope.triedScopes,
        sinceDisplay: formatDateTime(dashboardSince),
      },
      focusCards: [
        { key: 'earthquake', label: 'Latest Earthquake', alert: latestEarthquake ? mapAlert(latestEarthquake) : null },
        { key: 'typhoon', label: 'Latest Typhoon', alert: latestTyphoon ? mapAlert(latestTyphoon) : null },
        { key: 'weather', label: 'Latest Extreme Weather', alert: latestWeather ? mapAlert(latestWeather) : null },
      ],
      overviewCards: [
        { label: 'Stored Alerts', value: totalAlerts, helper: 'Kept indefinitely' },
        { label: 'Saved Today', value: todayAlerts, helper: 'Tokyo local day' },
        { label: 'Local 24h', value: localWindowCount, helper: selectedScope.scope },
        { label: 'Last Poll', value: state?.lastSuccessAt ? formatDateTime(state.lastSuccessAt) : 'Not yet', helper: state?.lastError || 'JMA + backup verification' },
      ],
      state: state ? {
        lastRunAtDisplay: formatDateTimeLong(state.lastRunAt),
        lastSuccessAtDisplay: formatDateTimeLong(state.lastSuccessAt),
        lastErrorAtDisplay: formatDateTimeLong(state.lastErrorAt),
        lastError: state.lastError,
        counters: state.counters || {},
        feeds: state.feeds || [],
      } : null,
      categoryCounts,
      weatherSnapshot: mapWeatherSnapshot(weatherSnapshot),
      alertTimeline: buildAlertTimeline(timelineAlerts, now),
      forecastChart: buildWeatherChartFromSnapshot(weatherSnapshot),
      weatherObservationChart: buildWeatherObservationChart(weatherObservations),
    });
  } catch (error) {
    logger.error('Failed to load disaster dashboard', {
      category: 'disaster_dashboard',
      metadata: { error: error.message },
    });
    return res.status(500).render('admin_disaster_dashboard', {
      pageTitle: 'Disaster Dashboard',
      feedback: null,
      loadError: 'Unable to load disaster dashboard right now.',
      generatedAtDisplay: formatDateTimeLong(new Date()),
      latestAlerts: [],
      dashboardScope: null,
      focusCards: [],
      overviewCards: [],
      state: null,
      categoryCounts: [],
      weatherSnapshot: null,
      alertTimeline: [],
      forecastChart: [],
      weatherObservationChart: [],
    });
  }
};

exports.history = async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const filter = buildHistoryFilter(req.query);
  const skip = (page - 1) * limit;

  try {
    const [alerts, total] = await Promise.all([
      DisasterAlert.find(filter)
        .sort({ eventAt: -1, reportAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DisasterAlert.countDocuments(filter),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.render('admin_disaster_history', {
      pageTitle: 'Disaster History',
      loadError: null,
      alerts: alerts.map(mapAlert),
      filters: {
        category: req.query.category || 'all',
        source: req.query.source || 'all',
        limit,
      },
      categories: [
        ['all', 'All'],
        ...Object.entries(CATEGORY_LABELS),
      ],
      sources: [
        ['all', 'All'],
        ['jma', 'JMA'],
        ['p2pquake', 'P2Pquake'],
        ['usgs', 'USGS'],
        ['nasa-eonet', 'NASA EONET'],
      ],
      pagination: {
        page,
        totalPages,
        total,
        previousPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
      },
    });
  } catch (error) {
    logger.error('Failed to load disaster history', {
      category: 'disaster_dashboard',
      metadata: { error: error.message },
    });
    return res.status(500).render('admin_disaster_history', {
      pageTitle: 'Disaster History',
      loadError: 'Unable to load disaster history right now.',
      alerts: [],
      filters: { category: 'all', source: 'all', limit },
      categories: [['all', 'All']],
      sources: [['all', 'All']],
      pagination: { page: 1, totalPages: 1, total: 0, previousPage: null, nextPage: null },
    });
  }
};

exports.weatherHistory = async (req, res) => {
  const requestedHours = Number.parseInt(req.query.hours, 10);
  const hours = Number.isInteger(requestedHours) && requestedHours > 0
    ? Math.min(requestedHours, 24 * 30)
    : 24 * 7;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    const observations = await DisasterWeatherObservation.find({ bucketStartAt: { $gte: since } })
      .sort({ bucketStartAt: -1 })
      .limit(Math.min(hours + 24, 24 * 31))
      .lean();
    const chartObservations = [...observations].reverse();

    return res.render('admin_disaster_weather_history', {
      pageTitle: 'Weather History',
      loadError: null,
      hours,
      observations: observations.map(mapWeatherObservation),
      weatherObservationChart: buildWeatherObservationChart(chartObservations),
      generatedAtDisplay: formatDateTimeLong(new Date()),
    });
  } catch (error) {
    logger.error('Failed to load disaster weather history', {
      category: 'disaster_dashboard',
      metadata: { error: error.message },
    });
    return res.status(500).render('admin_disaster_weather_history', {
      pageTitle: 'Weather History',
      loadError: 'Unable to load weather history right now.',
      hours,
      observations: [],
      weatherObservationChart: [],
      generatedAtDisplay: formatDateTimeLong(new Date()),
    });
  }
};

exports.refresh = async (req, res) => {
  try {
    const result = await disasterIngestionService.runOnce({
      reason: `manual:${req.user?.name || 'admin'}`,
    });
    const message = result.status === 'skipped'
      ? 'Disaster ingestion is already running.'
      : `Refresh complete. Inserted ${result.inserted || 0} new alert(s).`;
    return res.redirect(`/admin/disasters?status=success&message=${encodeURIComponent(message)}`);
  } catch (error) {
    logger.error('Manual disaster ingestion refresh failed', {
      category: 'disaster_dashboard',
      metadata: { error: error.message },
    });
    return res.redirect(`/admin/disasters?status=error&message=${encodeURIComponent('Refresh failed. Check app logs.')}`);
  }
};

exports.mapAlert = mapAlert;
exports.mapWeatherSnapshot = mapWeatherSnapshot;
