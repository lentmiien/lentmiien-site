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
function completeMunicipalityWarnings(warnings) {
  return warnings.length > 0 && warnings.every(w => array(w.Item).length > 0 && array(w.Item).every(item =>
    array(item?.Area).length > 0 && array(item.Area).every(a => /^\d{7}$/.test(text(a?.Code))) &&
    array(item.Kind).length > 0 && array(item.Kind).every(k => /^\d{2}$/.test(text(k?.Code)) && text(k?.Name) &&
      (text(k.Code) === '00' ? !text(k.Status) || /^(発表|継続|解除|取消)$/.test(text(k.Status)) :
        /^(発表|継続|切替|警報から注意報|解除|取消)$/.test(text(k.Status))))));
}
module.exports = { array, text, isMunicipalityWarning, municipalityWarnings, completeMunicipalityWarnings };
