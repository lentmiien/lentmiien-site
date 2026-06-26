const axios = require('axios');
const logger = require('../utils/logger');
const {
  DisasterAlert,
  DisasterIngestionState,
  DisasterWeatherObservation,
  DisasterWeatherSnapshot,
} = require('../database');
const {
  PARSER_VERSION,
  parseAtomFeed,
  parseJmaAlert,
  shindoScore,
} = require('../utils/disasterJmaParser');

const STATE_KEY = 'default';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_NEW_DETAILS_PER_RUN = 80;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const DEFAULT_LOCATION = {
  name: '横浜旭区',
  latitude: 35.4759,
  longitude: 139.5443,
};

const DEFAULT_JMA_FEEDS = [
  'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml',
  'https://www.data.jma.go.jp/developer/xml/feed/extra.xml',
  'https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml',
  'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml',
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateKeyInTokyo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIME_ZONE,
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

function startOfTokyoDate(date = new Date()) {
  return new Date(`${dateKeyInTokyo(date)}T00:00:00+09:00`);
}

function parseConfiguredStartDate(value) {
  if (!value) {
    return null;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+09:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getConfiguredJmaFeeds() {
  const configured = String(process.env.DISASTER_JMA_FEEDS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_JMA_FEEDS;
}

function getIntervalMs() {
  return parsePositiveInteger(process.env.DISASTER_POLL_INTERVAL_MS, DEFAULT_INTERVAL_MS);
}

function getLocationConfig() {
  return {
    name: process.env.DISASTER_WEATHER_LOCATION_NAME || DEFAULT_LOCATION.name,
    latitude: parseNumber(process.env.DISASTER_WEATHER_LATITUDE, DEFAULT_LOCATION.latitude),
    longitude: parseNumber(process.env.DISASTER_WEATHER_LONGITUDE, DEFAULT_LOCATION.longitude),
  };
}

function compactError(error) {
  if (!error) {
    return null;
  }
  return error.response?.data?.message || error.response?.data?.error || error.message || String(error);
}

function p2pDate(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().replace(/\//g, '-').replace(' ', 'T');
  const date = new Date(`${normalized}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function p2pScaleLabel(value) {
  const scale = Number.parseInt(value, 10);
  const labels = {
    10: '1',
    20: '2',
    30: '3',
    40: '4',
    45: '5-',
    50: '5+',
    55: '6-',
    60: '6+',
    70: '7',
  };
  return labels[scale] || (Number.isFinite(scale) && scale > 0 ? String(scale / 10) : '0');
}

function dateMinus(date, ms) {
  return new Date(date.getTime() - ms);
}

function datePlus(date, ms) {
  return new Date(date.getTime() + ms);
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function hourBucketStart(date = new Date()) {
  const bucket = new Date(date);
  bucket.setMinutes(0, 0, 0);
  return bucket;
}

function weatherCodeDescription(code) {
  const normalized = String(code);
  const descriptions = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Dense drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    80: 'Light showers',
    81: 'Showers',
    82: 'Violent showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm with hail',
  };
  return descriptions[normalized] || `Code ${normalized}`;
}

function buildForecastSummary(hourly) {
  if (!Array.isArray(hourly) || hourly.length === 0) {
    return 'No 24-hour forecast data is available.';
  }
  const temperatures = hourly.map((item) => item.temperatureC).filter(Number.isFinite);
  const precipitation = hourly.map((item) => item.precipitationMm).filter(Number.isFinite);
  const windGusts = hourly.map((item) => item.windGustMs).filter(Number.isFinite);
  const minTemp = temperatures.length ? Math.min(...temperatures) : null;
  const maxTemp = temperatures.length ? Math.max(...temperatures) : null;
  const totalRain = precipitation.length ? precipitation.reduce((sum, value) => sum + value, 0) : 0;
  const maxGust = windGusts.length ? Math.max(...windGusts) : null;
  const parts = [];

  if (minTemp !== null && maxTemp !== null) {
    parts.push(`${Math.round(minTemp)}-${Math.round(maxTemp)} C`);
  }
  if (totalRain > 0) {
    parts.push(`${totalRain.toFixed(totalRain >= 10 ? 0 : 1)} mm rain`);
  } else {
    parts.push('little rain expected');
  }
  if (maxGust !== null) {
    parts.push(`gusts up to ${maxGust.toFixed(1)} m/s`);
  }
  return parts.join(', ');
}

class DisasterIngestionService {
  constructor(options = {}) {
    this.http = options.httpClient || axios;
    this.logger = options.logger || logger;
    this.models = options.models || {
      DisasterAlert,
      DisasterIngestionState,
      DisasterWeatherObservation,
      DisasterWeatherSnapshot,
    };
    this.running = false;
  }

  async fetchText(url) {
    const timeout = parsePositiveInteger(process.env.DISASTER_HTTP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const response = await this.http.get(url, {
      timeout,
      responseType: 'text',
      headers: {
        'User-Agent': 'lentmiien-site disaster dashboard (+https://home.lentmiien.com)',
      },
    });
    return typeof response.data === 'string' ? response.data : String(response.data || '');
  }

  async fetchJson(url, options = {}) {
    const timeout = parsePositiveInteger(process.env.DISASTER_HTTP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const response = await this.http.get(url, {
      timeout,
      ...options,
      headers: {
        'User-Agent': 'lentmiien-site disaster dashboard (+https://home.lentmiien.com)',
        ...(options.headers || {}),
      },
    });
    return response.data;
  }

  async getState() {
    const existing = await this.models.DisasterIngestionState.findOne({ key: STATE_KEY });
    if (existing) {
      return existing;
    }

    const configuredStartAt = parseConfiguredStartDate(process.env.DISASTER_INGESTION_START_DATE);
    const startedAt = configuredStartAt || startOfTokyoDate(new Date());
    return this.models.DisasterIngestionState.findOneAndUpdate(
      { key: STATE_KEY },
      { $setOnInsert: { key: STATE_KEY, startedAt } },
      { upsert: true, new: true }
    );
  }

  async saveAlert(alertData) {
    try {
      const alert = await this.models.DisasterAlert.create(alertData);
      await this.verifyAlert(alert);
      return { inserted: true, alert };
    } catch (error) {
      if (error && error.code === 11000) {
        return { inserted: false, duplicate: true };
      }
      throw error;
    }
  }

  shouldRefreshExistingJmaAlert(alert) {
    return alert?.category === 'typhoon' && alert.parserVersion !== PARSER_VERSION;
  }

  async refreshExistingJmaAlert(existingAlert, parsedAlert) {
    const alert = await this.models.DisasterAlert.findByIdAndUpdate(
      existingAlert._id,
      { $set: parsedAlert },
      { new: true }
    );
    if (alert) {
      await this.verifyAlert(alert);
    }
    return alert;
  }

  async pollJmaFeed(feedUrl, state, runCounters) {
    const feedState = {
      url: feedUrl,
      title: null,
      lastCheckedAt: new Date(),
      lastUpdatedAt: null,
      lastStatus: 'ok',
      lastError: null,
      newEntries: 0,
    };

    try {
      const xmlText = await this.fetchText(feedUrl);
      const feed = parseAtomFeed(xmlText, feedUrl);
      feedState.title = feed.title;
      feedState.lastUpdatedAt = feed.updatedAt;
      const maxNewDetails = parsePositiveInteger(
        process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN,
        DEFAULT_MAX_NEW_DETAILS_PER_RUN
      );

      for (const entry of feed.entries) {
        if (entry.updatedAt && state.startedAt && entry.updatedAt < state.startedAt) {
          runCounters.skippedBeforeStart += 1;
          continue;
        }
        const sourceUrl = entry.url || entry.id;
        const dedupeKey = `jma:${sourceUrl}`;
        const existingAlert = await this.models.DisasterAlert.findOne({ dedupeKey })
          .select({ category: 1, parserVersion: 1 })
          .lean();
        if (existingAlert) {
          if (this.shouldRefreshExistingJmaAlert(existingAlert)) {
            if (runCounters.detailFetches >= maxNewDetails) {
              runCounters.deferred += 1;
              runCounters.duplicates += 1;
              continue;
            }
            const detailXml = await this.fetchText(sourceUrl);
            runCounters.detailFetches += 1;
            const parsedAlert = parseJmaAlert({ xmlText: detailXml, entry, feed });
            await this.refreshExistingJmaAlert(existingAlert, parsedAlert);
            runCounters.updated += 1;
            continue;
          }
          runCounters.duplicates += 1;
          continue;
        }
        if (runCounters.detailFetches >= maxNewDetails) {
          runCounters.deferred += 1;
          continue;
        }

        const detailXml = await this.fetchText(sourceUrl);
        runCounters.detailFetches += 1;
        const parsedAlert = parseJmaAlert({ xmlText: detailXml, entry, feed });
        const result = await this.saveAlert({
          ...parsedAlert,
          dedupeKey,
        });
        if (result.inserted) {
          feedState.newEntries += 1;
          runCounters.inserted += 1;
        } else {
          runCounters.duplicates += 1;
        }
      }
    } catch (error) {
      feedState.lastStatus = 'error';
      feedState.lastError = compactError(error);
      runCounters.feedErrors += 1;
      this.logger.warning('JMA disaster feed polling failed', {
        category: 'disaster_ingestion',
        metadata: { feedUrl, error: feedState.lastError },
      });
    }

    return feedState;
  }

  async pollJmaFeeds(state) {
    const counters = {
      inserted: 0,
      duplicates: 0,
      updated: 0,
      skippedBeforeStart: 0,
      detailFetches: 0,
      deferred: 0,
      feedErrors: 0,
    };
    const feeds = [];

    for (const feedUrl of getConfiguredJmaFeeds()) {
      feeds.push(await this.pollJmaFeed(feedUrl, state, counters));
    }

    return { feeds, counters };
  }

  earthquakeTime(alert) {
    return alert.earthquake?.originTime || alert.eventAt || alert.reportAt || alert.entryUpdatedAt || new Date();
  }

  async verifyP2pquake(alert) {
    try {
      const data = await this.fetchJson('https://api.p2pquake.net/v2/jma/quake', {
        params: { limit: 20 },
      });
      const eventAt = this.earthquakeTime(alert);
      const magnitude = alert.earthquake?.magnitude;
      const hypocenterName = alert.earthquake?.hypocenterName || '';
      const match = Array.isArray(data) ? data.find((entry) => {
        const entryTime = p2pDate(entry.earthquake?.time);
        if (!entryTime) return false;
        const timeDiffMs = Math.abs(entryTime.getTime() - eventAt.getTime());
        const magDiff = Math.abs((entry.earthquake?.hypocenter?.magnitude || 0) - (magnitude || 0));
        const name = entry.earthquake?.hypocenter?.name || '';
        return timeDiffMs <= 20 * 60 * 1000
          && (magnitude === null || magnitude === undefined || magDiff <= 0.5)
          && (!hypocenterName || name.includes(hypocenterName) || hypocenterName.includes(name));
      }) : null;

      return {
        source: 'p2pquake',
        status: 'ok',
        matched: Boolean(match),
        confidence: match ? 0.9 : 0.25,
        note: match ? `Matched P2Pquake event ${match.id}.` : 'No matching recent P2Pquake event found.',
        raw: match ? {
          id: match.id,
          issueTime: match.issue?.time,
          hypocenter: match.earthquake?.hypocenter,
          maxScale: match.earthquake?.maxScale,
        } : { checked: Array.isArray(data) ? data.length : 0 },
      };
    } catch (error) {
      return {
        source: 'p2pquake',
        status: 'error',
        matched: false,
        confidence: 0,
        note: compactError(error),
        raw: {},
      };
    }
  }

  async verifyUsgs(alert) {
    try {
      const eventAt = this.earthquakeTime(alert);
      const magnitude = alert.earthquake?.magnitude || 0;
      const params = {
        format: 'geojson',
        starttime: dateMinus(eventAt, 3 * 60 * 60 * 1000).toISOString(),
        endtime: datePlus(eventAt, 3 * 60 * 60 * 1000).toISOString(),
        minmagnitude: Math.max(0, magnitude - 1.5),
        orderby: 'time',
        limit: 10,
      };
      if (Number.isFinite(alert.earthquake?.latitude) && Number.isFinite(alert.earthquake?.longitude)) {
        params.latitude = alert.earthquake.latitude;
        params.longitude = alert.earthquake.longitude;
        params.maxradiuskm = 350;
      } else {
        params.minlatitude = 20;
        params.maxlatitude = 50;
        params.minlongitude = 120;
        params.maxlongitude = 155;
      }

      const data = await this.fetchJson('https://earthquake.usgs.gov/fdsnws/event/1/query', { params });
      const features = Array.isArray(data?.features) ? data.features : [];
      const match = features.find((feature) => {
        const featureTime = new Date(feature.properties?.time || 0);
        const timeDiffMs = Math.abs(featureTime.getTime() - eventAt.getTime());
        const magDiff = Math.abs((feature.properties?.mag || 0) - magnitude);
        return timeDiffMs <= 3 * 60 * 60 * 1000 && (!magnitude || magDiff <= 1.7);
      });

      return {
        source: 'usgs',
        status: 'ok',
        matched: Boolean(match),
        confidence: match ? 0.75 : 0.2,
        note: match ? `Matched USGS event ${match.id}.` : 'No nearby USGS event in the verification window.',
        raw: match ? {
          id: match.id,
          title: match.properties?.title,
          mag: match.properties?.mag,
          place: match.properties?.place,
          url: match.properties?.url,
          coordinates: match.geometry?.coordinates,
        } : { checked: features.length },
      };
    } catch (error) {
      return {
        source: 'usgs',
        status: 'error',
        matched: false,
        confidence: 0,
        note: compactError(error),
        raw: {},
      };
    }
  }

  async verifyEonetTyphoon(alert) {
    try {
      const data = await this.fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events', {
        params: { category: 'severeStorms', status: 'open', limit: 20 },
      });
      const events = Array.isArray(data?.events) ? data.events : [];
      const typhoonName = String(alert.typhoon?.name || '').toLowerCase();
      const match = typhoonName
        ? events.find((event) => String(event.title || '').toLowerCase().includes(typhoonName))
        : null;

      return {
        source: 'nasa-eonet',
        status: 'ok',
        matched: Boolean(match),
        confidence: match ? 0.75 : 0.25,
        note: match ? `Matched EONET storm ${match.title}.` : 'No matching open EONET severe-storm event found.',
        raw: match ? {
          id: match.id,
          title: match.title,
          link: match.link,
          latestGeometry: Array.isArray(match.geometry) ? match.geometry[match.geometry.length - 1] : null,
        } : { checked: events.length },
      };
    } catch (error) {
      return {
        source: 'nasa-eonet',
        status: 'error',
        matched: false,
        confidence: 0,
        note: compactError(error),
        raw: {},
      };
    }
  }

  async verifyGdacsTyphoon(alert) {
    try {
      const eventAt = alert.eventAt || new Date();
      const params = {
        eventlist: 'TC',
        fromdate: dateOnly(dateMinus(eventAt, 14 * 24 * 60 * 60 * 1000)),
        todate: dateOnly(datePlus(new Date(), 24 * 60 * 60 * 1000)),
      };
      const data = await this.fetchJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH', {
        params,
        headers: { Accept: 'application/json' },
      });
      const features = Array.isArray(data?.features) ? data.features : [];
      const typhoonName = String(alert.typhoon?.name || '').toLowerCase();
      const match = typhoonName
        ? features.find((feature) => {
          const properties = feature.properties || {};
          return [properties.name, properties.eventname, properties.description]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(typhoonName));
        })
        : null;

      return {
        source: 'gdacs',
        status: 'ok',
        matched: Boolean(match),
        confidence: match ? 0.7 : 0.2,
        note: match ? 'Matched GDACS tropical cyclone event.' : 'No matching GDACS tropical cyclone event found.',
        raw: match ? {
          eventid: match.properties?.eventid,
          name: match.properties?.name || match.properties?.eventname,
          alertlevel: match.properties?.alertlevel,
          url: match.properties?.url,
        } : { checked: features.length },
      };
    } catch (error) {
      return {
        source: 'gdacs',
        status: 'error',
        matched: false,
        confidence: 0,
        note: compactError(error),
        raw: {},
      };
    }
  }

  calculateConfidence(alert, verifications) {
    const base = alert.source === 'jma' ? 0.72 : 0.5;
    const matched = verifications.filter((verification) => verification.matched).length;
    const errored = verifications.filter((verification) => verification.status === 'error').length;
    return Math.max(0.1, Math.min(0.98, base + (matched * 0.12) - (errored * 0.05)));
  }

  async verifyAlert(alert) {
    const verifications = [];
    if (alert.source === 'jma' && alert.category === 'earthquake') {
      verifications.push(await this.verifyP2pquake(alert));
      verifications.push(await this.verifyUsgs(alert));
    } else if (alert.source === 'jma' && alert.category === 'typhoon') {
      verifications.push(await this.verifyEonetTyphoon(alert));
      verifications.push(await this.verifyGdacsTyphoon(alert));
    }

    if (verifications.length === 0) {
      return alert;
    }

    alert.verifications = verifications;
    alert.confidence = this.calculateConfidence(alert, verifications);
    await alert.save();
    return alert;
  }

  async ingestP2pquakeFallback(state) {
    const data = await this.fetchJson('https://api.p2pquake.net/v2/jma/quake', {
      params: { limit: 20 },
    });
    if (!Array.isArray(data)) {
      return 0;
    }
    let inserted = 0;
    for (const entry of data) {
      const eventAt = p2pDate(entry.earthquake?.time) || p2pDate(entry.issue?.time);
      if (eventAt && state.startedAt && eventAt < state.startedAt) {
        continue;
      }
      const hypocenter = entry.earthquake?.hypocenter || {};
      const alertData = {
        dedupeKey: `p2pquake:${entry.id}`,
        source: 'p2pquake',
        sourceId: entry.id,
        sourceUrl: `https://api.p2pquake.net/v2/jma/quake/${entry.id}`,
        category: 'earthquake',
        severity: shindoScore(p2pScaleLabel(entry.earthquake?.maxScale)) >= 5 ? 'warning' : 'advisory',
        severityScore: shindoScore(p2pScaleLabel(entry.earthquake?.maxScale)) >= 5 ? 4 : 2,
        confidence: 0.58,
        title: `Earthquake: ${hypocenter.name || 'Japan region'}`,
        headline: entry.comments?.freeFormComment || null,
        summary: `${hypocenter.name || 'Japan region'} M${hypocenter.magnitude || '?'} depth ${hypocenter.depth || '?'}km`,
        infoKind: 'P2Pquake JMA earthquake',
        eventId: entry.id,
        reportAt: p2pDate(entry.issue?.time),
        eventAt,
        entryUpdatedAt: p2pDate(entry.time),
        earthquake: {
          originTime: eventAt,
          arrivalTime: eventAt,
          hypocenterName: hypocenter.name || null,
          latitude: hypocenter.latitude || null,
          longitude: hypocenter.longitude || null,
          depthKm: hypocenter.depth || null,
          magnitude: hypocenter.magnitude || null,
          maxIntensity: p2pScaleLabel(entry.earthquake?.maxScale),
          maxIntensityLabel: p2pScaleLabel(entry.earthquake?.maxScale),
          yokohamaAsahiIntensity: '0',
          yokohamaAsahiIntensityLabel: '0',
          tsunamiComment: entry.earthquake?.domesticTsunami || null,
        },
        areas: Array.isArray(entry.points)
          ? entry.points.slice(0, 80).map((point) => ({
            name: point.addr || null,
            prefecture: point.pref || null,
            maxIntensity: p2pScaleLabel(point.scale),
          }))
          : [],
        verifications: [{
          source: 'p2pquake',
          status: 'fallback',
          matched: true,
          confidence: 0.58,
          note: 'Saved from P2Pquake because JMA polling was unavailable.',
          raw: { issue: entry.issue, code: entry.code },
        }],
        raw: entry,
      };
      const result = await this.saveAlert(alertData);
      if (result.inserted) inserted += 1;
    }
    return inserted;
  }

  async ingestUsgsFallback(state) {
    const params = {
      format: 'geojson',
      starttime: state.startedAt.toISOString(),
      minmagnitude: 3,
      minlatitude: 20,
      maxlatitude: 50,
      minlongitude: 120,
      maxlongitude: 155,
      orderby: 'time',
      limit: 20,
    };
    const data = await this.fetchJson('https://earthquake.usgs.gov/fdsnws/event/1/query', { params });
    const features = Array.isArray(data?.features) ? data.features : [];
    let inserted = 0;
    for (const feature of features) {
      const properties = feature.properties || {};
      const coordinates = feature.geometry?.coordinates || [];
      const eventAt = properties.time ? new Date(properties.time) : null;
      const alertData = {
        dedupeKey: `usgs:${feature.id}`,
        source: 'usgs',
        sourceId: feature.id,
        sourceUrl: properties.url || null,
        category: 'earthquake',
        severity: properties.mag >= 6 ? 'warning' : 'advisory',
        severityScore: properties.mag >= 6 ? 4 : 2,
        confidence: 0.5,
        title: properties.title || `USGS earthquake ${feature.id}`,
        headline: properties.place || null,
        summary: properties.title || properties.place || null,
        infoKind: 'USGS earthquake',
        eventId: feature.id,
        reportAt: properties.updated ? new Date(properties.updated) : null,
        eventAt,
        entryUpdatedAt: properties.updated ? new Date(properties.updated) : null,
        earthquake: {
          originTime: eventAt,
          hypocenterName: properties.place || null,
          latitude: Number.isFinite(coordinates[1]) ? coordinates[1] : null,
          longitude: Number.isFinite(coordinates[0]) ? coordinates[0] : null,
          depthKm: Number.isFinite(coordinates[2]) ? coordinates[2] : null,
          magnitude: properties.mag || null,
          magnitudeType: properties.magType || null,
          yokohamaAsahiIntensity: '0',
          yokohamaAsahiIntensityLabel: '0',
        },
        verifications: [{
          source: 'usgs',
          status: 'fallback',
          matched: true,
          confidence: 0.5,
          note: 'Saved from USGS because JMA polling was unavailable.',
          raw: { id: feature.id, net: properties.net, alert: properties.alert },
        }],
        raw: feature,
      };
      const result = await this.saveAlert(alertData);
      if (result.inserted) inserted += 1;
    }
    return inserted;
  }

  async ingestEonetFallback(state) {
    const data = await this.fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events', {
      params: { category: 'severeStorms', status: 'open', limit: 20 },
    });
    const events = Array.isArray(data?.events) ? data.events : [];
    let inserted = 0;
    for (const event of events) {
      const latestGeometry = Array.isArray(event.geometry) ? event.geometry[event.geometry.length - 1] : null;
      const eventAt = latestGeometry?.date ? new Date(latestGeometry.date) : new Date();
      if (eventAt && state.startedAt && eventAt < state.startedAt) {
        continue;
      }
      const isTyphoon = /typhoon|tropical storm|cyclone/i.test(event.title || '');
      const alertData = {
        dedupeKey: `eonet:${event.id}`,
        source: 'nasa-eonet',
        sourceId: event.id,
        sourceUrl: event.link || null,
        category: isTyphoon ? 'typhoon' : 'extreme_weather',
        severity: 'watch',
        severityScore: 3,
        confidence: 0.45,
        title: event.title || `EONET event ${event.id}`,
        headline: event.description || null,
        summary: event.title || null,
        infoKind: 'NASA EONET severe storm',
        eventId: event.id,
        reportAt: eventAt,
        eventAt,
        typhoon: isTyphoon ? {
          name: String(event.title || '').replace(/^(Typhoon|Tropical Storm|Cyclone)\s+/i, '').trim() || null,
          track: Array.isArray(event.geometry) ? event.geometry.slice(-30) : [],
        } : {},
        verifications: [{
          source: 'nasa-eonet',
          status: 'fallback',
          matched: true,
          confidence: 0.45,
          note: 'Saved from EONET because JMA polling was unavailable.',
          raw: { sources: event.sources, categories: event.categories },
        }],
        raw: event,
      };
      const result = await this.saveAlert(alertData);
      if (result.inserted) inserted += 1;
    }
    return inserted;
  }

  async ingestBackupSources(state) {
    const counters = {
      p2pquake: 0,
      usgs: 0,
      eonet: 0,
      errors: 0,
    };

    for (const [key, runner] of [
      ['p2pquake', () => this.ingestP2pquakeFallback(state)],
      ['usgs', () => this.ingestUsgsFallback(state)],
      ['eonet', () => this.ingestEonetFallback(state)],
    ]) {
      try {
        counters[key] = await runner();
      } catch (error) {
        counters.errors += 1;
        this.logger.warning('Disaster backup source failed', {
          category: 'disaster_ingestion',
          metadata: { source: key, error: compactError(error) },
        });
      }
    }

    return counters;
  }

  parseOpenWeatherForecast(data, location) {
    const now = Date.now();
    const cutoff = now + 24 * 60 * 60 * 1000;
    const hourly = (Array.isArray(data?.list) ? data.list : [])
      .map((entry) => ({
        time: entry.dt ? new Date(entry.dt * 1000) : null,
        temperatureC: entry.main?.temp ?? null,
        feelsLikeC: entry.main?.feels_like ?? null,
        precipitationMm: entry.rain?.['3h'] || entry.snow?.['3h'] || 0,
        precipitationProbability: Number.isFinite(entry.pop) ? Math.round(entry.pop * 100) : null,
        windSpeedMs: entry.wind?.speed ?? null,
        windGustMs: entry.wind?.gust ?? null,
        humidityPercent: entry.main?.humidity ?? null,
        pressureHpa: entry.main?.pressure ?? null,
        weatherCode: entry.weather?.[0]?.id ? String(entry.weather[0].id) : null,
        description: entry.weather?.[0]?.description || null,
      }))
      .filter((entry) => entry.time && entry.time.getTime() >= now - 4 * 60 * 60 * 1000 && entry.time.getTime() <= cutoff)
      .slice(0, 10);

    return {
      source: 'openweathermap',
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      fetchedAt: new Date(),
      forecastStartAt: hourly[0]?.time || null,
      forecastEndAt: hourly[hourly.length - 1]?.time || null,
      summary: buildForecastSummary(hourly),
      current: {
        cityName: data?.city?.name || location.name,
        country: data?.city?.country || null,
      },
      hourly,
      raw: data,
    };
  }

  parseOpenWeatherObservation(data, location) {
    const observedAt = data?.dt ? new Date(data.dt * 1000) : new Date();
    return {
      source: 'openweathermap-current',
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      observedAt,
      temperatureC: data?.main?.temp ?? null,
      feelsLikeC: data?.main?.feels_like ?? null,
      precipitationMm: data?.rain?.['1h'] || data?.snow?.['1h'] || 0,
      precipitationProbability: null,
      windSpeedMs: data?.wind?.speed ?? null,
      windGustMs: data?.wind?.gust ?? null,
      humidityPercent: data?.main?.humidity ?? null,
      pressureHpa: data?.main?.pressure ?? null,
      weatherCode: data?.weather?.[0]?.id ? String(data.weather[0].id) : null,
      description: data?.weather?.[0]?.description || null,
      raw: data || {},
    };
  }

  parseOpenMeteoForecast(data, location) {
    const now = Date.now();
    const cutoff = now + 24 * 60 * 60 * 1000;
    const hourlyData = data?.hourly || {};
    const times = Array.isArray(hourlyData.time) ? hourlyData.time : [];
    const hourly = times.map((time, index) => {
      const parsedTime = new Date(`${time}+09:00`);
      return {
        time: parsedTime,
        temperatureC: hourlyData.temperature_2m?.[index] ?? null,
        feelsLikeC: null,
        precipitationMm: hourlyData.precipitation?.[index] ?? null,
        precipitationProbability: hourlyData.precipitation_probability?.[index] ?? null,
        windSpeedMs: Number.isFinite(hourlyData.wind_speed_10m?.[index])
          ? hourlyData.wind_speed_10m[index] / 3.6
          : null,
        windGustMs: Number.isFinite(hourlyData.wind_gusts_10m?.[index])
          ? hourlyData.wind_gusts_10m[index] / 3.6
          : null,
        humidityPercent: hourlyData.relative_humidity_2m?.[index] ?? null,
        pressureHpa: hourlyData.surface_pressure?.[index] ?? null,
        weatherCode: hourlyData.weather_code?.[index] !== undefined ? String(hourlyData.weather_code[index]) : null,
        description: hourlyData.weather_code?.[index] !== undefined
          ? weatherCodeDescription(hourlyData.weather_code[index])
          : null,
      };
    }).filter((entry) => (
      entry.time
      && !Number.isNaN(entry.time.getTime())
      && entry.time.getTime() >= now - 60 * 60 * 1000
      && entry.time.getTime() <= cutoff
    )).slice(0, 24);

    return {
      source: 'open-meteo-jma',
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      fetchedAt: new Date(),
      forecastStartAt: hourly[0]?.time || null,
      forecastEndAt: hourly[hourly.length - 1]?.time || null,
      summary: buildForecastSummary(hourly),
      current: {
        timezone: data?.timezone || DEFAULT_TIME_ZONE,
        elevation: data?.elevation || null,
      },
      hourly,
      raw: data,
    };
  }

  buildObservationFromSnapshot(snapshot) {
    const hourly = Array.isArray(snapshot?.hourly) ? snapshot.hourly : [];
    const now = Date.now();
    const closest = hourly.reduce((best, entry) => {
      if (!entry?.time) return best;
      const entryTime = new Date(entry.time);
      if (Number.isNaN(entryTime.getTime())) return best;
      const distance = Math.abs(entryTime.getTime() - now);
      if (!best || distance < best.distance) {
        return { entry, distance };
      }
      return best;
    }, null)?.entry;

    if (!closest) {
      return null;
    }

    return {
      source: `${snapshot.source}-hourly`,
      locationName: snapshot.locationName,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      observedAt: new Date(closest.time),
      temperatureC: closest.temperatureC ?? null,
      feelsLikeC: closest.feelsLikeC ?? null,
      precipitationMm: closest.precipitationMm ?? null,
      precipitationProbability: closest.precipitationProbability ?? null,
      windSpeedMs: closest.windSpeedMs ?? null,
      windGustMs: closest.windGustMs ?? null,
      humidityPercent: closest.humidityPercent ?? null,
      pressureHpa: closest.pressureHpa ?? null,
      weatherCode: closest.weatherCode || null,
      description: closest.description || null,
      raw: {
        snapshotId: snapshot._id ? String(snapshot._id) : null,
        entry: closest,
      },
    };
  }

  async saveWeatherObservation(observation) {
    if (!observation || !observation.observedAt) {
      return null;
    }
    const bucketStartAt = hourBucketStart(observation.observedAt);
    const observationKey = `${observation.locationName}:${bucketStartAt.toISOString()}`;
    const summary = buildForecastSummary([observation]);

    return this.models.DisasterWeatherObservation.findOneAndUpdate(
      { observationKey },
      {
        $setOnInsert: {
          ...observation,
          observationKey,
          bucketStartAt,
          summary,
        },
      },
      { upsert: true, new: true }
    );
  }

  async refreshWeatherObservation(location, snapshot = null) {
    if (process.env.DISASTER_WEATHER_ENABLED === 'false') {
      return null;
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (apiKey) {
      try {
        const data = await this.fetchJson('https://api.openweathermap.org/data/2.5/weather', {
          params: {
            lat: location.latitude,
            lon: location.longitude,
            appid: apiKey,
            units: 'metric',
            lang: process.env.DISASTER_WEATHER_LANG || 'en',
          },
        });
        return this.saveWeatherObservation(this.parseOpenWeatherObservation(data, location));
      } catch (error) {
        this.logger.warning('OpenWeather current weather refresh failed, using forecast fallback', {
          category: 'disaster_ingestion',
          metadata: { error: compactError(error) },
        });
      }
    }

    return this.saveWeatherObservation(this.buildObservationFromSnapshot(snapshot));
  }

  async refreshWeatherSnapshot() {
    if (process.env.DISASTER_WEATHER_ENABLED === 'false') {
      return null;
    }
    const location = getLocationConfig();
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const preferOneCall = process.env.OPENWEATHER_USE_ONECALL === 'true';

    if (apiKey) {
      try {
        if (preferOneCall) {
          const data = await this.fetchJson('https://api.openweathermap.org/data/3.0/onecall', {
            params: {
              lat: location.latitude,
              lon: location.longitude,
              appid: apiKey,
              units: 'metric',
              exclude: 'minutely,daily,alerts',
            },
          });
          const hourly = (Array.isArray(data?.hourly) ? data.hourly : []).slice(0, 24).map((entry) => ({
            time: entry.dt ? new Date(entry.dt * 1000) : null,
            temperatureC: entry.temp ?? null,
            feelsLikeC: entry.feels_like ?? null,
            precipitationMm: entry.rain?.['1h'] || entry.snow?.['1h'] || 0,
            precipitationProbability: Number.isFinite(entry.pop) ? Math.round(entry.pop * 100) : null,
            windSpeedMs: entry.wind_speed ?? null,
            windGustMs: entry.wind_gust ?? null,
            humidityPercent: entry.humidity ?? null,
            pressureHpa: entry.pressure ?? null,
            weatherCode: entry.weather?.[0]?.id ? String(entry.weather[0].id) : null,
            description: entry.weather?.[0]?.description || null,
          })).filter((entry) => entry.time);
          const snapshot = await this.models.DisasterWeatherSnapshot.create({
            source: 'openweathermap-onecall',
            locationName: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            fetchedAt: new Date(),
            forecastStartAt: hourly[0]?.time || null,
            forecastEndAt: hourly[hourly.length - 1]?.time || null,
            summary: buildForecastSummary(hourly),
            current: data?.current || {},
            hourly,
            raw: data,
          });
          await this.saveWeatherObservation({
            source: 'openweathermap-onecall-current',
            locationName: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            observedAt: data?.current?.dt ? new Date(data.current.dt * 1000) : new Date(),
            temperatureC: data?.current?.temp ?? null,
            feelsLikeC: data?.current?.feels_like ?? null,
            precipitationMm: data?.current?.rain?.['1h'] || data?.current?.snow?.['1h'] || 0,
            windSpeedMs: data?.current?.wind_speed ?? null,
            windGustMs: data?.current?.wind_gust ?? null,
            humidityPercent: data?.current?.humidity ?? null,
            pressureHpa: data?.current?.pressure ?? null,
            weatherCode: data?.current?.weather?.[0]?.id ? String(data.current.weather[0].id) : null,
            description: data?.current?.weather?.[0]?.description || null,
            raw: data?.current || {},
          });
          return snapshot;
        }

        const data = await this.fetchJson('https://api.openweathermap.org/data/2.5/forecast', {
          params: {
            lat: location.latitude,
            lon: location.longitude,
            appid: apiKey,
            units: 'metric',
            lang: process.env.DISASTER_WEATHER_LANG || 'en',
          },
        });
        const snapshot = await this.models.DisasterWeatherSnapshot.create(this.parseOpenWeatherForecast(data, location));
        await this.refreshWeatherObservation(location, snapshot);
        return snapshot;
      } catch (error) {
        this.logger.warning('OpenWeather forecast refresh failed, trying Open-Meteo fallback', {
          category: 'disaster_ingestion',
          metadata: { error: compactError(error) },
        });
      }
    }

    const data = await this.fetchJson('https://api.open-meteo.com/v1/jma', {
      params: {
        latitude: location.latitude,
        longitude: location.longitude,
        hourly: [
          'temperature_2m',
          'relative_humidity_2m',
          'precipitation',
          'precipitation_probability',
          'weather_code',
          'wind_speed_10m',
          'wind_gusts_10m',
          'surface_pressure',
        ].join(','),
        forecast_days: 2,
        timezone: DEFAULT_TIME_ZONE,
      },
    });
    const snapshot = await this.models.DisasterWeatherSnapshot.create(this.parseOpenMeteoForecast(data, location));
    await this.refreshWeatherObservation(location, snapshot);
    return snapshot;
  }

  async runOnce(options = {}) {
    if (this.running) {
      return { status: 'skipped', reason: 'already-running' };
    }

    this.running = true;
    const state = await this.getState();
    state.running = true;
    state.lastRunAt = new Date();
    await state.save();

    try {
      const jmaResult = await this.pollJmaFeeds(state);
      let backupCounters = null;
      if (jmaResult.counters.feedErrors === getConfiguredJmaFeeds().length) {
        backupCounters = await this.ingestBackupSources(state);
      }

      let weatherSnapshotId = null;
      let weatherObservationId = null;
      try {
        const weatherSnapshot = await this.refreshWeatherSnapshot();
        weatherSnapshotId = weatherSnapshot?._id ? String(weatherSnapshot._id) : null;
        const latestObservation = weatherSnapshotId
          ? await this.models.DisasterWeatherObservation.findOne({}).sort({ bucketStartAt: -1 })
          : null;
        weatherObservationId = latestObservation?._id ? String(latestObservation._id) : null;
      } catch (error) {
        this.logger.warning('Disaster weather snapshot refresh failed', {
          category: 'disaster_ingestion',
          metadata: { error: compactError(error) },
        });
      }

      state.running = false;
      state.lastSuccessAt = new Date();
      state.lastError = null;
      state.feeds = jmaResult.feeds;
      state.counters = {
        reason: options.reason || 'scheduled',
        ...jmaResult.counters,
        backup: backupCounters,
        weatherSnapshotId,
        weatherObservationId,
      };
      await state.save();

      return {
        status: 'ok',
        ...state.counters,
      };
    } catch (error) {
      state.running = false;
      state.lastErrorAt = new Date();
      state.lastError = compactError(error);
      await state.save();
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = new DisasterIngestionService();
module.exports.DisasterIngestionService = DisasterIngestionService;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
module.exports.getIntervalMs = getIntervalMs;
module.exports.startOfTokyoDate = startOfTokyoDate;
