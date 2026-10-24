const { createHash } = require('crypto');
const { LOCALITY, locationConfig, locationKey } = require('../utils/disasterLocality');
const { warningEvidence, earthquakeEvidence, typhoonEvidence, INTENSITIES, productOf, date } = require('../utils/disasterLocalEvidence');
const { artwork, weatherCondition, shaking } = require('../utils/disasterArtwork');
const logger = require('../utils/logger');
const VERSION = 'local-v3';
const SLOTS = ['weather', 'estimate', 'warnings', 'earthquake', 'typhoon', 'health'];
const key = (slot, location = locationConfig()) => `${VERSION}:${locationKey(location)}:${slot}`;
const ids = () => SLOTS.map(slot => key(slot));
const projection = '_id data';
const millis = value => date(value)?.getTime() || 0;
const order = (at, control = at, serial = 0, correction = false) => [millis(at), millis(control), Number(serial) || 0, correction ? 1 : 0].map(n => String(n).padStart(16, '0')).join(':');
function freshness(at, now, age) {
  const elapsed = +now - millis(at);
  return !millis(at) ? 'unavailable' : elapsed < -300000 || elapsed > age ? 'stale' : 'fresh';
}
const stamp = value => date(value)?.toISOString() || null;
function weatherData(observation) {
  const fields = ['temperatureC', 'feelsLikeC', 'precipitationMm', 'windSpeedMs', 'humidityPercent'];
  return { ...Object.fromEntries(fields.map(f => [f, Number.isFinite(observation[f]) ? observation[f] : null])),
    observedAt: date(observation.observedAt), receivedAt: date(observation.receivedAt || observation.updatedAt || observation.observedAt), source: String(observation.source || '').slice(0, 60),
    description: String(observation.description || 'Condition unavailable').slice(0, 120),
    weatherCode: observation.weatherCode, isDay: typeof observation.isDay === 'boolean' ? observation.isDay : null,
    estimated: /hourly|forecast/.test(observation.source || ''),
    precipitationPeriodHours: observation.precipitationPeriodHours || (/openweathermap.*hourly/.test(observation.source || '') ? 3 : 1) };
}
function buildSummary(records, now = new Date()) {
  const get = slot => records.find(r => r._id === key(slot))?.data;
  const measured = get('weather');
  const estimate = get('estimate');
  const estimateFresh = estimate && Math.abs(+now - millis(estimate.observedAt)) <= 90 * 60000 && freshness(estimate.receivedAt, now, 60 * 60000) === 'fresh';
  const rawWeather = freshness(measured?.observedAt, now, 60 * 60000) === 'fresh' ? measured : estimateFresh ? estimate : measured || estimate;
  const wf = rawWeather?.estimated ? estimateFresh ? 'fresh' : 'stale' : freshness(rawWeather?.observedAt, now, 60 * 60000);
  const weather = { ...(rawWeather || {}), observedAt: stamp(rawWeather?.observedAt), freshness: wf,
    label: !rawWeather ? 'Current weather unavailable' : wf !== 'fresh' ? 'Last-known weather · stale' : rawWeather.estimated ? 'Forecast estimate' : 'Current weather',
    art: artwork('weather', wf === 'stale' ? 'stale' : weatherCondition(rawWeather?.source, rawWeather?.weatherCode, rawWeather?.isDay)) };
  const evidence = get('warnings');
  const health = get('health');
  const warningFreshness = freshness(evidence?.at, now, 6 * 3600000);
  const sourceFresh = health?.ok === true && freshness(health.at, now, 45 * 60000) === 'fresh';
  const known = evidence?.coverage && warningFreshness === 'fresh' && sourceFresh;
  const hazards = (evidence?.hazards || []).filter(h => h.active);
  const warnings = { state: known ? hazards.length ? 'active' : 'clear' : evidence ? 'stale' : 'unavailable',
    label: known ? hazards.length ? 'Local warnings & advisories' : 'No local warnings or advisories' : 'Local warning status unavailable',
    at: stamp(evidence?.at), area: LOCALITY.warningName, active: known ? hazards : [], history: known ? [] : hazards,
    note: known ? 'JMA municipality coverage for Asahi-ku. Follow official safety instructions.' : 'Fresh authoritative local coverage is not available. This is not an all-clear.' };
  const eq = get('earthquake');
  const local = eq?.intensity ?? null;
  const earthquake = { ...(eq || {}), at: stamp(eq?.at), intensity: local,
    label: local === null ? 'Local shaking unknown' : `Local intensity ${local.replace('-', '−')}`,
    description: local === null ? 'No measured intensity for Asahi-ku in this report.' : shaking[INTENSITIES.indexOf(local)],
    art: artwork('earthquake', local || 'unknown'), historical: freshness(eq?.at, now, 24 * 3600000) !== 'fresh' };
  const ty = get('typhoon');
  const tyFresh = ty && millis(ty.validUntil) >= +now && freshness(ty.at, now, 24 * 3600000) === 'fresh';
  let tyState = tyFresh ? ty.state : 'unknown';
  if (tyFresh && tyState !== 'unknown' && known) {
    const wind = hazards.filter(h => /暴風|強風/.test(h.name));
    const strongest = ['emergency', 'warning', 'advisory'].find(s => wind.some(h => h.severity === s));
    if (strongest) tyState = strongest;
  }
  const typhoon = { ...(ty || {}), at: stamp(ty?.at), state: tyState, art: artwork('typhoon', tyState),
    label: ['emergency', 'warning', 'advisory'].includes(tyState) ? `Local wind ${tyState} · typhoon context` : tyState === 'probability' ? 'Local storm-wind probability' : tyState === 'proximity' ? 'Storm track nearby · impact unknown' : 'Local typhoon impact unknown',
    note: 'Proximity and wind probability are not local warning levels. See the local warnings above.' };
  return { location: LOCALITY.name, weather, warnings, earthquake, typhoon,
    state: wf === 'fresh' && known ? 'ready' : rawWeather || evidence ? 'stale' : 'unavailable',
    fetchedAt: now.toISOString(), sourceCheckedAt: stamp(health?.at) };
}
function createLocalSummaryService({ model = require('../models/disaster_local_summary'), now = () => new Date() } = {}) {
  async function put(slot, data, revision, location = locationConfig()) {
    const id = key(slot, location);
    const signatureData = { ...data }; delete signatureData.product;
    const signature = createHash('sha256').update(JSON.stringify(signatureData)).digest('hex');
    try {
      await model.updateOne({ _id: id, $or: [{ order: { $lt: revision } }, { order: revision, signature }] },
        { $set: { order: revision, signature, data } }, { upsert: true, maxTimeMS: 2000 });
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Equal-revision conflicting variants fail closed; old events cannot overwrite newer ones.
      if (slot === 'warnings') await model.updateOne({ _id: id, order: revision, signature: { $ne: signature } },
        { $set: { 'data.coverage': false, signature: 'conflict' } }, { maxTimeMS: 2000 });
    }
  }
  async function ingestAlert(alert) {
    const revision = order(alert.reportAt, alert.controlAt || alert.reportAt, alert.serial, /訂正|取消/.test(alert.infoType || ''));
    let warning = warningEvidence(alert);
    if (!warning && ['VPWW53', 'VPWW54'].includes(productOf(alert)) && /取消|訂正/.test(alert.infoType || '') && alert.eventId) {
      const current = await model.findById(key('warnings')).select('data').maxTimeMS(1500).lean();
      if (current?.data?.eventId === alert.eventId) warning = { ...current.data, at: date(alert.reportAt), coverage: false };
    }
    for (const [slot, data] of [['warnings', warning], ['earthquake', earthquakeEvidence(alert)], ['typhoon', typhoonEvidence(alert, now())]]) {
      if (slot === 'typhoon' && data && !data.relevant) {
        const current = await model.findById(key(slot)).select('data.eventId').maxTimeMS(1500).lean();
        if (!data.eventId || current?.data?.eventId !== data.eventId) continue;
      }
      if (slot === 'earthquake' && data?.intensity === null) {
        // Remote earthquakes do not displace the most recent measured local event.
        // A correction/retraction of that event can explicitly make it unknown.
        if (!data.eventId || !/訂正|取消/.test(alert.infoType || '')) continue;
        const current = await model.findById(key(slot)).select('data.eventId').maxTimeMS(1500).lean();
        if (current?.data?.eventId !== data.eventId) continue;
      }
      if (data) await put(slot, data, slot === 'earthquake' ? `${String(millis(data.at)).padStart(16, '0')}:${revision}` : revision);
    }
  }
  async function saveWeather(observation) {
    if (!date(observation?.observedAt)) return;
    await put(/hourly|forecast/.test(observation.source || '') ? 'estimate' : 'weather', weatherData(observation), order(observation.observedAt, observation.receivedAt || observation.updatedAt || observation.observedAt), { name: observation.locationName, latitude: observation.latitude, longitude: observation.longitude });
  }
  async function health(ok, counters = {}) {
    const at = now();
    const diagnostics = Object.fromEntries(['warningPending', 'warningFeedErrors', 'warningFeedsPresent',
      'warningPendingOverflow', 'deferred', 'detailErrors'].map(name => [name, counters[name] ?? null]));
    await put('health', { ok, at: date(counters.warningCheckedAt) || at, ...diagnostics }, order(at));
  }
  async function read() {
    const records = await model.find({ _id: { $in: ids() } }).select(projection).limit(6).maxTimeMS(1500).lean().exec();
    return buildSummary(records, now());
  }
  async function bootstrap(models) {
    const marker = key('bootstrap');
    if (await model.findById(marker).select('_id').maxTimeMS(1500).lean()) return;
    const since = new Date(+now() - 72 * 3600000);
    let capped = false;
    // Existing category/reportAt index; finite candidates and server deadlines. Never a GET.
    for (const category of ['extreme_weather', 'flood', 'landslide', 'earthquake', 'typhoon']) {
      const candidates = await models.DisasterAlert.find({ category, reportAt: { $gte: since } })
        .hint({ category: 1, reportAt: -1 }).sort({ reportAt: -1 }).limit(200).maxTimeMS(2000)
        .select('source sourceId sourceUrl status infoType eventId category reportAt controlAt serial eventAt earthquake typhoon raw.Head raw.Control raw.Body.Warning raw.Body.Intensity raw.Body.MeteorologicalInfos raw.points').lean();
      capped ||= candidates.length === 200;
      for (const alert of candidates) {
        if (alert.category === 'typhoon' && alert.source === 'jma' && alert.raw?.Body?.MeteorologicalInfos) {
          alert.typhoon = require('../utils/disasterJmaParser').extractTyphoon(alert.raw);
        }
        await ingestAlert(alert);
      }
    }
    const location = locationConfig();
    const weather = await models.DisasterWeatherObservation.findOne({ locationName: location.name, latitude: location.latitude, longitude: location.longitude, bucketStartAt: { $gte: since } })
      .hint({ locationName: 1, bucketStartAt: -1 }).sort({ bucketStartAt: -1 }).maxTimeMS(2000)
      .select('-raw').lean();
    if (weather) await saveWeather(weather);
    await model.updateOne({ _id: marker }, { $set: { order: order(now()), data: { version: VERSION, capped } } }, { upsert: true, maxTimeMS: 2000 });
    if (capped) logger.warning('Local disaster bootstrap candidate cap reached; coverage may remain unavailable', { category: 'disaster_ingestion' });
  }
  return { read, put, ingestAlert, saveWeather, health, bootstrap };
}
module.exports = { createLocalSummaryService, buildSummary, ids, key, projection, weatherData, order, freshness };
