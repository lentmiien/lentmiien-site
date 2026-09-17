const { parseString } = require('fast-csv');
const { fail, string, taric, object } = require('../../utils/taricContracts');
const { hs, hash, sha, TEMPLATE, CLEANED_SHA, TRAINING_SHA } = require('../../utils/taricProtocol');
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const REQUIRED = ['descriptive_name', 'full_item_name', 'specs', 'hs_code', 'taric_code'];
const OPTIONAL = ['description', 'taric_description', 'description_summary', 'source_id', 'group_id', 'provenance'];
function normalizeOverlap(value) { return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function caseFromRow(row) {
  for (const k of REQUIRED) if (typeof row[k] !== 'string') fail('IMPORT_INVALID');
  string(row.descriptive_name, 500, 'IMPORT_INVALID'); string(row.full_item_name, 1000, 'IMPORT_INVALID');
  if (row.specs.length > 12000) fail('IMPORT_INVALID');
  const input = { descriptive_name: row.descriptive_name, full_item_name: row.full_item_name, specs: row.specs, hs_code: hs(row.hs_code) };
  const target = taric(row.taric_code, 'IMPORT_INVALID');
  const summary = row.description_summary || '';
  if (summary.length > 1000) fail('IMPORT_INVALID');
  const metadata = {};
  for (const key of ['source_id', 'group_id', 'provenance']) {
    if (row[key]) metadata[key] = string(row[key], 500, 'IMPORT_INVALID');
  }
  return { input, hsOriginal: row.hs_code, target, summary, ...metadata,
    inputHash: hash(input), overlapHash: hash(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, normalizeOverlap(v)]))),
    sourceHash: hash(normalizeOverlap(metadata.source_id || row.full_item_name)),
    groupHash: metadata.group_id ? hash(normalizeOverlap(metadata.group_id)) : null };
}
async function preview(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMPORT_BYTES || !buffer.length) fail('IMPORT_INVALID');
  let csv;
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { fail('IMPORT_INVALID'); }
  const rows = []; let headers;
  await new Promise((resolve, reject) => {
    const parser = parseString(csv, { headers: true, ignoreEmpty: true, strictColumnHandling: true, maxRows: 501 });
    const invalid = () => { parser.destroy(); try { fail('IMPORT_INVALID'); } catch (e) { reject(e); } };
    parser.on('headers', h => {
      headers = h;
      if (REQUIRED.some(k => !h.includes(k)) || h.some(k => ![...REQUIRED, ...OPTIONAL].includes(k)) || new Set(h).size !== h.length) invalid();
    });
    parser.on('data-invalid', invalid).on('error', invalid);
    parser.on('data', r => { try { rows.push(caseFromRow(r)); } catch (_) { invalid(); } });
    parser.on('end', resolve);
  });
  if (!rows.length || rows.length > 500) fail('IMPORT_INVALID');
  const seen = new Map(); let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.inputHash)) {
      if (seen.get(row.inputHash).target !== row.target) fail('IMPORT_INVALID');
      duplicates++;
    } else seen.set(row.inputHash, row);
  }
  const cases = [...seen.values()];
  return { cases, manifest: { sha256: sha(buffer), bytes: buffer.length, headers, rows: rows.length,
    accepted: cases.length, duplicates, invalid: 0, distinctCodes: new Set(cases.map(r => r.target)).size,
    template: TEMPLATE, knownTrainingSource: sha(buffer) === CLEANED_SHA } };
}
function overlaps(cases, trainingCases) {
  const keys = ['overlapHash', 'sourceHash', 'groupHash'];
  const sets = Object.fromEntries(keys.map(k => [k, new Set(trainingCases.map(c => c[k]).filter(Boolean))]));
  const counts = Object.fromEntries(keys.map(k => [k, cases.filter(c => c[k] && sets[k].has(c[k])).length]));
  return { ...counts, any: Object.values(counts).some(n => n > 0),
    limitation: 'Exact normalized input/source/group checks only. Paraphrases and undeclared product families need human review; no semantic near-duplicate guarantee.' };
}
function validateReview(value) {
  object(value, ['targetsReviewed', 'independent', 'trainingExcluded', 'provenance', 'reviewer', 'sourceLineage', 'minExact', 'maxInvalid'], 'IMPORT_INVALID');
  for (const k of ['targetsReviewed', 'independent', 'trainingExcluded']) if (typeof value[k] !== 'boolean') fail('IMPORT_INVALID');
  string(value.provenance, 2000, 'IMPORT_INVALID'); string(value.reviewer, 200, 'IMPORT_INVALID');
  if (!Array.isArray(value.sourceLineage) || value.sourceLineage.length > 20) fail('IMPORT_INVALID');
  value.sourceLineage.forEach(v => string(v, 100, 'IMPORT_INVALID'));
  for (const k of ['minExact', 'maxInvalid']) if (typeof value[k] !== 'number' || !Number.isFinite(value[k]) || value[k] < 0 || value[k] > 1) fail('IMPORT_INVALID');
  return { ...value, sourceLineage: [...value.sourceLineage] };
}
function draft(parsed, version, review, training) {
  if (!Number.isSafeInteger(version) || version < 0 || version > 10000) fail('IMPORT_INVALID');
  review = validateReview(review);
  if (version > 0 && !training) fail('CONFIG_NOT_READY');
  const overlap = overlaps(parsed.cases, training?.cases || []);
  const contaminated = version === 0 || parsed.manifest.knownTrainingSource || overlap.any
    || review.sourceLineage.some(s => [TRAINING_SHA, CLEANED_SHA, 'v0', ...(training?.sourceLineage || [])].includes(s));
  const lineage = [...new Set([...review.sourceLineage, parsed.manifest.sha256, ...(contaminated ? [TRAINING_SHA, CLEANED_SHA, 'v0'] : [])])];
  return { version, state: 'draft', releaseEligible: false, contaminated, sourceLineage: lineage,
    manifest: { ...parsed.manifest, overlap }, cases: parsed.cases, review,
    policy: { version: 'exact-all-cases/1', minExact: review.minExact, maxInvalid: review.maxInvalid,
      denominator: parsed.cases.length, descriptionMetric: 'lexical-token-jaccard-diagnostic-only' } };
}
module.exports = { MAX_IMPORT_BYTES, REQUIRED, preview, overlaps, draft, validateReview };
