const { object, string, fail, TaricError } = require('../../utils/taricContracts');
const { hash, sha, TEMPLATE } = require('../../utils/taricProtocol');
const { testAdmission } = require('./gate');
const { id, validId, query } = require('./service');
const domain = require('./historyDomain');
const logger = require('../../utils/logger');
const MAX_CASES = 200;
function tooLarge(message) { throw Object.assign(new Error(message), { historyStatus: 413, historyCode: message }); }
function createReprocess({ service, history, evidence = service.evidence }) {
  const { Reprocess, Review } = service.models;
  const now = () => new Date(service.now());
  async function scope(actor) { return (await service.adminPrincipal(actor)).owner; }
  async function config() {
    const settings = await service.settings();
    // Local-only admission calculation; previews and starts never preflight or reserve.
    const admission = testAdmission(settings, service.version());
    return { admission, template: TEMPLATE, catalog: settings.testCatalog, maxTokens: settings.maxTokens };
  }
  function reason(row) {
    if (row.localClaim) return 'running_duplicate';
    if (['queued', 'running'].includes(row.state)) return 'original_request_running';
    if (row.review?.status === 'verified') return 'verified_protected';
    if (row.review?.status === 'excluded') return 'excluded_protected';
    if (!row.feedback || !domain.codeValid(row.feedback.code)) return 'no_final_feedback';
    if (!/^(?:\d{8}|\d{13})$/.test(row.inputs.jan || '')) return 'missing_invalid_jan';
    if (row.sourceStorage === 'archived_review' && row.stale && !row.localRevision) return 'unsupported_stale_archive';
    if (row.localRevision >= 10) return 'local_revision_limit';
    if (row.facts.name?.trim() && !row.localReprocess?.error) return 'already_has_item_data';
    return null;
  }
  async function previewPlan(actor, value) {
    object(value, ['filters'], 'INVALID_REQUEST');
    const selected = await history.selection(actor, value.filters || {});
    const configuration = await config();
    const active = await query(Reprocess.findOne({ owner: selected.owner, active: true }).select('_id cases.id'));
    const cases = []; const skipped = []; let bytes = 0; const deadline = Date.now() + 60000;
    for (const row of selected.rows) {
      if (Date.now() > deadline) tooLarge('LOCAL_LOOKUP_DEADLINE: narrow filters and preview again');
      let skip = active?.cases.some(c => c.id === row.id) ? 'running_duplicate' : reason(row);
      let facts;
      if (!skip) {
        try {
          facts = await evidence.resolveLocal({ jan: row.inputs.jan, descriptive_name: row.inputs.descriptive_name, input_hs_code: row.inputs.input_hs_code }, row.evidence.gcode);
        } catch (e) {
          if (!(e instanceof TaricError) || e.code === 'STORAGE_FAILED') throw e;
          skip = e.code === 'JAN_AMBIGUOUS' ? 'ambiguous_jan' : ['EVIDENCE_NOT_FOUND', 'EVIDENCE_INCOMPLETE'].includes(e.code) ? 'no_local_item_yet' : e.code;
        }
      }
      if (skip) { skipped.push({ id: row.id, reason: skip }); continue; }
      if (Buffer.byteLength(JSON.stringify(row.source)) > 128 * 1024) tooLarge('LOCAL_SOURCE_TOO_LARGE');
      cases.push({ id: row.id, source: row.source, sourceHash: row.sourceHash, reviewRevision: row.revision,
        localRevision: row.localRevision, feedbackHash: hash(row.feedback), evidence: facts, state: 'planned' });
      bytes += Buffer.byteLength(JSON.stringify(cases.at(-1)));
      if (cases.length > MAX_CASES || bytes > 8 * 1024 * 1024) tooLarge('LOCAL_BATCH_TOO_LARGE: narrow filters to at most 200 cases / 8 MiB');
    }
    const reasons = {}; for (const s of skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    const snapshotHash = hash({ version: 'local-reprocess/1', filters: selected.filters, populationHash: selected.populationHash, configuration, cases, skipped });
    return { owner: selected.owner, configuration, cases, skipped, snapshotHash, filters: selected.filters,
      summary: { filteredRows: selected.rows.length, eligible: cases.length, skipped: skipped.length, reasons }, activeBatch: active?._id || null };
  }
  function previewPublic(plan) {
    const { owner, configuration, cases, ...visible } = plan;
    return { ...visible, adapter: configuration.admission.adapter, candidates: cases.map(c => ({ id: c.id, jan: c.source.inputs.jan, name: c.evidence.facts.name, feedbackCode: c.source.feedback.code })) };
  }
  async function preview(actor, value) { return previewPublic(await previewPlan(actor, value)); }
  async function start(actor, value) {
    object(value, ['filters', 'expectedSnapshotHash', 'token', 'confirm'], 'INVALID_REQUEST');
    string(value.expectedSnapshotHash, 64, 'INVALID_REQUEST', /^[a-f0-9]{64}$/);
    string(value.token, 64, 'INVALID_REQUEST', /^[a-f0-9]{32,64}$/);
    if (value.confirm !== true) fail('INVALID_REQUEST');
    const owner = await scope(actor); const token = sha(value.token);
    const existing = await query(Reprocess.findOne({ owner, token }));
    if (existing) {
      if (existing.snapshotHash !== value.expectedSnapshotHash || hash(existing.filters) !== hash(domain.filters(value.filters || {}))) fail('IDEMPOTENCY_CONFLICT');
      return publicJob(existing);
    }
    const plan = await previewPlan(actor, { filters: value.filters || {} });
    if (plan.owner !== owner || plan.snapshotHash !== value.expectedSnapshotHash || await scope(actor) !== owner) fail('STALE');
    if (!plan.cases.length) fail('INVALID_REQUEST');
    const control = await query(service.models.Control.findById('inference'));
    if (!control) fail('CONFIG_NOT_READY');
    if (control.blocked) fail('RECOVERY_REQUIRED');
    try {
      const job = await Reprocess.create({ _id: id(), owner, actor, token, snapshotHash: plan.snapshotHash, filters: plan.filters,
        configuration: plan.configuration, cases: plan.cases, skipped: plan.skipped, state: 'queued', active: true,
        fence: null, cancelRequested: false, deadline: new Date(service.now() + 24 * 3600000), sessionEndReasons: {} });
      logger.notice('TARIC local reprocessing batch queued by administrator', { category: 'taric', metadata: { batch: job.id, cases: plan.cases.length } });
      return publicJob(job.toObject());
    } catch (e) {
      if (e.code !== 11000) throw e;
      const winner = await query(Reprocess.findOne({ owner, token }));
      if (winner && winner.snapshotHash === value.expectedSnapshotHash) return publicJob(winner);
      fail('QUEUE_FULL');
    }
  }
  function publicJob(r) {
    const counts = {}; for (const c of r.cases) counts[c.state] = (counts[c.state] || 0) + 1;
    return { id: r._id, state: r.state, active: r.active, error: r.error || null, cancelRequested: r.cancelRequested, cancelledBy: r.cancelledBy || null, cancelRequestedAt: r.cancelRequestedAt || null,
      counts, requested: r.cases.length, tried: r.cases.filter(c => c.dispatched).length,
      validPredictions: r.cases.filter(c => c.result).length, sessionCount: r.sessionCount, sessionEndReasons: r.sessionEndReasons,
      cases: r.cases.map(c => ({ id: c.id, state: c.state, error: c.error || null, revision: c.appliedRevision || null })),
      skipped: r.skipped, createdAt: r.createdAt, finishedAt: r.finishedAt, filters: r.filters,
      pollUrl: `/admin/taric/history/reprocess/${r._id}`, historyUrl: `/admin/taric/history?batch=${r._id}` };
  }
  async function status(actor, batch) {
    validId(batch); const owner = await scope(actor);
    const r = await query(Reprocess.findOne({ _id: batch, owner })); if (!r) fail('NOT_FOUND');
    return publicJob(r);
  }
  async function cancel(actor, batch, value) {
    object(value, ['confirm'], 'INVALID_REQUEST'); if (value.confirm !== true) fail('INVALID_REQUEST');
    validId(batch); const owner = await scope(actor);
    const r = await query(Reprocess.findOne({ _id: batch, owner })); if (!r) fail('NOT_FOUND');
    await Reprocess.updateOne({ _id: batch, owner, active: true }, { $set: { cancelRequested: true, cancelledBy: actor, cancelRequestedAt: now() } }).exec();
    return status(actor, batch);
  }
  async function context(r) {
    if ((await scope(r.actor)) !== r.owner) fail('FORBIDDEN');
    if (r.cancelRequested) fail('CANCELLED');
    if (r.deadline <= now()) fail('INTERRUPTED');
    if (hash(await config()) !== hash(r.configuration)) fail('STALE');
  }
  async function claim(r, c) {
    // Re-resolve the logical source, never take a caller-supplied parent/feedback.
    let row;
    try { row = await history.detail(r.actor, c.id); }
    catch (e) {
      if (e.code !== 'NOT_FOUND') throw e;
      // The frozen plan was captured with a closed immutable final outcome.
      // Raw TTL expiry cannot discard it or turn it into a new API request.
      if (!c.source.feedback || hash(c.source.feedback) !== c.feedbackHash) fail('STALE');
      row = domain.deriveSource(c.source);
    }
    if (row.sourceHash !== c.sourceHash || row.revision !== c.reviewRevision || row.localRevision !== c.localRevision || row.localClaim || reason(row)) fail('STALE');
    const doc = await query(Review.findOne({ _id: c.id, owner: r.owner }));
    const filter = { _id: c.id, request: c.id, owner: r.owner, revision: doc ? c.reviewRevision : { $exists: false },
      localRevision: c.localRevision || { $in: [null, 0] }, localClaim: null, ...(!doc?.originalSource ? { originalSource: { $exists: false } } : {}) };
    try {
      const result = await Review.updateOne(filter, { $set: { localClaim: r._id, ...(!doc?.originalSource ? { originalSource: c.source } : {}) },
        ...(!doc ? { $setOnInsert: { owner: r.owner, request: c.id, revision: 0 } } : {}) }, { upsert: !doc, runValidators: true }).maxTimeMS(2000);
      if (!result.modifiedCount && !result.upsertedCount) fail('STALE');
    } catch (e) { if (e.code === 11000) fail('STALE'); throw e; }
  }
  async function apply(r, c) {
    const at = now().toISOString();
    const localRevision = c.localRevision + 1;
    const projected = domain.sourceRow({ _id: c.id, evidence: c.evidence, result: c.result, diagnostics: c.diagnostics });
    const source = { ...c.source, facts: projected.facts, evidence: projected.evidence, suggestion: projected.suggestion, diagnostic: projected.diagnostic,
      provenance: { ...c.source.provenance, adapter: r.configuration.admission.adapter, benchmark: null, run: null,
        identity: null, runtime: { deploymentRevision: null, baseRevision: null, tokenizerRevision: null, adapterSha256: null },
        fingerprint: r.configuration.admission.fingerprint, template: r.configuration.template.renderer,
        templateHash: r.configuration.template.systemHash, catalogVersion: r.configuration.catalog.version || r.configuration.catalog.source || null },
      localReprocess: { version: 1, source: 'local_reprocess', batch: r._id, revision: localRevision, parentRevision: c.localRevision,
        parentSourceHash: c.sourceHash, feedbackId: c.source.feedback.id, feedbackHash: c.feedbackHash,
        actor: r.actor, at, state: c.result ? 'enriched' : 'model_failed', error: c.error || null,
        correlationId: c.correlationId || null, test: true } };
    if (Buffer.byteLength(JSON.stringify(source)) > 128 * 1024) tooLarge('LOCAL_SOURCE_TOO_LARGE');
    const doc = await query(Review.findOne({ _id: c.id, owner: r.owner }));
    // Idempotent completion across crash between pointer update and job update.
    if (doc?.localSource?.localReprocess?.batch === r._id && doc.localRevision === localRevision) return localRevision;
    const current = await history.currentSource(r.owner, c.id);
    if (!current || current.sourceHash !== c.sourceHash) fail('STALE');
    const result = await Review.updateOne({ _id: c.id, request: c.id, owner: r.owner, revision: c.reviewRevision,
      localRevision: c.localRevision || { $in: [0, null] }, localClaim: r._id },
    { $set: { localSource: source, localRevision, localClaim: null },
      $push: { localHistory: { source, batch: r._id, actor: r.actor, at, parentFeedbackId: c.source.feedback.id, error: c.error || null, diagnostics: c.diagnostics || null, errorStatus: c.errorStatus || null } } }, { runValidators: true }).maxTimeMS(2000);
    if (!result.modifiedCount) fail('STALE');
    return localRevision;
  }
  async function cancelForRecovery(checkLease) {
    const jobs = await query(Reprocess.find({ active: true, owner: (await service.settings())?.owner }).limit(8));
    for (const job of jobs) {
      for (let i = 0; i < job.cases.length; i++) {
        await checkLease();
        let c = job.cases[i];
        if (['claiming', 'running', 'recorded'].includes(c.state)) {
          if (['claiming', 'running'].includes(c.state)) c = { ...c, result: null, error: c.dispatched ? 'INFERENCE_UNCERTAIN' : 'INTERRUPTED' };
          try { c = { ...c, appliedRevision: await apply(job, c), state: c.result ? 'enriched' : 'model_failed' }; }
          catch (e) { if (e.code !== 'STALE') throw e; c = { ...c, state: 'stale', error: 'STALE' }; }
          await Review.updateOne({ _id: c.id, owner: job.owner, request: c.id, revision: c.reviewRevision,
            localRevision: c.localRevision || { $in: [0, null] }, localClaim: job._id }, { $set: { localClaim: null } }).exec();
        } else if (c.state === 'planned') c = { ...c, state: 'cancelled', error: 'CANCELLED' };
        await Reprocess.updateOne({ _id: job._id, owner: job.owner, active: true }, { $set: { [`cases.${i}`]: c } }).exec();
      }
      await checkLease();
      await Reprocess.updateOne({ _id: job._id, owner: job.owner, active: true }, { $set: { state: 'cancelled', active: false,
        cancelRequested: true, error: 'INTERRUPTED', fence: null, finishedAt: now() } }).exec();
    }
  }
  let active = 0;
  const bounded = fn => async (...args) => {
    if (active >= 2) fail('RATE_LIMITED');
    active++; try { return await fn(...args); } finally { active--; }
  };
  return { preview: bounded(preview), start: bounded(start), status: bounded(status), cancel: bounded(cancel), context, claim, apply, publicJob, cancelForRecovery };
}
module.exports = { createReprocess };
