const { SCHEMA_VERSION, CODES, FACT_FIELDS, LIMITS, object, bounded, string, taric, fail,
  validateRequest, validateEvidence, hash } = require('./taricContracts');

function validateVersions(value) {
  const keys = ['backend_id', 'base_model_id', 'adapter_id', 'template_id', 'catalog_id', 'catalog_version'];
  object(value, keys, 'INVALID_RESULT');
  for (const key of keys) {
    if (key === 'adapter_id' && value[key] === null) continue;
    string(value[key], 100, 'INVALID_RESULT');
  }
}
function validateRecommendationRecord(value) {
  const code = 'INVALID_RESULT';
  object(value, ['schema_version', 'request', 'evidence', 'suggestion', 'versions', 'state', 'error_code'], code);
  bounded(value, LIMITS.evidenceBytes + 8192, code);
  if (value.schema_version !== SCHEMA_VERSION) fail(code);
  validateRequest(value.request);
  if (value.evidence !== null) {
    const evidence = validateEvidence(value.evidence);
    if ((value.request.item_code && value.request.item_code !== evidence.gcode)
      || (value.request.jan && value.request.jan !== evidence.jan)) fail(code);
    const identity = value.request.jan ? (value.request.item_code ? 'both_agree' : 'jan') : 'item_code';
    if (evidence.provenance.identity !== identity) fail(code);
  }
  if (!['prepared', 'failed', 'suggested', 'abstained'].includes(value.state)) fail(code);
  if (value.error_code !== null && !Object.hasOwn(CODES, value.error_code)) fail(code);
  if (value.state === 'failed' ? value.error_code === null : value.error_code !== null) fail(code);
  if (value.versions !== null) validateVersions(value.versions);
  if (value.state === 'prepared' && (!value.evidence || value.versions !== null)) fail(code);
  if (value.suggestion === null) {
    if (value.state === 'suggested') fail(code);
  } else {
    if (value.state !== 'suggested' || !value.evidence) fail(code);
    validateVersions(value.versions);
    const s = value.suggestion;
    object(s, ['code', 'basis_fields', 'catalog_id', 'catalog_version', 'output_validated',
      'verification', 'training_approved', 'warnings'], code);
    taric(s.code);
    if (s.output_validated !== true || s.verification !== 'unverified' || s.training_approved !== false
      || s.catalog_id !== value.versions.catalog_id || s.catalog_version !== value.versions.catalog_version
      || !Array.isArray(s.basis_fields) || !s.basis_fields.length || s.basis_fields.length > FACT_FIELDS.length
      || new Set(s.basis_fields).size !== s.basis_fields.length
      || s.basis_fields.some((field) => !FACT_FIELDS.includes(field) || !value.evidence.facts[field])) fail(code);
    const warnings = s.code.startsWith(value.request.input_hs_code) ? [] : ['input_hs_prefix_mismatch'];
    if (JSON.stringify(s.warnings) !== JSON.stringify(warnings)) fail(code);
  }
  return JSON.parse(JSON.stringify(value));
}
function validateFeedbackRecord(value) {
  const code = 'INVALID_FEEDBACK';
  object(value, ['selected_code', 'decision', 'catalog_status', 'catalog_id', 'catalog_version',
    'missing_evidence', 'verification', 'training_approved', 'recommendation_hash'], code);
  bounded(value, 2048, code);
  taric(value.selected_code, code);
  if (!['accepted', 'changed', 'manual'].includes(value.decision)
    || !['unknown', 'not_approved', 'approved_member'].includes(value.catalog_status)
    || typeof value.missing_evidence !== 'boolean' || value.verification !== 'unverified'
    || value.training_approved !== false) fail(code);
  if (value.catalog_status === 'unknown') {
    if (value.catalog_id !== null || value.catalog_version !== null) fail(code);
  } else {
    string(value.catalog_id, 100, code);
    string(value.catalog_version, 100, code);
  }
  string(value.recommendation_hash, 64, code, /^[a-f0-9]{64}$/);
  return JSON.parse(JSON.stringify(value));
}
function requestHash(request) { return hash({ schema_version: SCHEMA_VERSION, request }); }

module.exports = { validateRecommendationRecord, validateFeedbackRecord, validateVersions, requestHash };
