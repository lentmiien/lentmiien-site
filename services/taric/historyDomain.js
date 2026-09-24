const { hash } = require('../../utils/taricProtocol');
const { object, string, fail, CODES, FACT_FIELDS } = require('../../utils/taricContracts');
const PROFILE = 'reviewed-code-candidates/1';
const ALGORITHM = 'reviewed-selector/1';
const REVIEW_STATES = ['unreviewed', 'verified', 'needs_review', 'excluded'];
const STATES = ['queued', 'running', 'complete', 'failed', 'interrupted', 'cancelled'];
const codeValid = v => typeof v === 'string' && /^\d{10}$/.test(v);
const text = (v, max = 12000) => typeof v === 'string' && v.length <= max ? v : null;
const iso = v => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
const normalize = v => (v || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function pick(value, keys) { return Object.fromEntries(keys.map(k => [k, text(value?.[k]) ])); }
function sourceRow(r) {
  const f = r.feedback?.[0] || null;
  const a = r.admission || {};
  const configuration = r.runMetadata?.[0]?.configuration;
  return {
    id: r._id, createdAt: iso(r.createdAt), finishedAt: iso(r.finishedAt), state: r.state,
    mode: r.input?.test === true ? 'test' : 'normal',
    inputs: pick(r.input, ['jan', 'item_code', 'descriptive_name', 'input_hs_code']),
    facts: pick(r.evidence?.facts, FACT_FIELDS),
    evidence: { hash: text(r.evidence?.hash, 64), gcode: text(r.evidence?.gcode, 64),
      provenance: pick(r.evidence?.provenance, ['source', 'resolution', 'name_field', 'identity', 'fetched_at']) },
    suggestion: r.result && codeValid(r.result.taric_code) ? { code: r.result.taric_code, description: text(r.result.description, 255) } : null,
    diagnostic: !r.result && r.diagnostics?.proposal ? { code: text(r.diagnostics.proposal.taric_code, 10), description: text(r.diagnostics.proposal.description, 255), label: 'UNVALIDATED diagnostic candidate' } : null,
    error: text(r.error, 100), errorStage: text(r.errorStage, 100),
    provenance: { adapter: text(a.adapter, 100), benchmark: text(a.benchmark, 100), run: text(a.run, 100), identity: text(typeof a.identity === 'string' ? a.identity : a.identity?.identity, 500),
      runtime: pick(a.identity, ['deploymentRevision', 'baseRevision', 'tokenizerRevision', 'adapterSha256']), fingerprint: text(a.fingerprint, 64),
      template: text(configuration?.template?.renderer, 100), templateHash: text(configuration?.template?.systemHash, 64), catalogVersion: text(configuration?.catalog?.version, 1000) },
    feedback: f ? { id: f._id, code: f.selected_code, decision: f.decision, createdAt: iso(f.createdAt), catalogStatus: f.catalog_status } : null,
  };
}
function derive(r) {
  // Use the exact JSON representation persisted/exported; omit undefined keys.
  return deriveSource(JSON.parse(JSON.stringify(sourceRow(r))), r.reviews?.[0]);
}
function deriveSource(source, doc, archived = false) {
  const sourceHash = hash(source);
  const review = doc?.latest || null;
  // A final immutable feedback binding is the retention proof. A proposal-only
  // attestation can never regain freshness merely because raw sources expired.
  const finalBinding = Boolean(source.feedback && review?.feedbackId === source.feedback.id
    && review.feedbackHash === hash(source.feedback));
  const stale = Boolean(review && (review.sourceHash !== sourceHash || (archived && !finalBinding)));
  const canonical = { descriptive_name: source.inputs.descriptive_name, full_item_name: source.facts.name,
    specs: source.facts.specifications, hs_code: source.inputs.input_hs_code };
  const normalized = Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k, normalize(v)]));
  const factsHash = hash(normalized);
  const groupKey = source.inputs.jan ? `jan:${source.inputs.jan}` : `facts:${factsHash}`;
  const reasons = [];
  if (!review || review.status !== 'verified') reasons.push(review?.status || 'unreviewed');
  if (stale) reasons.push('stale_source');
  if (['queued', 'running'].includes(source.state)) reasons.push('pending_request');
  if (!codeValid(review?.target)) reasons.push('missing_valid_target');
  if (!source.facts.name?.trim()) reasons.push('missing_full_item_name');
  if (!source.inputs.descriptive_name?.trim()) reasons.push('missing_descriptive_name');
  if (!/^\d{6}$/.test(source.inputs.input_hs_code || '')) reasons.push('missing_valid_original_hs6');
  return { ...source, source, sourceStorage: archived ? 'archived_review' : 'live_request', sourceHash, revision: doc?.revision || 0, review, stale,
    reviewStatus: stale ? 'needs_review' : review?.status || 'unreviewed',
    canonical, factsHash, groupKey, dedupeKey: factsHash,
    overlapHash: factsHash, sourceIdentityHash: hash(normalize(source.facts.name)),
    reasons, eligible: reasons.length === 0,
    warnings: [...(archived ? [finalBinding ? 'Archived canonical source; final feedback bound at review, not a live-source check.' : 'Archived source without final feedback binding; freshness unresolved, verification unavailable.'] : review && !review.source ? ['legacy_review_has_no_retained_source_reverify_before_expiry'] : []), ...(!review?.approvedDescription ? ['approved_description_missing_formatter_pending'] : []), 'Human attestation; syntax is not official TARIC verification.'],
  };
}
function classify(rows, heldout = []) {
  const groups = new Map();
  for (const r of rows.filter(r => r.review?.status === 'verified' && !r.stale)) {
    for (const key of [r.groupKey, `facts:${r.factsHash}`]) {
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(r.review.target);
    }
  }
  const overlap = new Set(heldout.map(c => c.overlapHash).filter(Boolean));
  const sources = new Set(heldout.map(c => c.sourceHash).filter(Boolean));
  const groupHashes = new Set(heldout.map(c => c.groupHash).filter(Boolean));
  return rows.map(r => {
    const reasons = [...r.reasons];
    if ([r.groupKey, `facts:${r.factsHash}`].some(k => groups.get(k)?.size > 1)) reasons.push('conflicting_verified_targets');
    if (overlap.has(r.overlapHash) || sources.has(r.sourceIdentityHash) || groupHashes.has(hash(normalize(r.groupKey)))
      || (r.inputs.jan && (sources.has(hash(normalize(r.inputs.jan))) || groupHashes.has(hash(normalize(r.inputs.jan)))))) reasons.push('independent_holdout_overlap');
    return { ...r, reasons, eligible: reasons.length === 0,
      reviewStatus: reasons.includes('conflicting_verified_targets') && r.review?.status === 'verified' ? 'needs_review' : r.reviewStatus };
  });
}
function filters(value = {}) {
  const keys = ['from', 'to', 'mode', 'state', 'feedback', 'review', 'error', 'jan', 'code', 'adapter', 'missing', 'eligible', 'search', 'cursor', 'snapshot'];
  if (value && Object.getPrototypeOf(value) === null) value = { ...value };
  object(value, keys, 'INVALID_REQUEST');
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === '') continue;
    string(v, k === 'cursor' ? 200 : 100, 'INVALID_REQUEST'); out[k] = v;
  }
  for (const [key, options] of Object.entries({ mode: ['test', 'normal'], state: STATES, feedback: ['present', 'absent', 'accepted', 'changed', 'manual'], review: REVIEW_STATES, missing: ['yes', 'no'], eligible: ['yes', 'no'] })) {
    if (out[key] && !options.includes(out[key])) fail('INVALID_REQUEST');
  }
  for (const key of ['from', 'to']) if (out[key]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out[key]) || iso(out[key])?.slice(0, 10) !== out[key]) fail('INVALID_REQUEST');
  }
  if (out.from && out.to && out.from > out.to) fail('INVALID_REQUEST');
  if (out.error && !Object.hasOwn(CODES, out.error)) fail('INVALID_REQUEST');
  if (out.jan && !/^(?:\d{8}|\d{13})$/.test(out.jan)) fail('INVALID_REQUEST');
  if (out.code && !codeValid(out.code)) fail('INVALID_REQUEST');
  if (out.cursor && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[a-f0-9]{32}$/.test(out.cursor)) fail('INVALID_REQUEST');
  if (out.cursor && !out.snapshot) fail('INVALID_REQUEST');
  if (out.snapshot && !/^[a-f0-9]{64}$/.test(out.snapshot)) fail('INVALID_REQUEST');
  if (out.cursor && iso(out.cursor.split('|')[0]) !== out.cursor.split('|')[0]) fail('INVALID_REQUEST');
  return out;
}
function matches(r, f) {
  return (!f.from || Date.parse(r.createdAt) >= Date.parse(f.from)) && (!f.to || Date.parse(r.createdAt) < Date.parse(f.to) + 86400000)
    && (!f.mode || r.mode === f.mode) && (!f.state || r.state === f.state)
    && (!f.feedback || (f.feedback === 'present' ? Boolean(r.feedback) : f.feedback === 'absent' ? !r.feedback : r.feedback?.decision === f.feedback))
    && (!f.review || r.reviewStatus === f.review) && (!f.error || r.error === f.error)
    && (!f.jan || r.inputs.jan === f.jan) && (!f.code || r.feedback?.code === f.code || r.review?.target === f.code)
    && (!f.adapter || r.provenance.adapter === f.adapter)
    && (!f.missing || (!r.facts.name?.trim()) === (f.missing === 'yes'))
    && (!f.eligible || r.eligible === (f.eligible === 'yes'))
    && (!f.search || normalize(`${r.inputs.descriptive_name || ''} ${r.facts.name || ''}`).includes(normalize(f.search)));
}
function stats(rows) {
  const count = fn => rows.filter(fn).length;
  const feedback = count(r => r.feedback);
  const errors = Object.create(null); for (const r of rows) if (r.error) errors[r.error] = (errors[r.error] || 0) + 1;
  return { total: rows.length, live: count(r => r.sourceStorage === 'live_request'), archived: count(r => r.sourceStorage === 'archived_review'), pending: count(r => ['queued', 'running'].includes(r.state)), terminal: count(r => !['queued', 'running'].includes(r.state)),
    feedback, decisions: Object.fromEntries(['accepted', 'changed', 'manual'].map(k => [k, { count: count(r => r.feedback?.decision === k), denominator: feedback }])),
    verified: count(r => r.reviewStatus === 'verified'), verifiedIneligible: count(r => r.review?.status === 'verified' && !r.eligible),
    eligible: count(r => r.eligible), codeCoverage: new Set(rows.filter(r => r.eligible).map(r => r.review.target)).size, errors };
}
function options(value = {}) {
  object(value, ['mode', 'limit', 'perCode'], 'INVALID_REQUEST');
  const out = { mode: value.mode ?? 'newest', limit: value.limit ?? 100, perCode: value.perCode ?? 20 };
  if (!['newest', 'balanced'].includes(out.mode) || !Number.isInteger(out.limit) || out.limit < 1 || out.limit > 200
    || !Number.isInteger(out.perCode) || out.perCode < 1 || out.perCode > 100) fail('INVALID_REQUEST');
  return out;
}
function select(rows, opts) {
  opts = options(opts);
  const skipped = []; const seen = new Set(); const buckets = new Map();
  const newest = [...rows].sort((a, b) => cmp(b.review?.at || '', a.review?.at || '') || cmp(b.id, a.id));
  for (const r of newest) {
    if (!r.eligible) { skipped.push({ id: r.id, reason: r.reasons[0], reasons: r.reasons }); continue; }
    if (seen.has(r.dedupeKey)) { skipped.push({ id: r.id, reason: 'duplicate_input', reasons: ['duplicate_input'] }); continue; }
    seen.add(r.dedupeKey);
    if (!buckets.has(r.review.target)) buckets.set(r.review.target, []);
    buckets.get(r.review.target).push(r);
  }
  let ordered = [...buckets.values()].flat().sort((a, b) => cmp(b.review.at, a.review.at) || cmp(b.id, a.id));
  if (opts.mode === 'balanced') {
    ordered = []; const codes = [...buckets.keys()].sort(cmp);
    for (let i = 0; i < newest.length; i++) for (const code of codes) if (buckets.get(code)[i]) ordered.push(buckets.get(code)[i]);
  }
  const selected = []; const perCode = {}; const perGroup = {};
  for (const r of ordered) {
    const code = r.review.target;
    const reason = (perCode[code] || 0) >= opts.perCode ? 'per_code_cap' : selected.length >= opts.limit ? 'overall_limit' : null;
    if (reason) skipped.push({ id: r.id, reason, reasons: [reason] });
    else { selected.push(r); perCode[code] = (perCode[code] || 0) + 1; perGroup[r.groupKey] = (perGroup[r.groupKey] || 0) + 1; }
  }
  const excludedByReason = {};
  for (const s of skipped) excludedByReason[s.reason] = (excludedByReason[s.reason] || 0) + 1;
  return { selected, skipped, summary: { available: rows.length, eligible: rows.filter(r => r.eligible).length,
    selected: selected.length, excluded: skipped.length, excludedByReason, perCode, perGroup, groups: new Set(selected.map(r => r.groupKey)).size } };
}
function candidate(r) {
  return { type: 'candidate', schema: PROFILE, requestId: r.id, feedbackId: r.feedback?.id || null, feedback: r.feedback, reviewId: r.id, reviewRevision: r.revision,
    sourceHash: r.sourceHash, source: r.source, sourceStorage: r.sourceStorage, review: r.review, reviewHash: hash(r.review), inputs: r.inputs, facts: r.facts, evidence: r.evidence,
    targetCode: r.review.target, approvedDescription: r.review.approvedDescription,
    missingness: { inputs: Object.fromEntries(Object.entries(r.inputs).map(([k, v]) => [k, !v])), facts: Object.fromEntries(Object.entries(r.facts).map(([k, v]) => [k, !v])), fullItemName: !r.facts.name, specifications: !r.facts.specifications, details: !r.facts.details, approvedDescription: !r.review.approvedDescription },
    groupKey: r.groupKey, dedupeKey: r.dedupeKey, factsHash: r.factsHash, provenance: r.provenance,
    verifiedAt: r.review.at, verification: 'verified', profile: PROFILE, formatterPending: true };
}
module.exports = { PROFILE, ALGORITHM, REVIEW_STATES, STATES, codeValid, sourceRow, derive, deriveSource, classify, filters, matches, stats, options, select, candidate, cmp };
