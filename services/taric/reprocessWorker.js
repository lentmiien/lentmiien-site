const { fail } = require('../../utils/taricContracts');
const { errorStatus } = require('../../utils/taricDiagnostics');
const { query, id } = require('./service');
// Runs exclusively inside the existing worker's single Mongo inference lease.
// All ownership, reconciliation and cleanup primitives are shared with benchmark
// execution. Reprocessing records never enter benchmark or API usage collections.
function createReprocessWorker(service, controls) {
  const { Reprocess, Request, Review } = service.models;
  const { fence, hold, trackSession, closeSession, correlatedIdle, report, signal, nextCaseReserveMs } = controls;
  const local = service.reprocess;
  const date = () => new Date(service.now());
  async function saveCase(r, index, c, holder) {
    await fence(holder);
    const saved = await Reprocess.updateOne({ _id: r._id, owner: r.owner, fence: holder }, { $set: { [`cases.${index}`]: c } }).exec();
    if (!saved.matchedCount) fail('INTERRUPTED');
  }
  async function finish(r, holder, state, error = null) {
    await fence(holder);
    const fresh = await query(Reprocess.findById(r._id));
    for (let i = 0; i < fresh.cases.length; i++) {
      const c = fresh.cases[i];
      if (c.state === 'planned') await saveCase(r, i, { ...c, state: state === 'cancelled' ? 'cancelled' : 'not_attempted', error }, holder);
    }
    await Reprocess.updateOne({ _id: r._id, fence: holder }, { $set: { state, error, active: false, fence: null, finishedAt: date() } }).exec();
  }
  async function releaseClaim(r, c) {
    await Review.updateOne({ _id: c.id, request: c.id, owner: r.owner, revision: c.reviewRevision,
      localRevision: c.localRevision || { $in: [0, null] }, localClaim: r._id }, { $set: { localClaim: null } }).exec();
  }
  async function applyRecorded(r, c) {
    try { return { ...c, appliedRevision: await local.apply(r, c), state: c.result ? 'enriched' : 'model_failed' }; }
    catch (e) {
      if (e.code !== 'STALE') throw e;
      await releaseClaim(r, c);
      return { ...c, state: 'stale', error: 'STALE' };
    }
  }
  async function process(initial, holder) {
    let r = initial; let session = null; let unsafe = false; let endReason = 'finished'; let terminal = null;
    try {
      await local.context(r);
      for (let index = 0; index < r.cases.length; index++) {
        await fence(holder);
        r = await query(Reprocess.findById(r._id));
        await local.context(r);
        let c = r.cases[index];
        if (c.state !== 'planned') continue;
        if (session?.hardExpiresAt && session.hardExpiresAt - service.now() <= nextCaseReserveMs) { endReason = 'hard_lifetime'; break; }
        if (session && await Request.exists({ state: 'queued', active: true }).maxTimeMS(2000).exec()) { endReason = 'interactive_priority'; break; }
        c = { ...c, state: 'claiming', correlationId: id(), startedAt: date(), dispatched: false };
        await saveCase(r, index, c, holder);
        try { await local.claim(r, c); }
        catch (e) {
          if (!['STALE', 'NOT_FOUND'].includes(e.code)) throw e;
          await saveCase(r, index, { ...c, state: 'stale', error: 'STALE' }, holder); continue;
        }
        // Facts, source/feedback/review bindings and planned attempt are already
        // durable BEFORE any admission or generation. A lost response is never retried.
        c = { ...c, state: 'running' };
        await saveCase(r, index, c, holder);
        let result = null; let diagnostics = null; let transportStatus = null; let error = null;
        try {
          if (!session) {
            session = await service.warmSessions.open({ correlationId: id(), signal: signal(), adapter: r.configuration.admission.adapter });
            await trackSession(holder, session);
            await Reprocess.updateOne({ _id: r._id, fence: holder }, { $set: { sessionId: session.id }, $inc: { sessionCount: 1 } }).exec();
          } else await service.warmSessions.renew(session, signal());
          await fence(holder);
          await local.context(await query(Reprocess.findById(r._id)));
          c = { ...c, dispatched: true, sessionId: session.id };
          await saveCase(r, index, c, holder);
          result = await service.warmSessions.generate(session, { descriptive_name: c.source.inputs.descriptive_name,
            full_item_name: c.evidence.facts.name, specs: c.evidence.facts.specifications || '', hs_code: c.source.inputs.input_hs_code },
          r.configuration.catalog.codes, r.configuration.maxTokens, { signal: signal(), correlationId: c.correlationId,
            onDiagnostics: v => { diagnostics = v; }, onTransport: v => { transportStatus = errorStatus(v); } });
        } catch (e) {
          error = report(e, 'local_reprocess.case'); transportStatus = errorStatus(e.transport) || transportStatus;
          if (!session && ['ADMISSION_UNCERTAIN', 'INFERENCE_UNCERTAIN', 'RECOVERY_REQUIRED'].includes(error)) unsafe = true;
        }
        c = { ...c, state: 'recorded', result, diagnostics, error, errorStatus: transportStatus, finishedAt: date() };
        await saveCase(r, index, c, holder);
        c = await applyRecorded(r, c);
        await saveCase(r, index, c, holder);
        if (!session || !c.dispatched) {
          terminal = { state: error === 'CANCELLED' ? 'cancelled' : unsafe ? 'recovery_required' : 'failed', error };
          endReason = error === 'ADMISSION_BUSY' ? 'admission_busy' : 'failed'; break;
        }
        const proof = await correlatedIdle(session, c.correlationId, holder);
        if (proof !== 'continue') {
          let closed = false;
          try { closed = (await closeSession(holder, session)).idle; } catch (e) { report(e, 'local_reprocess.reconcile'); }
          session = null;
          if (!closed && proof !== 'rotate') { unsafe = true; terminal = { state: 'recovery_required', error: 'RECOVERY_REQUIRED' }; }
          endReason = proof === 'rotate' ? 'remote_reclaimed' : 'uncertain_operation'; break;
        }
      }
    } catch (e) {
      const error = report(e, 'local_reprocess');
      unsafe = ['INTERRUPTED', 'INFERENCE_UNCERTAIN', 'ADMISSION_UNCERTAIN', 'RECOVERY_REQUIRED'].includes(error);
      terminal = { state: unsafe ? 'recovery_required' : error === 'CANCELLED' ? 'cancelled' : 'failed', error };
      endReason = error === 'CANCELLED' ? 'cancelled' : 'failed';
    } finally {
      if (session) {
        try { if (!(await closeSession(holder, session)).idle) unsafe = true; }
        catch (e) { report(e, 'local_reprocess.close'); unsafe = true; }
      }
      if (unsafe) { await hold(holder, 'RECOVERY_REQUIRED'); terminal = { state: 'recovery_required', error: 'RECOVERY_REQUIRED' }; }
    }
    await fence(holder);
    r = await query(Reprocess.findById(r._id));
    // If a storage/authority failure interrupted completion, leave the fence for
    // restart recovery. Never clear an unrecorded operation's durable claim.
    if (r.cases.some(c => ['claiming', 'running', 'recorded'].includes(c.state))) {
      await hold(holder, 'RECOVERY_REQUIRED'); return;
    }
    await Reprocess.updateOne({ _id: r._id, fence: holder }, { $inc: { [`sessionEndReasons.${endReason}`]: 1 }, $set: { lastYieldAt: date() } }).exec();
    if (r.cancelRequested) terminal = { state: 'cancelled', error: 'CANCELLED' };
    if (terminal) return finish(r, holder, terminal.state, terminal.error);
    if (r.cases.every(c => c.state !== 'planned')) return finish(r, holder, 'complete');
    await Reprocess.updateOne({ _id: r._id, fence: holder }, { $set: { fence: null, state: 'running' } }).exec();
  }
  async function orphan(holder) {
    const runs = await query(Reprocess.find({ active: true, fence: { $type: 'string' } }).limit(8));
    let uncertain = false;
    for (const r of runs) {
      // The successor holds the only inference lease, but has no right to invent
      // a Gateway owner capability. Retain completed facts and stop this job.
      await Reprocess.updateOne({ _id: r._id, fence: r.fence }, { $set: { fence: holder } }).exec();
      for (let index = 0; index < r.cases.length; index++) {
        let c = r.cases[index];
        if (!['claiming', 'running', 'recorded'].includes(c.state)) continue;
        if (['claiming', 'running'].includes(c.state)) {
          uncertain = uncertain || c.state === 'running';
          c = { ...c, result: null, error: c.dispatched ? 'INFERENCE_UNCERTAIN' : 'INTERRUPTED', finishedAt: date() };
        }
        c = await applyRecorded(r, c);
        await saveCase(r, index, c, holder);
      }
      await finish(r, holder, 'recovery_required', 'INTERRUPTED');
    }
    if (uncertain) await hold(holder, 'RECOVERY_REQUIRED');
    return runs.length;
  }
  return { process, orphan };
}
module.exports = { createReprocessWorker };
