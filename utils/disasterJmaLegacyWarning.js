// Frozen deployed v2 evaluator, used ONLY to compare-and-swap its exact summary
// during bounded cached migration. Never use this to certify current evidence.
const { LOCALITY, localWarningCode } = require('./disasterLocality');
const { array, text, municipalityWarnings } = require('./disasterJmaMunicipality');
const { date, productOf } = require('./disasterLocalEvidence');
function completeMunicipalityWarnings(warnings) {
  return warnings.length > 0 && warnings.every(w => array(w.Item).length > 0 && array(w.Item).every(item =>
    array(item?.Area).length > 0 && array(item.Area).every(a => /^\d{7}$/.test(text(a?.Code))) &&
    array(item.Kind).length > 0 && array(item.Kind).every(k => /^\d{2}$/.test(text(k?.Code)) && text(k?.Name) &&
      (text(k.Code) === '00' ? !text(k.Status) || /^(発表|継続|解除|取消)$/.test(text(k.Status)) :
        /^(発表|継続|切替|警報から注意報|解除|取消)$/.test(text(k.Status))))));
}
function warningEvidence(alert) {
  if (alert.source !== 'jma' || (alert.status && alert.status !== '通常')) return null;
  const report = alert.raw || {};
  const product = productOf(alert);
  const at = date(alert.reportAt || text(report.Head?.ReportDateTime));
  if (!at) return null;
  const tuples = [];
  let covered = false;
  const warnings = municipalityWarnings(report);
  let unknown = /取消/.test(alert.infoType || text(report.Head?.InfoType)) || !completeMunicipalityWarnings(warnings);
  for (const warning of warnings) {
    for (const item of array(warning.Item)) {
      if (!array(item?.Area).some(a => localWarningCode(text(a?.Code), product, at))) continue;
      covered = true;
      const kinds = array(item.Kind);
      if (!kinds.length) unknown = true;
      for (const kind of kinds) {
        const name = text(kind?.Name);
        const code = text(kind?.Code);
        const status = text(kind?.Status);
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
module.exports = { warningEvidence };
