const crypto = require('crypto');

const SCHEMA_VERSION = 'taric-foundation/1';
const LIMITS = Object.freeze({ requestBytes: 4096, feedbackBytes: 1024, evidenceBytes: 65536,
  resultBytes: 4096, text: 12000, name: 1000, queryMs: 2000 });
const CODES = Object.freeze({
  INFERENCE_UNCERTAIN: 502,
  UNAUTHORIZED: 401, FORBIDDEN: 403, RELEASE_CLOSED: 503, TOKEN_BUDGET: 422,
  QUEUE_FULL: 429, RATE_LIMITED: 429, INTERRUPTED: 409, CANCELLED: 409,
  IMPORT_INVALID: 400, OVERLAP: 409, STALE: 409, PROVIDER_FAILED: 502,
  INVALID_REQUEST: 400, INVALID_FEEDBACK: 400, INVALID_SCOPE: 403, NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409, JAN_AMBIGUOUS: 422, EVIDENCE_NOT_FOUND: 422,
  IDENTITY_MISMATCH: 422, IDENTITY_UNVERIFIABLE: 422, EVIDENCE_INVALID: 422,
  EVIDENCE_INCOMPLETE: 422, FETCH_DISABLED: 503, FETCH_FAILED: 502,
  FETCH_LIMITED: 429, EVIDENCE_RACE: 409, STORAGE_FAILED: 503,
  PROVIDER_DISABLED: 503, CONFIG_NOT_READY: 503, INVALID_RESULT: 502,
  CATALOG_REJECTED: 422,
});

class TaricError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(CODES, code) ? code : 'STORAGE_FAILED';
    super(`TARIC operation failed: ${safeCode}`);
    this.name = 'TaricError';
    this.code = safeCode;
    this.status = CODES[safeCode];
  }
}
function fail(code) { throw new TaricError(code); }
function object(value, keys, code) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function string(value, max, code, pattern) {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || (pattern && pattern.exec(value)?.[0] !== value)) fail(code);
  return value;
}
function bounded(value, max, code) {
  let json;
  try { json = JSON.stringify(value); } catch (_) { fail(code); }
  if (!json || Buffer.byteLength(json) > max) fail(code);
}
function jan(value, code = 'INVALID_REQUEST') {
  // Syntax only: preserve leading zeros. Checksum is deliberately not asserted.
  return string(value, 13, code, /^(?:[0-9]{8}|[0-9]{13})$/);
}
function gcode(value, code = 'INVALID_REQUEST') {
  // Bounded pilot subset covering the FIGURE-/GOODS- examples in core-api.v1.yaml
  // and amiamiItemsApiController tests; not an established full upstream grammar.
  return string(value, 64, code, /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/);
}
function taric(value, code = 'INVALID_RESULT') {
  return string(value, 10, code, /^[0-9]{10}$/);
}
function validateRequest(value) {
  const code = 'INVALID_REQUEST';
  object(value, ['jan', 'item_code', 'descriptive_name', 'input_hs_code'], code);
  bounded(value, LIMITS.requestBytes, code);
  if (!Object.hasOwn(value, 'jan') && !Object.hasOwn(value, 'item_code')) fail(code);
  const result = {};
  if (Object.hasOwn(value, 'jan')) result.jan = jan(value.jan);
  if (Object.hasOwn(value, 'item_code')) result.item_code = gcode(value.item_code);
  result.descriptive_name = string(value.descriptive_name, 500, code);
  result.input_hs_code = string(value.input_hs_code, 6, code, /^[0-9]{6}$/);
  return result;
}
function validateFeedback(value) {
  object(value, ['selected_code'], 'INVALID_FEEDBACK');
  bounded(value, LIMITS.feedbackBytes, 'INVALID_FEEDBACK');
  return { selected_code: taric(value.selected_code, 'INVALID_FEEDBACK') };
}
function validateScope(value) {
  object(value, ['ownerId', 'principalId'], 'INVALID_SCOPE');
  return Object.fromEntries(['ownerId', 'principalId'].map((key) => [key,
    string(value[key], 128, 'INVALID_SCOPE', /^[A-Za-z0-9_-]+$/)]));
}
function idempotencyKey(value) {
  return string(value, 128, 'INVALID_REQUEST', /^[A-Za-z0-9_-]{16,128}$/);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const FACT_FIELDS = Object.freeze(['name', 'specifications', 'details', 'remarks', 'brand',
  'seriesTitle', 'characterName', 'releaseDate']);
const WARNINGS = Object.freeze(['specifications_missing', 'details_missing', 'listing_name_fallback',
  'source_timestamp_missing']);
function validateEvidence(value) {
  const code = 'EVIDENCE_INVALID';
  object(value, ['schema_version', 'gcode', 'jan', 'facts', 'provenance', 'warnings', 'hash'], code);
  bounded(value, LIMITS.evidenceBytes, code);
  if (value.schema_version !== SCHEMA_VERSION) fail(code);
  gcode(value.gcode, code);
  if (value.jan !== null) jan(value.jan, code);
  object(value.facts, FACT_FIELDS, code);
  for (const field of FACT_FIELDS) {
    const fact = value.facts[field];
    if (fact !== null || field === 'name') string(fact, field === 'name' ? LIMITS.name : LIMITS.text, code);
  }
  if (value.facts.name.trim().toLowerCase() === value.gcode.toLowerCase()) fail(code);
  const p = value.provenance;
  object(p, ['source', 'source_url', 'scode', 'resolution', 'name_field', 'identity', 'fetched_at', 'fields'], code);
  if (Object.hasOwn(p, 'scode')) string(p.scode, 64, code);
  if (p.source !== 'amiami' || p.source_url !== `https://www.amiami.com/eng/detail?gcode=${value.gcode}`
    || !['local_item_code', 'local_jan', 'online_item_code'].includes(p.resolution)
    || !['details.itemName', 'listing.itemName'].includes(p.name_field)
    || !['item_code', 'jan', 'both_agree'].includes(p.identity)) fail(code);
  if ((p.identity !== 'item_code' && value.jan === null)
    || (p.resolution === 'local_jan' ? p.identity !== 'jan' : p.identity === 'jan')) fail(code);
  if (p.fetched_at !== null && (typeof p.fetched_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.fetched_at)
    || !Number.isFinite(Date.parse(p.fetched_at)))) fail(code);
  object(p.fields, FACT_FIELDS, code);
  for (const field of FACT_FIELDS) {
    if (p.fields[field] !== (value.facts[field] !== null)) fail(code);
  }
  const expectedWarnings = [];
  if (!value.facts.specifications) expectedWarnings.push('specifications_missing');
  if (!value.facts.details) expectedWarnings.push('details_missing');
  if (p.name_field === 'listing.itemName') expectedWarnings.push('listing_name_fallback');
  if (p.fetched_at === null) expectedWarnings.push('source_timestamp_missing');
  if (!Array.isArray(value.warnings) || JSON.stringify(value.warnings) !== JSON.stringify(expectedWarnings)) fail(code);
  const { hash: digest, ...content } = value;
  if (digest !== hash(content)) fail(code);
  return JSON.parse(JSON.stringify(value));
}
function validateCatalog(catalog) {
  object(catalog, ['id', 'version', 'approved', 'codes'], 'CONFIG_NOT_READY');
  string(catalog.id, 100, 'CONFIG_NOT_READY');
  string(catalog.version, 100, 'CONFIG_NOT_READY');
  if (catalog.approved !== true || !Array.isArray(catalog.codes)
    || catalog.codes.length < 1 || catalog.codes.length > 100000) fail('CONFIG_NOT_READY');
  catalog.codes.forEach((code) => taric(code, 'CONFIG_NOT_READY'));
  return { id: catalog.id, version: catalog.version, approved: true, codes: [...new Set(catalog.codes)] };
}
function validateResult(value, catalog, inputHs) {
  const approved = validateCatalog(catalog);
  string(inputHs, 6, 'INVALID_REQUEST', /^[0-9]{6}$/);
  object(value, ['code', 'basis_fields'], 'INVALID_RESULT');
  bounded(value, LIMITS.resultBytes, 'INVALID_RESULT');
  taric(value.code);
  if (!Array.isArray(value.basis_fields) || value.basis_fields.length < 1
    || value.basis_fields.length > FACT_FIELDS.length
    || value.basis_fields.some((field) => !FACT_FIELDS.includes(field))
    || new Set(value.basis_fields).size !== value.basis_fields.length) fail('INVALID_RESULT');
  if (!approved.codes.includes(value.code)) fail('CATALOG_REJECTED');
  return { code: value.code, basis_fields: [...value.basis_fields],
    catalog_id: approved.id, catalog_version: approved.version,
    output_validated: true, verification: 'unverified', training_approved: false,
    warnings: value.code.startsWith(inputHs) ? [] : ['input_hs_prefix_mismatch'] };
}

module.exports = { SCHEMA_VERSION, LIMITS, CODES, FACT_FIELDS, WARNINGS, TaricError, fail, object,
  string, bounded, jan, gcode, taric, validateRequest, validateFeedback, validateScope,
  idempotencyKey, hash, validateEvidence, validateCatalog, validateResult };
