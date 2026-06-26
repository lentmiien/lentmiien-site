const logger = require('../utils/logger');
const {
  DisasterAlert,
  DisasterIngestionState,
  DisasterWeatherSnapshot,
} = require('../database');
const disasterIngestionService = require('../services/disasterIngestionService');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const TIME_ZONE = 'Asia/Tokyo';

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

exports.dashboard = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(`${dateKeyInTokyo(now)}T00:00:00+09:00`);
    const [
      latestAlerts,
      latestEarthquake,
      latestTyphoon,
      latestWeather,
      state,
      weatherSnapshot,
      totalAlerts,
      todayAlerts,
    ] = await Promise.all([
      DisasterAlert.find({}).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).limit(14).lean(),
      DisasterAlert.findOne({ category: 'earthquake' }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterAlert.findOne({ category: 'typhoon' }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterAlert.findOne({ category: { $in: ['extreme_weather', 'flood', 'landslide', 'tornado'] } }).sort({ eventAt: -1, reportAt: -1, createdAt: -1 }).lean(),
      DisasterIngestionState.findOne({ key: 'default' }).lean(),
      DisasterWeatherSnapshot.findOne({}).sort({ fetchedAt: -1 }).lean(),
      DisasterAlert.countDocuments(),
      DisasterAlert.countDocuments({ createdAt: { $gte: todayStart } }),
    ]);

    const categoryCountsRaw = await DisasterAlert.aggregate([
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
      focusCards: [
        { key: 'earthquake', label: 'Latest Earthquake', alert: latestEarthquake ? mapAlert(latestEarthquake) : null },
        { key: 'typhoon', label: 'Latest Typhoon', alert: latestTyphoon ? mapAlert(latestTyphoon) : null },
        { key: 'weather', label: 'Latest Extreme Weather', alert: latestWeather ? mapAlert(latestWeather) : null },
      ],
      overviewCards: [
        { label: 'Stored Alerts', value: totalAlerts, helper: 'Kept indefinitely' },
        { label: 'Saved Today', value: todayAlerts, helper: 'Tokyo local day' },
        { label: 'Last Poll', value: state?.lastSuccessAt ? formatDateTime(state.lastSuccessAt) : 'Not yet', helper: state?.lastError || 'JMA + backup verification' },
        { label: 'Start Date', value: state?.startedAt ? formatDateTime(state.startedAt) : 'Pending', helper: 'No automatic expiry' },
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
      focusCards: [],
      overviewCards: [],
      state: null,
      categoryCounts: [],
      weatherSnapshot: null,
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
