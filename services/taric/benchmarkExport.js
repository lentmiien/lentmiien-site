const { fail, object } = require('../../utils/taricContracts');
const { hash, sha } = require('../../utils/taricProtocol');
const { cmp } = require('./historyDomain');
const importer = require('./importer');

const ALGORITHM = 'verified-benchmark-balanced/1';
const HEADERS = [...importer.REQUIRED, 'description_summary', 'source_id', 'group_id', 'provenance'];
function options(value = {}) {
  object(value, ['limit'], 'INVALID_REQUEST');
  const limit = value.limit === undefined ? 500 : value.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail('INVALID_REQUEST');
  return { limit };
}
function csvRow(row) {
  return HEADERS.map(key => `"${(row[key] || '').replaceAll('"', '""')}"`).join(',') + '\r\n';
}
function inputRow(row) {
  return { ...row.canonical, specs: row.canonical.specs || '', taric_code: row.review.target,
    description_summary: row.review.approvedDescription || '', source_id: row.inputs.jan || '', group_id: row.groupKey,
    provenance: `verified-history:${row.id};review:${row.revision};source:${row.sourceHash}` };
}
async function build(rows, value, training) {
  const opts = options(value);
  const skipped = []; const buckets = new Map(); const inputs = new Set(); const groups = new Set();
  const trainingSources = new Set((training?.cases || []).map(c => c.sourceHash));
  const newest = [...rows].sort((a, b) => cmp(b.review?.at || '', a.review?.at || '') || cmp(b.id, a.id));
  const skip = (row, reason) => skipped.push({ id: row.id, reason });
  for (const row of newest) {
    if (!row.eligible || row.review?.status !== 'verified') { skip(row, row.reasons[0] || 'unreviewed'); continue; }
    const csv = inputRow(row); let parsed;
    try { parsed = importer.caseFromRow(csv); } catch (error) {
      if (error.code !== 'IMPORT_INVALID') throw error;
      skip(row, 'invalid_benchmark_input'); continue;
    }
    if (importer.overlaps([parsed], training?.cases || []).any || trainingSources.has(row.sourceIdentityHash)) {
      skip(row, 'known_training_overlap'); continue;
    }
    if (inputs.has(row.dedupeKey) || groups.has(row.groupKey)) { skip(row, 'duplicate_product_or_input'); continue; }
    inputs.add(row.dedupeKey); groups.add(row.groupKey);
    if (!buckets.has(row.review.target)) buckets.set(row.review.target, []);
    buckets.get(row.review.target).push({ row, csv });
  }
  const selected = []; const perCode = {};
  const codes = [...buckets.keys()].sort(cmp);
  const depth = Math.max(0, ...[...buckets.values()].map(bucket => bucket.length));
  for (let index = 0; index < depth; index++) for (const code of codes) {
    const entry = buckets.get(code)[index]; if (!entry) continue;
    if (selected.length >= opts.limit) { skip(entry.row, 'overall_limit'); continue; }
    selected.push(entry); perCode[code] = (perCode[code] || 0) + 1;
  }
  const csv = HEADERS.join(',') + '\r\n' + selected.map(entry => csvRow(entry.csv)).join('');
  const bytes = Buffer.byteLength(csv);
  if (bytes > importer.MAX_IMPORT_BYTES) {
    const error = new Error('BENCHMARK_EXPORT_TOO_LARGE: reduce the row limit to fit the 2 MiB benchmark import ceiling');
    error.historyStatus = 413; error.historyCode = error.message; throw error;
  }
  // Validate the final file with the same parser used by Benchmark import.
  const manifest = selected.length ? (await importer.preview(Buffer.from(csv))).manifest : null;
  const excludedByReason = {};
  for (const entry of skipped) excludedByReason[entry.reason] = (excludedByReason[entry.reason] || 0) + 1;
  return { csv, algorithm: ALGORITHM, options: opts, sha256: sha(csv), bytes, manifest,
    trainingReference: training ? { id: String(training._id), sha256: training.manifest?.sha256 || null, casesHash: hash(training.cases) } : null,
    summary: { available: rows.length, eligible: rows.filter(row => row.eligible).length, selected: selected.length,
      distinctCodes: Object.keys(perCode).length, excluded: skipped.length, excludedByReason, perCode },
    selected: selected.map(({ row }) => ({ id: row.id, name: row.facts.name, jan: row.inputs.jan, target: row.review.target })), skipped };
}
module.exports = { options, build };
