const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => value && typeof value === 'object' ? text(value['#text']) : value == null ? '' : String(value).trim();

// JMA's municipal Warning type is distinct from 市町村等をまとめた地域等.
// Keep the previously accepted short municipal/secondary-subdivision aliases
// explicit. Never infer authority from a substring (including historical
// 二次細分区域等, which was also used for a parent regional level).
const MUNICIPAL_TYPES = new Set([
  '気象警報・注意報（市町村等）', '市町村等',
  '気象警報・注意報（二次細分区域）', '二次細分区域',
]);
function isMunicipalityWarning(warning) {
  // Trim XML boundary whitespace only; don't join words or alter punctuation.
  return MUNICIPAL_TYPES.has(text(warning?.['@_type']));
}
function municipalityWarnings(report) {
  return array(report?.Body?.Warning).filter(isMunicipalityWarning);
}
// VPWW53/54 manuals §3-2-4-1-1-1 and VPWW54 Appendix 1. These are
// current Kind values, never LastKind/NextKinds or headline Code=00.
const HAZARD_NAMES = Object.freeze({
  '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報',
  '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
  '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報',
  '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '18': '洪水注意報',
  '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
  '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報', '27': 'その他の注意報',
  '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報',
  '36': '大雪特別警報', '37': '波浪特別警報', '38': '高潮特別警報',
});
const CLEAR_STATUS = '発表警報・注意報はなし';
const ACTIVE_STATUSES = new Set(['発表', '継続', '特別警報から警報', '特別警報から注意報', '警報から注意報']);
const KIND_STATES = Object.freeze(['active', 'cancelled', 'clear', 'unknown']);
const MUNICIPAL_REASONS = Object.freeze([
  'missing_municipality_block', 'missing_municipality_item', 'invalid_municipality_area',
  'missing_municipality_kind', 'invalid_kind_field', 'missing_kind_status', 'unsupported_kind_status',
  'clear_kind_has_identifiers', 'missing_kind_code', 'unsupported_kind_code', 'kind_name_code_mismatch',
  'kind_status_code_mismatch', 'conflicting_municipality_states',
]);
// An absent optional Name is fine; a malformed, duplicated or contradictory
// supplied identifier is not. Do not let text() coerce arrays into valid fields.
const scalar = value => value == null || typeof value === 'string' ||
  (!!value && typeof value === 'object' && !Array.isArray(value) && typeof value['#text'] === 'string');
function municipalKind(kind) {
  const unknown = reason => ({ state: 'unknown', reason });
  if (!kind || typeof kind !== 'object' || Array.isArray(kind) ||
    !['Code', 'Name', 'Status'].every(field => scalar(kind[field]))) return unknown('invalid_kind_field');
  const code = text(kind.Code); const suppliedName = text(kind.Name); const status = text(kind.Status);
  if (!status) return unknown('missing_kind_status');
  if (status === CLEAR_STATUS) {
    if (code || suppliedName || text(kind.Condition)) return unknown('clear_kind_has_identifiers');
    return { state: 'clear', code: '', name: '', status, severity: null };
  }
  if (!ACTIVE_STATUSES.has(status) && status !== '解除') return unknown('unsupported_kind_status');
  if (!code) return unknown('missing_kind_code');
  if (!Object.hasOwn(HAZARD_NAMES, code)) return unknown('unsupported_kind_code');
  const name = HAZARD_NAMES[code];
  if (suppliedName && suppliedName !== name) return unknown('kind_name_code_mismatch');
  const severity = Number(code) >= 30 ? 'emergency' : Number(code) >= 10 ? 'advisory' : 'warning';
  if ((status === '特別警報から警報' && severity !== 'warning') ||
    (['特別警報から注意報', '警報から注意報'].includes(status) && severity !== 'advisory')) return unknown('kind_status_code_mismatch');
  return { state: status === '解除' ? 'cancelled' : 'active', code, name, status, severity };
}
function municipalityProblem(warnings) {
  if (!warnings.length) return 'missing_municipality_block';
  const areas = new Map();
  for (const warning of warnings) {
    if (!array(warning?.Item).length) return 'missing_municipality_item';
    for (const item of array(warning.Item)) {
      if (!array(item?.Area).length || array(item.Area).some(a => !scalar(a?.Code) || !/^\d{7}$/.test(text(a?.Code)))) return 'invalid_municipality_area';
      if (!array(item.Kind).length) return 'missing_municipality_kind';
      const kinds = array(item.Kind).map(municipalKind);
      const invalid = kinds.find(k => k.state === 'unknown');
      if (invalid) return invalid.reason;
      for (const area of array(item.Area)) {
        const code = text(area.Code);
        const states = areas.get(code) || [];
        states.push(...kinds);
        areas.set(code, states);
      }
    }
  }
  for (const kinds of areas.values()) {
    // Check across Items/blocks too. A no-issued statement contradicts both an
    // active hazard and a just-cancelled hazard, per the product definition.
    if (kinds.some(k => k.state === 'clear') && kinds.some(k => k.state !== 'clear')) return 'conflicting_municipality_states';
    const seen = new Map();
    for (const kind of kinds) {
      if (seen.has(kind.code) && seen.get(kind.code) !== kind.state) return 'conflicting_municipality_states';
      seen.set(kind.code, kind.state);
    }
  }
  return null;
}
const completeMunicipalityWarnings = warnings => municipalityProblem(warnings) === null;
module.exports = { array, text, isMunicipalityWarning, municipalityWarnings, completeMunicipalityWarnings,
  municipalKind, municipalityProblem, HAZARD_NAMES, CLEAR_STATUS, KIND_STATES, MUNICIPAL_REASONS };
