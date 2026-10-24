const { LOCALITY, localWarningCode, distanceKm, locationConfig } = require('./disasterLocality');
const array = x => x == null ? [] : Array.isArray(x) ? x : [x];
const text = x => x && typeof x === 'object' ? text(x['#text']) : x == null ? '' : String(x).trim();
const date = x => x && Number.isFinite(new Date(x).getTime()) ? new Date(x) : null;
const INTENSITIES = ['0', '1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
function intensity(x) {
  const value = text(x).replace('弱', '-').replace('強', '+').replace('−', '-');
  return INTENSITIES.includes(value) ? value : null;
}
function localIntensity(observation) {
  const values = [];
  for (const pref of array(observation?.Pref)) for (const area of array(pref.Area)) for (const city of array(area.City)) {
    const local = text(city.Code) === LOCALITY.earthquakeCode || /^横浜(?:市)?旭区$/.test(text(city.Name));
    if (local) values.push(intensity(city.MaxInt));
    for (const station of array(city.IntensityStation)) {
      if (local || /^横浜(?:市)?旭区/.test(text(station.Name))) values.push(intensity(station.Int));
    }
  }
  return values.filter(x => x !== null).sort((a, b) => INTENSITIES.indexOf(b) - INTENSITIES.indexOf(a))[0] ?? null;
}
function p2pLocalIntensity(points) {
  const scales = { 0: '0', 10: '1', 20: '2', 30: '3', 40: '4', 45: '5-', 50: '5+', 55: '6-', 60: '6+', 70: '7' };
  return array(points).filter(p => /^横浜(?:市)?旭区/.test(p.addr || ''))
    .map(p => scales[p.scale]).filter(x => x !== undefined).sort((a, b) => INTENSITIES.indexOf(b) - INTENSITIES.indexOf(a))[0] ?? null;
}
function productOf(alert) {
  return [alert.sourceId, alert.sourceUrl, alert.raw?.Control?.Title].map(text).join(' ').match(/VPWW\d{2}/)?.[0] || '';
}
function warningEvidence(alert) {
  if (alert.source !== 'jma' || (alert.status && alert.status !== '通常')) return null;
  const report = alert.raw || {};
  const product = productOf(alert);
  const at = date(alert.reportAt || text(report.Head?.ReportDateTime));
  if (!at) return null;
  const tuples = [];
  let covered = false;
  let unknown = /取消/.test(alert.infoType || text(report.Head?.InfoType));
  for (const warning of array(report.Body?.Warning)) {
    // Headline region summaries cannot establish municipality state.
    if (!/市町村|二次細分/.test(text(warning['@_type']))) continue;
    for (const item of array(warning.Item)) {
      if (!array(item.Area).some(a => localWarningCode(text(a.Code), product, at))) continue;
      covered = true;
      const kinds = array(item.Kind);
      if (!kinds.length) unknown = true;
      for (const kind of kinds) {
        const name = text(kind.Name);
        const code = text(kind.Code);
        const status = text(kind.Status);
        const clear = code === '00' || /発表警報・注意報はなし|警報・注意報なし/.test(name);
        const cancelled = /解除|取消/.test(status);
        const severity = /特別警報|レベル５|レベル5/.test(name) ? 'emergency' : /危険警報|警報/.test(name) ? 'warning' : /注意報/.test(name) ? 'advisory' : null;
        const active = /^(発表|継続|切替|警報から注意報)$/.test(status);
        if (!clear && (!severity || (!active && !cancelled))) unknown = true;
        tuples.push({ areaCode: LOCALITY.warningCode, code: code.slice(0, 12), name: name.slice(0, 120), status: status.slice(0, 40), severity, active: !clear && !cancelled && active && !!severity });
      }
    }
  }
  if (!covered) return null;
  const seen = new Map();
  for (const tuple of tuples) {
    const id = `${tuple.code}:${tuple.name}`;
    if (seen.has(id) && seen.get(id).active !== tuple.active) unknown = true;
    seen.set(id, tuple);
  }
  if (tuples.some(t => t.code === '00') && tuples.some(t => t.active)) unknown = true;
  if (seen.size > 30) unknown = true;
  const unique = [...seen.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  return { at, source: 'JMA', eventId: text(alert.eventId).slice(0, 100), coverage: !unknown, hazards: unique.slice(0, 30), product };
}
function earthquakeEvidence(alert) {
  if (alert.category !== 'earthquake' || (alert.status && alert.status !== '通常')) return null;
  let local = null;
  if (alert.source === 'jma') local = localIntensity(alert.raw?.Body?.Intensity?.Observation);
  if (alert.source === 'p2pquake') local = p2pLocalIntensity(alert.raw?.points);
  const at = date(alert.eventAt || alert.reportAt);
  if (!at) return null;
  if (/取消/.test(alert.infoType || '')) local = null;
  return { at, reportedAt: date(alert.reportAt), source: alert.source, intensity: local,
    magnitude: Number.isFinite(alert.earthquake?.magnitude) ? alert.earthquake.magnitude : null,
    nationalMax: intensity(alert.earthquake?.maxIntensity), eventId: text(alert.eventId).slice(0, 100) };
}
function typhoonEvidence(alert, now = new Date(), location = locationConfig()) {
  if (alert.category !== 'typhoon' || (alert.status && alert.status !== '通常')) return null;
  const at = date(alert.reportAt);
  if (!at || +now - +at > 24 * 3600000 || +at - +now > 300000) return null;
  const valid = p => date(p.validAt) && +date(p.validAt) >= +now - 3 * 3600000 && +date(p.validAt) <= +now + 24 * 3600000;
  const nearbyPoints = array(alert.typhoon?.track).filter(p => valid(p) && distanceKm(location, p) <= 900);
  const nearby = nearbyPoints.length > 0;
  // Typhoon probability codes are a different product: require its explicit area name,
  // never equate its numeric codes with warning or earthquake codes.
  const local = array(alert.typhoon?.affectedAreas).filter(a => ['横浜市北部', '横浜市旭区', '横浜旭区'].includes(a.name) && valid(a) && Number.isFinite(a.probability) && a.probability >= 0 && a.probability <= 100);
  const probability = local.length ? Math.max(...local.map(a => a.probability)) : null;
  const relevant = nearby || probability !== null;
  if (!relevant && !alert.eventId) return null;
  return { at, relevant, eventId: text(alert.eventId).slice(0, 100), source: alert.source, name: text(alert.typhoon?.name || 'Typhoon').slice(0, 80), proximity: nearby,
    probability, validUntil: new Date(relevant ? Math.min(+at + 24 * 3600000, Math.max(...[...nearbyPoints, ...local].map(p => +date(p.validAt) + 3 * 3600000))) : +at),
    state: /取消/.test(alert.infoType || '') ? 'unknown' : probability > 0 ? 'probability' : nearby ? 'proximity' : 'unknown' };
}
module.exports = { INTENSITIES, intensity, localIntensity, p2pLocalIntensity, warningEvidence, earthquakeEvidence, typhoonEvidence, productOf, date };
