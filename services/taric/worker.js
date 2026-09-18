const logger = require('../../utils/logger');
const { TaricError, fail } = require('../../utils/taricContracts');
const { hash, lexical } = require('../../utils/taricProtocol');
const { errorStatus } = require('../../utils/taricDiagnostics');
const { configuration, runtimeReady } = require('./gate');
const { query, id, SCOPES } = require('./service');
function createWorker(service, { authorizeAdmin = async () => false, ready = () => true,
  leaseMs = 180000, batchCases = 8, batchMs = 120000, recoveryMs = 10000 } = {}) {
  const { Control, Request, Run, Benchmark, Attempt } = service.models;
  let timer; let busy = false; let stopped = true; let lastBootstrapWarning = 0; let controller;
  const date = () => new Date(service.now());
  async function fence(holder) {
    const lease = await query(Control.findOne({ _id: 'inference', holder, until: { $gt: date() } }));
    if (!lease || stopped || !ready() || controller?.signal.aborted) fail('INTERRUPTED');
  }
  async function hold(holder, reason) {
    await Control.updateOne({ _id: 'inference', holder }, { $set: { blocked: true, reason }, $inc: { epoch: 1 } }).exec();
    logger.error('TARIC inference held: prove Gateway idle before explicit recovery', { category: 'taric', metadata: { code: reason } });
  }
  async function trackSession(holder, session) {
    await fence(holder);
    const saved = await Control.updateOne({ _id: 'inference', holder, until: { $gt: date() } },
      { $set: { sessionId: session.id, recoveryPhase: 'owned' } }).exec();
    if (!saved.matchedCount) fail('INTERRUPTED');
  }
  async function closeSession(holder, session) {
    const result = await service.warmSessions.close(session);
    if (result.idle) await Control.updateOne({ _id: 'inference', holder, sessionId: session.id },
      { $set: { sessionId: null, recoveryPhase: null } }).exec();
    return result;
  }
  async function finishRequest(r, holder, update) {
    await fence(holder);
    await Request.updateOne({ _id: r._id, state: 'running', fence: holder }, { $set: {
      ...update, active: false, finishedAt: date() } }).exec();
  }
  function report(error, operation) {
    const code = error instanceof TaricError ? error.code : 'STORAGE_FAILED';
    logger.warning('TARIC background operation requires follow-up', { category: 'taric', metadata: { operation, code, transport: errorStatus(error.transport) } });
    return code;
  }
  async function processRequest(r, holder) {
    let evidence = null; let diagnostics = null; let session = null;
    try {
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      const selected = await service.checkAdmission(r);
      const { test, ...request } = r.input;
      evidence = await service.evidence.resolve(request);
      await fence(holder);
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      await service.checkAdmission(r);
      const row = { descriptive_name: request.descriptive_name, full_item_name: evidence.facts.name,
        specs: evidence.facts.specifications || '', hs_code: request.input_hs_code };
      session = await service.warmSessions.open({ correlationId: id(), signal: controller.signal, adapter: r.admission.adapter });
      await trackSession(holder, session);
      const correlationId = id();
      const persisted = await Request.updateOne({ _id: r._id, state: 'running', fence: holder },
        { $set: { sessionId: session.id, correlationId } }).exec();
      if (!persisted.matchedCount) fail('INTERRUPTED');
      await fence(holder);
      const result = await service.warmSessions.generate(session, row,
        (test ? selected.settings.testCatalog : selected.settings.catalog).codes,
        selected.settings.maxTokens, { signal: controller.signal, correlationId,
          onDiagnostics: test ? value => { diagnostics = value; } : undefined });
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      await service.checkAdmission(r);
      result.warnings = result.taric_code.startsWith(request.input_hs_code) ? [] : ['input_hs_prefix_mismatch'];
      await finishRequest(r, holder, { state: 'complete', evidence, diagnostics, result, error: null });
    } catch (e) {
      const error = report(e, 'request');
      if (!session && error === 'INFERENCE_UNCERTAIN') await hold(holder, error);
      await finishRequest(r, holder, { state: error === 'INTERRUPTED' ? 'interrupted' : 'failed', result: null,
        evidence, diagnostics: r.input.test === true ? diagnostics : null, errorStatus: errorStatus(e.transport), error });
    } finally {
      if (session) {
        try { if (!(await closeSession(holder, session)).idle) await hold(holder, 'RECOVERY_REQUIRED'); }
        catch (e) { report(e, 'request.session.close'); await hold(holder, 'RECOVERY_REQUIRED'); }
      }
    }
  }
  async function runContext(r) {
    if (r.cancelRequested || r.deadline <= date()) fail(r.cancelRequested ? 'CANCELLED' : 'INTERRUPTED');
    if (!await authorizeAdmin(r.actor)) fail('FORBIDDEN');
    const settings = await service.settings();
    const benchmark = await query(Benchmark.findById(r.benchmark));
    if (!settings?.enabled || !benchmark || hash(configuration(settings, r.adapter, service.version())) !== r.fingerprint
      || hash(benchmark.policy) !== hash(r.policy) || benchmark.cases.length !== r.requestedCount) fail('STALE');
    if (benchmark.version > 0 && (!runtimeReady(r.configuration.runtime, service.now())
      || benchmark._id !== settings.currentBenchmark || !benchmark.releaseEligible)) fail('RELEASE_CLOSED');
    return { settings, benchmark };
  }
  async function pause(r, holder, error) {
    // Lost owners leave claims for the successor to reconcile; they cannot mark a
    // run inactive and strand an unrecorded attempt.
    if (!await query(Control.findOne({ _id: 'inference', holder, until: { $gt: date() } }))) return;
    await Run.updateOne({ _id: r._id, fence: holder }, { $set: { state: 'recovery_required',
      recoveryRequired: true, active: false, passed: false, error, fence: null } }).exec();
  }
  async function record(r, holder, attempt) {
    await fence(holder);
    const actualCount = r.actualCount + 1;
    const exact = r.exact + (attempt.exact ? 1 : 0);
    const invalid = r.invalid + (attempt.result ? 0 : 1);
    const saved = await Run.updateOne({ _id: r._id, fence: holder, actualCount: attempt.index,
      'currentAttempt.correlationId': attempt.correlationId }, { $set: {
      actualCount, exact, invalid, score: exact / r.requestedCount, passed: false, currentAttempt: null },
    $inc: { codeExact: attempt.proposalExact ? 1 : 0, errorCount: attempt.error ? 1 : 0, catalogRejected: attempt.error === 'CATALOG_REJECTED' ? 1 : 0 },
    $push: { results: attempt } }).exec();
    if (!saved.matchedCount) fail('INTERRUPTED');
    return query(Run.findById(r._id));
  }
  async function correlatedIdle(session, correlationId, holder) {
    const until = service.now() + recoveryMs;
    // Count and wall deadline both bound recovery even with an injected frozen clock.
    for (let count = 0; count < 10; count++) {
      await fence(holder);
      try {
        const state = await service.warmSessions.status(session, correlationId, controller.signal);
        if (state.reclaimed) return 'rotate';
        if (state.idle && state.terminal && state.correlated) return 'continue';
        if (state.missing) break;
      } catch (e) { report(e, 'session.status'); break; }
      if (service.now() >= until) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(1, until - service.now()))));
    }
    return false;
  }
  async function processRun(initial, holder) {
    let r = initial; let session = null; let unsafe = false;
    const started = service.now();
    try {
      if (r.dispatchContract !== 'owned-v1') { await pause(r, holder, 'RECOVERY_REQUIRED'); return; }
      let context = await runContext(r);
      if (r.actualCount < r.requestedCount) {
        if (r.warmSessionRequired !== true) {
          await pause(r, holder, 'RECOVERY_REQUIRED'); return;
        }
        session = await service.warmSessions.open({ correlationId: id(), signal: controller.signal, adapter: r.adapter });
        await trackSession(holder, session);
        await Run.updateOne({ _id: r._id, fence: holder }, { $set: { sessionId: session.id, sessionHardExpiresAt: new Date(session.hardExpiresAt || service.now() + 900000) } }).exec();
      }
      for (let count = 0; count < (session ? batchCases : 1); count++) {
        await fence(holder);
        r = await query(Run.findById(r._id));
        context = await runContext(r);
        const { settings, benchmark } = context;
        const index = r.actualCount;
        if (index >= benchmark.cases.length) break;
        if (session && count > 0) {
          if (service.now() - started >= batchMs || (session.hardExpiresAt && session.hardExpiresAt - service.now() < 70000) || await Request.exists({ state: 'queued', active: true }).maxTimeMS(2000).exec()) break;
          await service.warmSessions.renew(session, controller.signal);
        }
        const c = benchmark.cases[index];
        const claim = { _id: id(), run: r._id, index, fence: holder, correlationId: id(),
          sessionId: session?.id || null, state: 'running', claimedAt: date(), startedAt: date(), inputHash: c.inputHash };
        // Unique (run,index) prevents duplicate inference after restart, even if the
        // process dies between this insert and updating the parent run.
        await Attempt.create(claim);
        const claimed = await Run.updateOne({ _id: r._id, fence: holder, actualCount: index, cancelRequested: false },
          { $set: { currentAttempt: { index, correlationId: claim.correlationId, claimedAt: claim.claimedAt, fence: holder } },
            $inc: { attemptedCount: 1 } }).exec();
        if (!claimed.matchedCount) {
          await Attempt.updateOne({ _id: claim._id, state: 'running' }, { $set: { state: 'not_dispatched', finishedAt: date(), error: 'CANCELLED' } }).exec();
          fail('CANCELLED');
        }
        let result = null; let error = null; let diagnostics = null; let transportStatus = null;
        try {
          const options = { signal: controller.signal, correlationId: claim.correlationId, onDiagnostics: value => { diagnostics = value; } };
          const codes = (benchmark.version === 0 ? settings.testCatalog : settings.catalog).codes;
          if (benchmark.version > 0) await service.transport.verifyIdentity(r.adapter, r.configuration.runtime);
          await fence(holder);
          result = await service.warmSessions.generate(session, c.input, codes, settings.maxTokens, options);
          if (benchmark.version > 0) await service.transport.verifyIdentity(r.adapter, r.configuration.runtime);
        } catch (e) { error = report(e, 'benchmark.case'); transportStatus = errorStatus(e.transport); }
        const attempt = { ...claim, state: 'finished', finishedAt: date(), result, diagnostics, error,
          errorStatus: transportStatus, exact: result?.taric_code === c.target,
          proposalExact: (diagnostics?.proposal?.taric_code || result?.taric_code) === c.target,
          lexicalSimilarity: result && c.summary ? lexical(result.description, c.summary) : null };
        // Save the attempt before any uncertainty/authority/cancel transition.
        await Attempt.updateOne({ _id: claim._id, fence: holder, state: 'running' }, { $set: attempt }).exec();
        r = await record(r, holder, attempt);
        // HTTP success alone is not permission to dispatch another operation.
        // Reconcile every persisted ID. Lost output is permanently a failed case.
        const proof = await correlatedIdle(session, claim.correlationId, holder);
        if (proof !== 'continue') {
          let closed = false;
          try { closed = (await closeSession(holder, session)).idle; }
          catch (e) { report(e, 'session.reconcile.close'); }
          session = null;
          if (!closed && proof !== 'rotate') {
            unsafe = true; await hold(holder, 'RECOVERY_REQUIRED'); await pause(r, holder, 'RECOVERY_REQUIRED'); return;
          }
          // Reclaimed session: finish this batch; next tick acquires FRESH admission.
          break;
        }
        // Revocation/cancel stops NEXT case; the performed attempt remains history.
        await runContext(r);
      }
    } catch (e) {
      const error = report(e, 'benchmark');
      unsafe = ['INFERENCE_UNCERTAIN', 'INTERRUPTED', 'RECOVERY_REQUIRED'].includes(error);
      if (unsafe) { await hold(holder, error); await pause(r, holder, error); }
      else {
        await Run.updateOne({ _id: r._id, fence: holder }, { $set: { state: error === 'CANCELLED' ? 'cancelled' : 'failed',
          active: false, passed: false, error, fence: null, finishedAt: date() } }).exec();
      }
    } finally {
      if (session) {
        try { if (!(await closeSession(holder, session)).idle) unsafe = true; }
        catch (e) { report(e, 'session.close'); unsafe = true; }
        if (unsafe) { await hold(holder, 'RECOVERY_REQUIRED'); await pause(r, holder, 'RECOVERY_REQUIRED'); }
      }
    }
    await fence(holder);
    r = await query(Run.findById(r._id));
    if (r.fence !== holder) return;
    const complete = r.actualCount === r.requestedCount;
    const passed = complete && !r.errorCount && !unsafe && !r.cancelRequested && r.score >= r.policy.minExact && r.invalid / r.requestedCount <= r.policy.maxInvalid;
    await Run.updateOne({ _id: r._id, fence: holder, cancelRequested: false }, { $set: {
      fence: null, active: !complete, state: complete ? 'complete' : 'running', passed,
      ...(complete ? { finishedAt: date() } : {}) } }).exec();
    await Run.updateOne({ _id: r._id, fence: holder, cancelRequested: true }, { $set: {
      state: 'cancelled', active: false, passed: false, fence: null, finishedAt: date() } }).exec();
  }
  async function orphanRuns(holder) {
    const runs = await query(Run.find({ active: true, fence: { $type: 'string' } }).limit(8));
    for (const r of runs) {
      const attempt = await query(Attempt.findOne({ run: r._id, index: r.actualCount }));
      if (attempt) {
        const terminal = attempt.state === 'finished' ? attempt : { ...attempt, state: 'finished', finishedAt: date(),
          result: null, error: 'INFERENCE_UNCERTAIN', exact: false };
        await Attempt.updateOne({ _id: attempt._id, state: 'running' }, { $set: terminal }).exec();
        await Run.updateOne({ _id: r._id, fence: r.fence, actualCount: attempt.index }, { $push: { results: terminal },
          $set: { currentAttempt: null, attemptedCount: attempt.index + 1, score: (r.exact + (terminal.exact ? 1 : 0)) / r.requestedCount },
          $inc: { actualCount: 1, codeExact: terminal.proposalExact ? 1 : 0, catalogRejected: terminal.error === 'CATALOG_REJECTED' ? 1 : 0, exact: terminal.exact ? 1 : 0, invalid: terminal.result ? 0 : 1, errorCount: terminal.error ? 1 : 0 } }).exec();
      }
      await Run.updateOne({ _id: r._id, fence: r.fence }, { $set: { state: 'recovery_required', active: false,
        passed: false, error: 'INTERRUPTED', recoveryRequired: true, fence: null } }).exec();
    }
    if (runs.length) await hold(holder, 'INTERRUPTED');
    return runs.length;
  }
  async function tick() {
    if (busy || stopped || !ready()) return;
    busy = true; const holder = id(); let held = false; let heartbeat; let renewing = false; let renewal = Promise.resolve();
    controller = new AbortController();
    try {
      const lease = await query(Control.findOneAndUpdate({ _id: 'inference', blocked: { $ne: true }, until: { $lte: date() } },
        { $set: { holder, until: new Date(service.now() + leaseMs) } }, { returnDocument: 'after' }));
      if (!lease) {
        if (service.now() - lastBootstrapWarning > 3600000) {
          const control = await query(Control.findById('inference'));
          if (!control) { lastBootstrapWarning = service.now(); logger.warning('TARIC worker awaits explicit bootstrap/index initialization', { category: 'taric' }); }
        }
        return;
      }
      held = true;
      heartbeat = setInterval(() => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        renewal = (async () => {
          try {
            if (stopped || !ready()) fail('INTERRUPTED');
            const renewed = await Control.updateOne({ _id: 'inference', holder, until: { $gt: date() } },
              { $set: { until: new Date(service.now() + leaseMs) } }).exec();
            if (!renewed.matchedCount) fail('INTERRUPTED');
          } catch (e) { controller.abort(); report(e, 'lease.renew'); }
          finally { renewing = false; }
        })();
      }, Math.max(1, Math.floor(leaseMs / 3)));
      heartbeat.unref?.();
      const orphans = await Request.updateMany({ state: 'running', active: true }, { $set: { state: 'interrupted', active: false,
        result: null, error: 'INTERRUPTED', finishedAt: date() } }).exec();
      const orphanCount = await orphanRuns(holder);
      if (lease.sessionId) { await hold(holder, 'RECOVERY_REQUIRED'); return; }
      if (orphans.modifiedCount || orphanCount) { if (orphans.modifiedCount) await hold(holder, 'INTERRUPTED'); return; }
      const request = await query(Request.findOneAndUpdate({ state: 'queued', active: true },
        { $set: { state: 'running', fence: holder } }, { returnDocument: 'after', sort: { createdAt: 1, _id: 1 } }));
      if (request) return await processRequest(request, holder);
      const run = await query(Run.findOneAndUpdate({ active: true, state: { $in: ['pending', 'running'] }, fence: null },
        { $set: { state: 'running', fence: holder } }, { returnDocument: 'after', sort: { createdAt: 1, _id: 1 } }));
      if (run) await processRun(run, holder);
    } catch (e) { report(e, 'worker'); }
    finally {
      clearInterval(heartbeat); await renewal;
      if (held) {
        try { await Control.updateOne({ _id: 'inference', holder }, { $set: { until: new Date(0) } }).exec(); }
        catch (e) { report(e, 'lease.release'); }
      }
      busy = false;
    }
  }
  function start() { if (!stopped) return; stopped = false; timer = setInterval(tick, 1000); timer.unref?.(); }
  function stop() { stopped = true; clearInterval(timer); controller?.abort(); }
  return { start, stop, tick };
}
module.exports = { createWorker };
