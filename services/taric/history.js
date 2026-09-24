const crypto = require('crypto');
const { object, string, fail } = require('../../utils/taricContracts');
const { hash, sha } = require('../../utils/taricProtocol');
const domain = require('./historyDomain');
const MAX_SCAN = 2000;
const MAX_BYTES = 32 * 1024 * 1024;
const query = q => q.maxTimeMS(2000).lean().exec();
const validId = id => string(id, 32, 'NOT_FOUND', /^[a-f0-9]{32}$/);
function limitError(message) { const error = new Error(message); error.historyStatus = 413; error.historyCode = message; throw error; }
const requestProjection = { _id: 1, owner: 1, input: 1, createdAt: 1, finishedAt: 1, state: 1,
  'evidence.facts': 1, 'evidence.hash': 1, 'evidence.gcode': 1, 'evidence.provenance': 1,
  'result.taric_code': 1, 'result.description': 1, 'diagnostics.proposal': 1,
  error: 1, errorStage: 1, 'admission.adapter': 1, 'admission.benchmark': 1, 'admission.run': 1,
  'admission.identity': 1, 'admission.fingerprint': 1 };
function createHistory({ models, adminPrincipal, now = () => new Date() }) {
  const { Request, Feedback, Benchmark, Run, Review, Export, Settings } = models;
  async function scope(actor) {
    string(actor, 24, 'FORBIDDEN', /^[a-f0-9]{24}$/);
    const principal = await adminPrincipal(actor);
    if (!principal?.owner || principal.id !== `admin_${actor}`) fail('FORBIDDEN');
    return principal.owner;
  }
  function joins(owner, audit = false) {
    return [
      // Run metadata belongs to the explicitly admin-managed global tool; the
      // reference comes only from the already owner-scoped parent admission.
      { $lookup: { from: Run.collection.name, let: { run: '$admission.run' }, pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$run'] } } },
        { $project: { _id: 1, 'configuration.template.renderer': 1, 'configuration.template.systemHash': 1, 'configuration.catalog.version': 1 } }, { $limit: 1 },
      ], as: 'runMetadata' } },
      { $lookup: { from: Feedback.collection.name, let: { request: '$_id' }, pipeline: [
        { $match: { owner, $expr: { $eq: ['$request', '$$request'] } } },
        { $project: { _id: 1, selected_code: 1, decision: 1, createdAt: 1, catalog_status: 1 } }, { $limit: 1 },
      ], as: 'feedback' } },
      { $lookup: { from: Review.collection.name, let: { request: '$_id' }, pipeline: [
        { $match: { owner, $expr: { $eq: ['$request', '$$request'] } } },
        { $project: { _id: 1, revision: 1, latest: 1, ...(audit ? { history: 1 } : {}) } }, { $limit: 1 },
      ], as: 'reviews' } },
    ];
  }
  function baseMatch(owner, filter, archived = false) {
    const match = { owner };
    const fields = archived ? { date: 'latest.source.createdAt', jan: 'latest.source.inputs.jan', mode: 'latest.source.mode', state: 'latest.source.state' }
      : { date: 'createdAt', jan: 'input.jan', mode: 'input.test', state: 'state' };
    const date = value => archived ? new Date(value).toISOString() : new Date(value);
    if (filter.from || filter.to) match[fields.date] = {
      ...(filter.from ? { $gte: date(filter.from) } : {}),
      ...(filter.to ? { $lt: date(Date.parse(filter.to) + 86400000) } : {}),
    };
    if (filter.jan) match[fields.jan] = filter.jan;
    if (filter.state) match[fields.state] = filter.state;
    if (filter.mode) match[fields.mode] = archived ? filter.mode : filter.mode === 'test' ? true : { $ne: true };
    return match;
  }
  function retainedPipeline(owner, match, archivedOnly = false, audit = false) {
    return [{ $match: match },
      { $project: { request: 1, revision: 1, latest: 1, ...(audit ? { history: 1 } : {}) } },
      { $lookup: { from: Request.collection.name, let: { request: '$request' }, pipeline: [
        { $match: { owner, $expr: { $eq: ['$_id', '$$request'] } } }, { $project: requestProjection }, ...joins(owner, audit),
      ], as: 'live' } },
      ...(archivedOnly ? [{ $match: { 'live.0': { $exists: false } } }] : []), { $limit: MAX_SCAN + 1 }];
  }
  function retainedRow(doc) {
    if (doc.live?.length) return domain.derive(doc.live[0]);
    return doc.latest?.source ? domain.deriveSource(doc.latest.source, doc, true) : null;
  }
  async function collect(aggregate, budget, max = MAX_SCAN) {
    const cursor = aggregate.option({ maxTimeMS: 2000 }).cursor({ batchSize: 25 });
    const rows = [];
    try {
      for await (const row of cursor) {
        budget.bytes += Buffer.byteLength(JSON.stringify(row));
        if (rows.length >= max || budget.bytes > MAX_BYTES) limitError('HISTORY_TOO_LARGE: pilot limit is 2000 filtered cases / 32 MiB; please narrow dates/JAN/mode/status filters (or retire conflicting reviews)');
        rows.push(row);
      }
    } finally { await cursor.close(); }
    return rows;
  }
  async function population(owner, filter = {}, requestId = null) {
    const budget = { bytes: 0 };
    // Indexed base predicates precede the cap and every source lookup.
    const raw = await collect(Request.aggregate([{ $match: { ...baseMatch(owner, filter), ...(requestId ? { _id: requestId } : {}) } },
      { $sort: { createdAt: -1, _id: -1 } }, { $limit: MAX_SCAN + 1 }, { $project: requestProjection }, ...joins(owner)]), budget);
    const archived = await collect(Review.aggregate(retainedPipeline(owner, {
      ...baseMatch(owner, filter, true), 'latest.source': { $exists: true }, ...(requestId ? { request: requestId } : {}),
    }, true)), budget, MAX_SCAN - raw.length);
    const base = [...raw.map(domain.derive), ...archived.map(retainedRow)];
    // Filters must never hide a contradictory verified case. Resolve only indexed
    // peers plus bounded legacy reviews, not every unrelated raw request.
    const keys = [...new Set(base.flatMap(r => [r.groupKey, `facts:${r.factsHash}`]))];
    const related = keys.length ? await collect(Review.aggregate(retainedPipeline(owner, {
      owner, 'latest.status': 'verified', $or: [{ identityKeys: { $in: keys } }, { identityKeys: { $exists: false } }],
    })), budget) : [];
    const peers = related.map(retainedRow).filter(Boolean);
    const all = [...new Map([...base, ...peers].map(r => [r.id, r])).values()];
    // Benchmarks are admin-managed globally by the existing tool (no owner field).
    // Only locked published independent identities are used; never counted as usage.
    const benchmarks = await query(Benchmark.find({ state: 'published', releaseEligible: true, contaminated: false,
      'review.independent': true, 'review.trainingExcluded': true }).select('_id cases.inputHash cases.overlapHash cases.sourceHash cases.groupHash').sort({ _id: 1 }).limit(101));
    if (benchmarks.length > 100) limitError('HOLDOUT_SCAN_TOO_LARGE');
    const heldout = benchmarks.flatMap(b => b.cases || []);
    if (heldout.length > 50000) limitError('HOLDOUT_SCAN_TOO_LARGE');
    const classified = domain.classify(all, heldout);
    const ids = new Set(base.map(r => r.id));
    const rows = classified.filter(r => ids.has(r.id)).sort((a, b) => domain.cmp(b.createdAt, a.createdAt) || domain.cmp(b.id, a.id));
    return { rows, populationHash: hash({ rows: classified.sort((a, b) => domain.cmp(a.id, b.id)).map(r => [r.id, r.sourceStorage, r.sourceHash, r.revision, hash(r.review), r.reasons]), benchmarks }) };
  }
  async function list(actor, value) {
    const filter = domain.filters(value); const owner = await scope(actor); const { rows, populationHash } = await population(owner, filter);
    if (filter.snapshot && filter.snapshot !== populationHash) fail('STALE');
    const matched = rows.filter(r => domain.matches(r, filter));
    const after = filter.cursor ? matched.filter(r => `${r.createdAt}|${r.id}` < filter.cursor) : matched;
    const page = after.slice(0, 50);
    return { rows: page, snapshot: populationHash, stats: domain.stats(matched), next: after.length > 50 ? `${page.at(-1).createdAt}|${page.at(-1).id}` : null };
  }
  async function detail(actor, id) {
    validId(id); const owner = await scope(actor);
    const { rows } = await population(owner, {}, id);
    const row = rows.find(r => r.id === id); if (!row) fail('NOT_FOUND');
    const audit = await query(Review.findOne({ owner, request: id }).select('revision history'));
    if ((audit?.revision || 0) !== row.revision) fail('STALE');
    const settings = await query(Settings.findOne({ _id: 'tool', owner }).select('testCatalog.codes'));
    return { ...row, audit: audit?.history || [],
      targetInTestCatalog: settings?.testCatalog?.codes?.includes(row.review?.target || row.feedback?.code || row.suggestion?.code) || false };
  }
  async function review(actor, id, value) {
    validId(id);
    object(value, ['expectedRevision', 'expectedSourceHash', 'status', 'target', 'confirmTarget', 'correction', 'note', 'approvedDescription'], 'INVALID_REQUEST');
    if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0 || value.expectedRevision > 100) fail('INVALID_REQUEST');
    if (value.expectedRevision === 100) limitError('REVIEW_REVISION_LIMIT: 100 audit revisions retained; operator retirement required');
    string(value.expectedSourceHash, 64, 'INVALID_REQUEST', /^[a-f0-9]{64}$/);
    if (!domain.REVIEW_STATES.includes(value.status)) fail('INVALID_REQUEST');
    string(value.note, 2000, 'INVALID_REQUEST');
    if (typeof value.correction !== 'boolean' || typeof value.confirmTarget !== 'boolean') fail('INVALID_REQUEST');
    if (value.approvedDescription !== null) string(value.approvedDescription, 255, 'INVALID_REQUEST');
    const owner = await scope(actor);
    const raw = await Request.aggregate([{ $match: { _id: id, owner } }, { $project: requestProjection }, ...joins(owner)]).option({ maxTimeMS: 2000 });
    const retained = !raw.length ? await query(Review.findOne({ owner, request: id }).select('latest revision')) : null;
    if (!raw.length && !retained?.latest?.source) fail('NOT_FOUND');
    const row = raw.length ? domain.derive(raw[0]) : domain.deriveSource(retained.latest.source, retained, true);
    if (row.revision !== value.expectedRevision || row.sourceHash !== value.expectedSourceHash || ['queued', 'running'].includes(row.state)) fail('STALE');
    const base = row.feedback?.code || row.suggestion?.code || null;
    const target = value.target ?? null;
    if (target !== null && !domain.codeValid(target)) fail('INVALID_REQUEST');
    if (value.status === 'verified' && (!base || !target || !value.confirmTarget || (target !== base && !value.correction))) fail('INVALID_REQUEST');
    if (value.status === 'verified' && row.sourceStorage === 'archived_review' && row.stale) fail('STALE');
    const retain = value.status === 'verified' || Boolean(raw[0]?.reviews?.[0]?.latest?.source || retained?.latest?.source);
    if (retain && Buffer.byteLength(JSON.stringify(row.source)) > 128 * 1024) limitError('REVIEW_SOURCE_TOO_LARGE: canonical source exceeds 128 KiB');
    const next = { ...(retain ? { source: row.source } : {}), revision: row.revision + 1, status: value.status, sourceHash: row.sourceHash,
      feedbackId: row.feedback?.id || null, feedbackHash: row.feedback ? hash(row.feedback) : null,
      target, approvedDescription: value.approvedDescription, note: value.note, actor, at: now().toISOString(), correction: value.correction };
    try {
      const result = await Review.updateOne({ _id: id, owner, request: id, revision: row.revision || { $exists: false } },
        { $set: { revision: next.revision, latest: next, identityKeys: [row.groupKey, `facts:${row.factsHash}`] }, $push: { history: next }, $setOnInsert: { owner, request: id } },
        { upsert: row.revision === 0, runValidators: true }).maxTimeMS(2000);
      if (!result.modifiedCount && !result.upsertedCount) fail('STALE');
    } catch (e) { if (e.code === 11000) fail('STALE'); throw e; }
    return { revision: next.revision };
  }
  async function previewFor(owner, value) {
    object(value, ['filters', 'options'], 'INVALID_REQUEST');
    const filters = domain.filters(value.filters || {}); delete filters.cursor; delete filters.snapshot;
    const options = domain.options(value.options || {});
    const { rows, populationHash } = await population(owner, filters);
    const selection = domain.select(rows.filter(r => domain.matches(r, filters)), options);
    const candidates = selection.selected.map(domain.candidate);
    const snapshotHash = hash({ populationHash, filters, options, candidates, skipped: selection.skipped });
    return { snapshotHash, profile: domain.PROFILE, algorithm: domain.ALGORITHM, filters, options,
      summary: selection.summary, skipped: selection.skipped, candidates };
  }
  async function preview(actor, value) { return previewFor(await scope(actor), value); }
  async function download(actor, value) {
    object(value, ['filters', 'options', 'expectedSnapshotHash'], 'INVALID_REQUEST');
    string(value.expectedSnapshotHash, 64, 'INVALID_REQUEST', /^[a-f0-9]{64}$/);
    const owner = await scope(actor);
    const input = { filters: value.filters || {}, options: value.options || {} };
    const preview = await previewFor(owner, input);
    if (preview.snapshotHash !== value.expectedSnapshotHash) fail('STALE');
    if (!preview.candidates.length) fail('INVALID_REQUEST');
    const lines = preview.candidates.map(r => JSON.stringify(r) + '\n').join('');
    const recheck = await previewFor(await scope(actor), input);
    if (recheck.snapshotHash !== preview.snapshotHash) fail('STALE');
    const id = crypto.randomBytes(16).toString('hex');
    const { candidates, ...metadata } = preview;
    const manifest = { type: 'manifest', schema: 'reviewed-taric-export/1', id, actor, validatedAt: now().toISOString(),
      ...metadata, rowsSha256: sha(lines), rows: candidates.length, formatterPending: true };
    const jsonl = JSON.stringify(manifest) + '\n' + lines;
    if (Buffer.byteLength(jsonl) > 8 * 1024 * 1024) limitError('EXPORT_TOO_LARGE: reduce row limit');
    await Export.create({ _id: id, owner, actor, snapshotHash: preview.snapshotHash, sha256: sha(jsonl), requests: candidates.map(r => r.requestId), jsonl });
    return { id, jsonl };
  }
  let active = 0;
  const bounded = fn => async (...args) => {
    if (active >= 2) fail('RATE_LIMITED');
    active++;
    try { return await fn(...args); } finally { active--; }
  };
  return Object.fromEntries(Object.entries({ list, detail, review, preview, download }).map(([name, fn]) => [name, bounded(fn)]));
}
module.exports = { createHistory, MAX_SCAN };
