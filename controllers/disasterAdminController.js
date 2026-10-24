const logger = require('../utils/logger');
const {
  DisasterAlert,
  DisasterWeatherObservation,
} = require('../database');
const { createLocalSummaryService, buildSummary } = require('../services/disasterLocalSummaryService');
const { locationConfig } = require('../utils/disasterLocality');
const localSummary = createLocalSummaryService();

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
      `横浜旭区 ${alert.parserVersion === 'jma-v3-local' || alert.localSummaryVersion === 'jma-v3-local' ? eq.yokohamaAsahiIntensity ?? 'unknown' : 'unknown (legacy record)'}`,
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
    message: String(query.message).slice(0, 200),
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
    return res.render('admin_disaster_dashboard', { pageTitle: 'Local Disaster Watch',
      summary: await localSummary.read(), feedback: parseFeedback(req.query), loadError: null, formatDateTimeLong });
  } catch (error) {
    logger.warning('Local disaster summary read failed', { category: 'disaster_dashboard', metadata: { errorName: error.name } });
    return res.status(503).render('admin_disaster_dashboard', { pageTitle: 'Local Disaster Watch',
      summary: buildSummary([]), feedback: null, loadError: 'Stored local data is temporarily unavailable.', formatDateTimeLong });
  }
};
exports.summary = async (req, res) => {
  if (Object.keys(req.query).length) return res.status(400).json({ ok: false, error: 'Unexpected parameters.' });
  try { return res.json({ ok: true, summary: await localSummary.read() }); }
  catch (error) {
    logger.warning('Local disaster summary API failed', { category: 'disaster_dashboard', metadata: { errorName: error.name } });
    return res.status(503).json({ ok: false, error: 'Local summary unavailable.' });
  }
};

exports.history = async (req, res) => {
  if (Object.keys(req.query).some(k => !['category', 'source', 'page', 'limit'].includes(k))
    || (req.query.category && !['all', ...Object.keys(CATEGORY_LABELS)].includes(req.query.category))
    || (req.query.source && !['all', 'jma', 'p2pquake', 'usgs', 'nasa-eonet'].includes(req.query.source))) {
    return res.status(400).send('Invalid archive filters.');
  }
  const limit = parseLimit(req.query.limit);
  const page = Math.min(20, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const filter = buildHistoryFilter(req.query);
  const skip = (page - 1) * limit;

  try {
    const candidates = await DisasterAlert.find(filter)
      .sort({ reportAt: -1 }).skip(skip).limit(limit + 1).maxTimeMS(2000)
      .select('-raw -verifications.raw').lean();
    const alerts = candidates.slice(0, limit);
    const totalPages = candidates.length > limit && page < 20 ? page + 1 : page;
    const total = null;

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
    const observations = await DisasterWeatherObservation.find({ locationName: locationConfig().name, bucketStartAt: { $gte: since } })
      .sort({ bucketStartAt: -1 })
      .limit(Math.min(hours + 24, 24 * 31)).select('-raw -latitude -longitude').maxTimeMS(2000)
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
  if (Object.keys(req.body || {}).some(k => k !== '_csrf')) return res.status(400).json({ ok: false, error: 'Unexpected refresh parameters.' });
  // Respond immediately; background work has its own concurrency guard and operational logs.
  const ingestion = require('../services/disasterIngestionService');
  if (ingestion.running || ingestion.weatherRunning) return res.status(409).json({ ok: false, error: 'A source refresh is already running.' });
  void Promise.all([ingestion.runOnce({ reason: 'manual' }), ingestion.runWeatherOnce()]).catch(error => {
    logger.error('Manual disaster refresh failed', { category: 'disaster_ingestion', metadata: { errorName: error.name } });
  });
  if (req.accepts(['html', 'json']) === 'json') return res.status(202).json({ ok: true, message: 'Source refresh started. Reload stored data shortly.' });
  return res.redirect(303, '/admin/disasters?status=success&message=Source%20refresh%20started.%20Reload%20stored%20data%20shortly.');
};

exports.mapAlert = mapAlert;
exports.mapWeatherSnapshot = mapWeatherSnapshot;
