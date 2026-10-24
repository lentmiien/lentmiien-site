jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { parseJmaAlert } = require('../../utils/disasterJmaParser');
const { warningEvidence, localIntensity, p2pLocalIntensity, earthquakeEvidence, typhoonEvidence, INTENSITIES } = require('../../utils/disasterLocalEvidence');
const { LOCALITY, localWarningCode, locationConfig, locationKey, distanceKm } = require('../../utils/disasterLocality');
const { buildSummary, createLocalSummaryService, key, ids, order, weatherData } = require('../../services/disasterLocalSummaryService');
const { weatherCondition, artwork } = require('../../utils/disasterArtwork');
const now = new Date('2026-10-24T14:10:00Z');
const at = new Date('2026-10-24T13:57:00Z');
function bulletin({ code = '1410011', name = '発表警報・注意報はなし', hazardCode = '00', status = '', at: time = at, product = 'VPWW53', infoType = '発表', controlAt = time, serial = '1' } = {}) {
  return parseJmaAlert({ entry: { id: `https://example.test/${product}.xml`, updatedAt: time }, xmlText: `<Report><Control><Title>気象警報・注意報</Title><Status>通常</Status><DateTime>${controlAt.toISOString()}</DateTime></Control><Head><Title>気象警報・注意報</Title><ReportDateTime>${time.toISOString()}</ReportDateTime><EventID>kanagawa</EventID><InfoType>${infoType}</InfoType><Serial>${serial}</Serial><Headline><Text>神奈川県では強風や高波に注意。</Text><Information type="気象警報・注意報（府県等）"><Item><Kind><Name>強風注意報</Name><Code>15</Code></Kind><Areas><Area><Name>神奈川県</Name><Code>140000</Code></Area></Areas></Item></Information></Headline></Head><Body><Warning type="市町村等"><Item><Area><Name>横浜市北部</Name><Code>${code}</Code></Area><Kind><Name>${name}</Name><Code>${hazardCode}</Code><Status>${status}</Status></Kind></Item><Item><Area><Name>横浜市南部</Name><Code>1410012</Code></Area><Kind><Name>発表警報・注意報はなし</Name><Code>00</Code></Kind></Item></Warning></Body></Report>` });
}
function records(warnings, weather = null, health = { ok: true, at: now }) {
  return [{ _id: key('warnings'), data: warnings }, { _id: key('health'), data: health }, ...(weather ? [{ _id: key('weather'), data: weather }] : [])];
}
// Primary-key in-memory adapter implements CAS/duplicate-key semantics, not query planning.
function memoryModel() {
  const docs = new Map();
  function matches(doc, filter) {
    if (!doc) return false;
    if (filter.order && doc.order !== filter.order) return false;
    if (filter.signature?.$ne && doc.signature === filter.signature.$ne) return false;
    if (filter.$or) return filter.$or.some(f => f.order?.$lt ? doc.order < f.order.$lt : doc.order === f.order && doc.signature === f.signature);
    return true;
  }
  const model = { updateOne: jest.fn(async (filter, update, opts) => {
    const doc = docs.get(filter._id);
    if (doc && !matches(doc, filter)) { if (opts.upsert) throw { code: 11000 }; return; }
    const result = structuredClone(doc || { _id: filter._id });
    for (const [k, v] of Object.entries(update.$set)) {
      if (k === 'data.coverage') result.data.coverage = v; else result[k] = structuredClone(v);
    }
    docs.set(filter._id, result);
  }), findById: id => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => docs.get(id) }) }) }) };
  return { model, docs, service: createLocalSummaryService({ model, now: () => now }) };
}
test('Oct 24 Kanagawa generic warning title cannot override explicit North no-hazards state', () => {
  const parsed = bulletin();
  expect(parsed.title).toBe('気象警報・注意報');
  const evidence = warningEvidence(parsed);
  expect(evidence.coverage).toBe(true);
  expect(buildSummary(records(evidence), now).warnings).toMatchObject({ state: 'clear', active: [] });
});
test.each(['1410012', '140000', '1411200', '1410000'])('nonlocal or wrong-product code %s cannot establish local coverage', code => {
  expect(warningEvidence(bulletin({ code }))).toBeNull();
});
test('legacy mapping is product and date specific, and rejects ambiguous transition', () => {
  expect(localWarningCode('1410000', 'VPWW53', '2026-05-27T10:00:00Z')).toBe(true);
  expect(localWarningCode('1410000', 'VPWW54', '2026-05-28T04:00:00Z')).toBe(false);
  expect(localWarningCode('1410000', 'VXSE53', '2026-05-27T10:00:00Z')).toBe(false);
  expect(localWarningCode('1410011', 'VXSE53', at)).toBe(false);
});
test('generic bulletin warning severity does not upgrade actual local advisory', () => {
  const evidence = warningEvidence(bulletin({ name: '強風注意報', hazardCode: '15', status: '継続' }));
  expect(buildSummary(records(evidence), now).warnings.active).toEqual([expect.objectContaining({ severity: 'advisory', name: '強風注意報', areaCode: LOCALITY.warningCode })]);
});
test('unknown statuses, empty kinds, cancellation of entire bulletin are unavailable, not clear', () => {
  const a = bulletin({ name: '大雨警報', hazardCode: '03', status: 'unrecognized' });
  expect(warningEvidence(a).coverage).toBe(false);
  a.raw.Body.Warning.Item[0].Kind = [];
  expect(warningEvidence(a).coverage).toBe(false);
  expect(warningEvidence(bulletin({ infoType: '取消' })).coverage).toBe(false);
});
test('cancellation, correction, duplicates and out-of-order events resolve monotonically', async () => {
  const { service, docs } = memoryModel();
  const active = bulletin({ name: '強風注意報', hazardCode: '15', status: '発表' });
  await service.ingestAlert(active);
  await service.ingestAlert(bulletin({ product: 'VPWW54', name: '強風注意報', hazardCode: '15', status: '発表' }));
  expect(docs.get(key('warnings')).data.coverage).toBe(true);
  const later = new Date(+at + 60000);
  await service.ingestAlert(bulletin({ name: '強風注意報', hazardCode: '15', status: '解除', at: later }));
  await service.ingestAlert(active);
  expect(buildSummary([...docs.values(), { _id: key('health'), data: { ok: true, at: now } }], now).warnings.state).toBe('clear');
  await service.ingestAlert(bulletin({ at: later, controlAt: new Date(+later + 1000), infoType: '訂正', name: '大雨警報', hazardCode: '03', status: '発表' }));
  expect(docs.get(key('warnings')).data.hazards[0].severity).toBe('warning');
});
test('conflicting equal revision variants fail closed', async () => {
  const { service, docs } = memoryModel();
  await service.ingestAlert(bulletin());
  await service.ingestAlert(bulletin({ product: 'VPWW54', name: '大雨警報', hazardCode: '03', status: '発表' }));
  expect(docs.get(key('warnings')).data.coverage).toBe(false);
  await service.ingestAlert(bulletin());
  expect(docs.get(key('warnings')).data.coverage).toBe(false);
});
test('fresh local coverage and successful source checks are both required for clear', () => {
  const evidence = warningEvidence(bulletin());
  for (const health of [{ ok: false, at: now }, { ok: true, at: new Date(+now - 3600000) }]) {
    expect(buildSummary(records(evidence, null, health), now).warnings.state).toBe('stale');
  }
  expect(buildSummary(records(evidence), new Date(+now + 7 * 3600000)).warnings.active).toEqual([]);
  expect(buildSummary([], now).warnings.state).toBe('unavailable');
});
test.each(INTENSITIES)('local intensity %s stays distinct from national maximum and magnitude', level => {
  const observation = { Pref: { Area: { City: { Code: '1411200', Name: '横浜旭区', MaxInt: level } } }, MaxInt: '7' };
  expect(localIntensity(observation)).toBe(level);
  const evidence = earthquakeEvidence({ category: 'earthquake', source: 'jma', eventAt: at, earthquake: { maxIntensity: '7', magnitude: 8 }, raw: { Body: { Intensity: { Observation: observation } } } });
  const summary = buildSummary([{ _id: key('earthquake'), data: evidence }], now);
  expect(summary.earthquake.intensity).toBe(level);
  expect(summary.earthquake.art).toBe(artwork('earthquake', level));
});
test('missing local observation is unknown; station code/name and P2P points are normalized', () => {
  expect(localIntensity({ MaxInt: '7' })).toBeNull();
  expect(localIntensity({ Pref: { Area: { City: { Code: '1411200', IntensityStation: { Int: '1' } } } } })).toBe('1');
  expect(p2pLocalIntensity([{ addr: '横浜旭区大池町', scale: 10 }, { addr: '東京', scale: 70 }])).toBe('1');
  expect(p2pLocalIntensity([{ addr: '東京', scale: 70 }])).toBeNull();
});
test('remote earthquake does not displace measured local report; correction can retract it', async () => {
  const { service, docs } = memoryModel();
  const a = { category: 'earthquake', source: 'p2pquake', eventId: 'a', eventAt: at, reportAt: at, raw: { points: [{ addr: '横浜旭区', scale: 10 }] } };
  await service.ingestAlert(a);
  await service.ingestAlert({ ...a, eventId: 'b', reportAt: now, eventAt: now, raw: { points: [] } });
  expect(docs.get(key('earthquake')).data.intensity).toBe('1');
  await service.ingestAlert({ ...a, reportAt: now, infoType: '訂正', raw: { points: [] } });
  expect(docs.get(key('earthquake')).data.intensity).toBeNull();
});
test('typhoon radius is geodesic and track points require current validity', () => {
  const centre = { latitude: 35, longitude: 139 };
  const a = { category: 'typhoon', reportAt: at, typhoon: { track: [{ latitude: 42, longitude: 147, validAt: now }] } };
  expect(distanceKm(centre, a.typhoon.track[0])).toBeGreaterThan(900);
  expect(typhoonEvidence(a, now, centre)).toBeNull();
  a.typhoon.track[0] = { ...centre, validAt: now };
  expect(typhoonEvidence(a, now, centre).state).toBe('proximity');
  delete a.typhoon.track[0].validAt;
  expect(typhoonEvidence(a, now, centre)).toBeNull();
});
test('global storm-wind probability and regional text never imply local impact', () => {
  const a = { category: 'typhoon', reportAt: at, title: '台風 神奈川県 東京', typhoon: { maxWindProbability: 100, affectedAreas: [{ name: '東京都', probability: 100, validAt: now }] } };
  expect(typhoonEvidence(a, now)).toBeNull();
  a.typhoon.affectedAreas.push({ name: '横浜市北部', probability: 20, validAt: now });
  expect(typhoonEvidence(a, now).probability).toBe(20);
  expect(typhoonEvidence(a, new Date(+now + 2 * 86400000))).toBeNull();
});
test.each([['openweathermap-current', 800, true, 'clear-day'], ['openweathermap-current', 800, false, 'clear-night'], ['openweathermap-current', 800, null, 'unknown'], ['openweathermap-current', 500, true, 'rain'], ['open-meteo-jma-hourly', 3, true, 'cloudy'], ['open-meteo-jma-hourly', 95, true, 'storm'], ['open-meteo-jma-hourly', 800, true, 'unknown'], ['openweathermap-current', 3, true, 'unknown']])('condition namespaces %s/%s', (source, code, day, expected) => {
  expect(weatherCondition(source, code, day)).toBe(expected);
});
test('same-hour latest observations, target selection, forecast estimate and stale labels', async () => {
  const { service, docs } = memoryModel();
  const location = locationConfig();
  const observation = { source: 'openweathermap-current', locationName: location.name, latitude: location.latitude, longitude: location.longitude, observedAt: at, temperatureC: 21, weatherCode: '800', isDay: true };
  await service.saveWeather(observation);
  await service.saveWeather({ ...observation, observedAt: now, temperatureC: 23 });
  await service.saveWeather(observation);
  await service.saveWeather({ ...observation, locationName: 'Other', observedAt: now, temperatureC: 40 });
  expect(buildSummary([...docs.values()], now).weather.temperatureC).toBe(23);
  expect(buildSummary([...docs.values()], new Date(+now + 2 * 3600000)).weather).toMatchObject({ freshness: 'stale', label: 'Last-known weather · stale' });
  const estimate = weatherData({ ...observation, source: 'openweathermap-hourly' });
  expect(buildSummary([{ _id: key('estimate'), data: estimate }], now).weather).toMatchObject({ label: 'Forecast estimate', precipitationPeriodHours: 3 });
  expect(JSON.stringify([...docs.values()])).not.toContain('latitude');
  expect(locationKey({ ...location, latitude: 0 })).not.toBe(locationKey(location));
});
test('read path has exactly six primary-key candidates, compact projection and deadline, no writes', async () => {
  const chain = { select: jest.fn(() => chain), limit: jest.fn(() => chain), maxTimeMS: jest.fn(() => chain), lean: jest.fn(() => chain), exec: jest.fn(async () => []) };
  const model = { find: jest.fn(() => chain), updateOne: jest.fn() };
  const service = createLocalSummaryService({ model, now: () => now });
  await service.read();
  expect(model.find).toHaveBeenCalledWith({ _id: { $in: ids() } });
  expect(chain.select).toHaveBeenCalledWith('_id data');
  expect(chain.limit).toHaveBeenCalledWith(6);
  expect(chain.maxTimeMS).toHaveBeenCalledWith(1500);
  expect(model.updateOne).not.toHaveBeenCalled();
});
module.exports = { bulletin };

test('cancellation without Body invalidates matching local coverage without inventing clear', async () => {
  const { service, docs } = memoryModel();
  await service.ingestAlert(bulletin());
  const cancel = bulletin({ at: now, infoType: '取消' }); delete cancel.raw.Body;
  await service.ingestAlert(cancel);
  expect(docs.get(key('warnings')).data.coverage).toBe(false);
});
test('newer storm moving outside the true radius clears its old proximity context', async () => {
  const { service, docs } = memoryModel();
  const location = locationConfig();
  const a = { category: 'typhoon', eventId: 'storm-a', reportAt: at, typhoon: { track: [{ ...location, validAt: now }] } };
  await service.ingestAlert(a);
  expect(docs.get(key('typhoon')).data.state).toBe('proximity');
  await service.ingestAlert({ ...a, reportAt: now, typhoon: { track: [{ latitude: 0, longitude: 0, validAt: now }] } });
  expect(docs.get(key('typhoon')).data.state).toBe('unknown');
});
test('future forecast cannot block subsequent measured current conditions', async () => {
  const { service, docs } = memoryModel();
  const location = locationConfig();
  const base = { locationName: location.name, latitude: location.latitude, longitude: location.longitude, receivedAt: now };
  await service.saveWeather({ ...base, source: 'openweathermap-hourly', temperatureC: 30, observedAt: new Date(+now + 3600000) });
  expect(buildSummary([...docs.values()], now).weather.label).toBe('Forecast estimate');
  await service.saveWeather({ ...base, source: 'openweathermap-current', temperatureC: 21, observedAt: at });
  expect(buildSummary([...docs.values()], now).weather).toMatchObject({ temperatureC: 21, label: 'Current weather' });
});
test('bootstrap uses indexed bounded candidates once, reprocesses stored local coverage and never advances source freshness', async () => {
  const { service, docs } = memoryModel();
  const alertChain = { hint: jest.fn(() => alertChain), sort: jest.fn(() => alertChain), limit: jest.fn(() => alertChain), maxTimeMS: jest.fn(() => alertChain), select: jest.fn(() => alertChain), lean: jest.fn(async () => [bulletin()]) };
  const weatherChain = { hint: jest.fn(() => weatherChain), sort: jest.fn(() => weatherChain), maxTimeMS: jest.fn(() => weatherChain), select: jest.fn(() => weatherChain), lean: jest.fn(async () => null) };
  const models = { DisasterAlert: { find: jest.fn(() => alertChain) }, DisasterWeatherObservation: { findOne: jest.fn(() => weatherChain) } };
  await service.bootstrap(models); await service.bootstrap(models);
  expect(models.DisasterAlert.find).toHaveBeenCalledTimes(5);
  expect(alertChain.hint).toHaveBeenCalledWith({ category: 1, reportAt: -1 });
  expect(alertChain.limit).toHaveBeenCalledWith(200);
  expect(alertChain.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(docs.has(key('health'))).toBe(false);
  expect(docs.get(key('warnings')).data.at).toEqual(at);
  expect(buildSummary([...docs.values()], now).warnings.state).toBe('stale');
});
test('all original art states exist as small standalone SVGs without scripts, external resources or animation', () => {
  const fs = require('fs');
  const manifest = require('../../public/i/disaster/v3/manifest.json');
  expect(manifest.assets).toHaveLength(26);
  for (const asset of manifest.assets) {
    expect(asset.url).toBe(artwork(asset.group, asset.condition));
    const svg = fs.readFileSync(`public${asset.url}`, 'utf8');
    expect(Buffer.byteLength(svg)).toBeLessThan(12000);
    expect(svg).toContain('viewBox="0 0 720 480"');
    expect(svg).not.toMatch(/<script|<animate|href=|<foreignObject/);
  }
});

test('an unrelated expired track point does not expire a later locally relevant forecast point', () => {
  const location = locationConfig();
  const result = typhoonEvidence({ category: 'typhoon', reportAt: at, typhoon: { track: [
    { latitude: 0, longitude: 0, validAt: new Date(+now - 3 * 3600000) },
    { ...location, validAt: new Date(+now + 12 * 3600000) },
  ] } }, now);
  expect(result.state).toBe('proximity'); expect(+result.validUntil).toBeGreaterThan(+now);
});
