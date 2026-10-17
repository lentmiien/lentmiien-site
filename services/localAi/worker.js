const { randomUUID } = require('crypto');
const { CAP, problem, digest, windowAt, runWire, safeReplacement } = require('./policy');
const { config } = require('./gateway');
const { importImage } = require('./artifacts');
const { ownerIdentity, previousCoordinatorTerminated } = require('./coordinator');
const { CodexActivity } = require('./codexActivity');
const { isDatabaseReady } = require('../../middleware/databaseReadiness');
const logger = require('../../utils/logger');
const { errorDiagnostic, operation: diagnosticOperation } = require('./diagnostics');
const { boundedRunWire } = require('./clock');
const { verifyReceipt, rejected, resolvedRetry } = require('./admissionRetry');
const TERMINAL = new Set(['drained', 'needs_review', 'stopped', 'expired']);
const OP_TERMINAL = new Set(['succeeded', 'failed', 'interrupted', 'deferred', 'outcome_unknown']);
const LEASE_MS = 90000;
class Worker {
  constructor(service, { ready = isDatabaseReady, now = () => new Date(), terminated = previousCoordinatorTerminated } = {}) {
    this.service = service; this.db = service.db; this.gateway = service.gateway;
    this.ready = ready; this.now = now; this.terminated = terminated; this.id = randomUUID(); this.running = false; this.busy = false; this.fence = null; this.warnings = new Map();
  }
  warn(message, metadata) {
    const key = `${metadata.code}:${metadata.operation || ''}:${metadata.reasonClass || ''}:${metadata.reasonCode || ''}:${metadata.mongoCode || ''}:${metadata.systemCode || ''}:${metadata.jobId || ''}`;
    if (Date.now() - (this.warnings.get(key) || 0) < 300000) return;
    this.warnings.set(key, Date.now());
    logger.warning(message, { category: 'local_ai', metadata });
  }
  start() {
    if (this.running) return;
    this.running = true;
    if (config().enabled && !this.gateway.configured()) logger.error('Local AI batching enabled without dedicated Gateway credentials', { category: 'local_ai' });
    this.timer = setInterval(() => this.tick(), 10000); this.timer.unref?.();
    this.tick();
  }
  stop() { this.running = false; this.fence = null; clearInterval(this.timer); }
  async guard() {
    if (!this.running || !this.ready() || this.fence === null) throw problem('coordinator_fenced', 409);
    const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', holder: this.id, fence: this.fence, leaseUntil: { $gt: this.now() } },
      { $set: { leaseUntil: new Date(+this.now() + LEASE_MS) } }, { returnDocument: 'after' }).lean();
    if (!control) { this.fence = null; throw problem('coordinator_fenced', 409); }
    return control;
  }
  async controlSet(set) {
    await this.guard();
    const result = await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence, leaseUntil: { $gt: this.now() } }, { $set: set });
    if (!result.matchedCount) throw problem('coordinator_fenced', 409);
  }
  async runSet(run, set) {
    await this.guard();
    const result = await this.db.Run.updateOne({ _id: run._id, fence: this.fence }, { $set: set });
    if (!result.matchedCount) throw problem('coordinator_fenced', 409);
    Object.assign(run, set);
  }
  async jobSet(job, set) {
    await this.guard();
    const updated = await this.db.Job.findOneAndUpdate({ _id: job._id, version: job.version, runId: job.runId }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' }).lean();
    if (!updated) throw problem('job_changed', 409);
    Object.assign(job, updated);
  }
  async tick() {
    if (!this.running || this.busy || !this.ready() || !this.gateway.configured()) return;
    this.busy = true;
    let operation = 'initialize';
    try {
      await this.service.initialize();
      operation = 'Control.upsert';
      await this.db.Control.updateOne({ _id: 'scheduler' }, { $setOnInsert: { leaseUntil: new Date(0), fence: 0 } }, { upsert: true });
      operation = 'Control.read';
      const previous = await this.db.Control.findById('scheduler').lean();
      if (previous.holder !== this.id) {
        if (+previous.leaseUntil > +this.now()) return;
        // The v1 Gateway has no coordinator fence token. Never steal a lease from
        // a paused/live process: it could still send a late seal. Require OS proof.
        operation = 'coordinator.termination_check';
        if (!await this.terminated(previous)) {
          this.warn('Local AI coordinator takeover blocked until old process is fenced', { code: 'coordinator_termination_unproven' });
          return;
        }
      }
      operation = 'coordinator.identity';
      const identity = await ownerIdentity();
      operation = 'Control.acquire';
      const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', fence: previous.fence, holder: previous.holder },
        { $set: { holder: this.id, ...identity, leaseUntil: new Date(+this.now() + LEASE_MS) }, $inc: { fence: 1 } }, { returnDocument: 'after' }).lean();
      if (!control) return;
      this.fence = control.fence;
      operation = 'coordinator.reconcile';
      await this.service.reconcileCapacity();
      await this.repairClaims();
      // Projection and result repair continue outside windows and with dispatch disabled.
      await new CodexActivity({ gateway: this.gateway }).reconcileProven();
      if (control.activeRun) {
        const run = await this.db.Run.findOneAndUpdate({ _id: control.activeRun }, { $set: { fence: this.fence } }, { returnDocument: 'after' }).lean();
        if (!run) throw problem('active_manifest_missing', 503);
        await this.drive(run);
        await this.reconcileDetached();
        return;
      }
      await this.reconcileDetached();
      if (!config().enabled) return;
      operation = 'coordinator.dispatch';
      const current = await this.guard();
      const w = windowAt(this.now());
      const manual = current.manualDeadline && +current.manualDeadline > +this.now();
      if (!manual && (!config().auto || !w.inside || current.suppressedWindow === w.key)) return;
      const due = { slot: { $type: 'number' }, state: 'queued', runId: null, ...(manual ? {} : { nextAttemptAt: { $lte: this.now() } }) };
      const first = await this.db.Job.findOne(due).sort({ createdAt: 1, slot: 1 }).lean();
      if (!first) { await this.controlSet({ manualRequestedAt: null, manualDeadline: null, reason: 'queue_drained' }); return; }
      if (current.nextAttemptAt && +current.nextAttemptAt > +this.now()) return;
      const readiness = await this.gateway.readiness();
      if (!(readiness.healthy && readiness.idle && readiness.idle_proven)) {
        await this.controlSet({ readiness, reason: 'gateway_not_proven_idle', nextAttemptAt: new Date(+this.now() + 1800000) }); return;
      }
      operation = 'gateway.admission_clock';
      let { capabilities: caps, clock } = await this.gateway.admissionClock();
      if (caps.protocol !== 'durable-local-ai' || caps.version !== 1 || !caps.enabled || !caps.constraints?.seal_required) throw problem('gateway_protocol_unavailable', 503);
      // Oldest affinity gets a bounded cohort; other affinities retain their age for fairness.
      let selected = await this.db.Job.find({ ...due, affinity: first.affinity }).sort({ createdAt: 1, slot: 1 }).limit(Math.max(1, Math.min(8, current.cohortLimit || 8))).lean();
      if (first.schemaVersion === 2) {
        // Stage complete known immutable inputs before reserving a generation
        // cohort. Failed/lost transfers cannot start execution.
        const prepared = [];
        for (const job of selected) {
          await this.guard();
          try { await this.service.validateFrozen(job); }
          catch (error) {
            if (![401, 403, 409, 413, 422].includes(error.status)) throw error;
            await this.jobSet(job, { state: 'needs_review', reason: error.code || 'input_policy_rejected' });
            this.warn('Local AI frozen media job requires review before export', { jobId: job._id, code: error.code || 'input_policy_rejected' });
            continue; // No run/manifest exists yet; no declared cohort is shrunk.
          }
          await this.service.inputs.stage(job); prepared.push(job);
        }
        selected = prepared;
        if (!selected.length) return;
        const capacity = await this.gateway.capacity();
        const reservation = caps.schema2?.operation_reservation_bytes;
        if (!Number.isSafeInteger(reservation) || reservation < 35717120
          || !Number.isSafeInteger(capacity.available_bytes) || !Number.isSafeInteger(capacity.remaining_records)) throw problem('gateway_capacity_unavailable', 503);
        const count = Math.min(selected.length, capacity.remaining_records - 1, Math.floor((capacity.available_bytes - 1048576) / reservation));
        if (count < 1) throw problem('gateway_cohort_storage_quota', 507);
        selected = selected.slice(0, count);
        // Uploads/catalog probes can take minutes: never reuse their old Date.
        ({ capabilities: caps, clock } = await this.gateway.admissionClock());
      }
      const wire = boundedRunWire(manual ? 'manual' : 'automatic', this.now(), clock, this.gateway.monotonic(), current.manualDeadline, current.manualGatewayDeadline);
      if (manual && !current.manualGatewayDeadline) {
        // Anchor before creating the first immutable wire, even if we crash here.
        await this.guard();
        const anchored = await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence,
          manualDeadline: current.manualDeadline, manualRequestedAt: current.manualRequestedAt, manualGatewayDeadline: null },
        { $set: { manualGatewayDeadline: new Date(wire.deadline) } });
        if (!anchored.matchedCount) return;
      }
      const run = { _id: randomUUID(), wire, fence: this.fence, state: 'building', manifest: [] };
      await this.guard(); await this.db.Run.create(run);
      await this.guard();
      const activated = await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence, activeRun: null,
        ...(manual ? { manualDeadline: current.manualDeadline } : { suppressedWindow: { $ne: w.key } }) },
      { $set: { activeRun: run._id, readiness, reason: null, nextAttemptAt: null, retry: null } });
      if (!activated.matchedCount) return; // A concurrent stop won; the unexported run has no claims.

      for (const job of selected) {
        await this.guard();
        try { await this.service.sourceAccess(job); } catch (error) {
          if (![401, 403].includes(error.status)) throw error;
          await this.jobSet(job, { state: 'needs_review', reason: 'source_access_revoked' }); continue;
        }
        await this.db.Job.updateOne({ _id: job._id, version: job.version, state: 'queued', runId: null },
          { $set: { runId: run._id, state: 'claimed' }, $inc: { version: 1 } });
      }
      await this.drive(run);
    } catch (error) {
      if (error.code !== 'coordinator_fenced') {
        this.warn('Local AI coordinator requires retry or review', { code: Number.isInteger(error.code) ? error.code : 'coordinator_failure', ...errorDiagnostic(error, operation) });
        if (this.fence !== null && this.ready()) await this.controlSet({ reason: error.code || 'storage_failure', nextAttemptAt: new Date(+this.now() + 1800000), retry: null }).catch(() => {});
      }
    } finally { this.busy = false; }
  }
  async drive(run) {
    // Migrate an already persisted receipt without changing wire/manifest/IDs.
    // It proves admission only; fresh remote state still gates upload and seal.
    if (run.remote) await this.acceptRun(run, run.remote);
    if (run.state === 'building') {
      const jobs = await this.db.Job.find({ runId: run._id }).sort({ createdAt: 1, slot: 1 }).lean();
      const manifest = jobs.map(job => {
        const previous = job.attempts.filter(a => a.remote).at(-1);
        const body = { ...(job.schemaVersion === 2 ? { schema_version: 2 } : {}), logical_job_id: job._id, type: job.type, request: job.request };
        if (previous) body.retry_of = previous.id;
        return { jobId: job._id, id: randomUUID(), body };
      });
      const media = manifest.some(e => e.body.schema_version === 2);
      if (media && manifest.some(e => e.body.schema_version !== 2)) throw problem('mixed_schema_manifest', 503);
      await this.runSet(run, { manifest, ...(media ? { wire: { ...run.wire, schema_version: 2, operation_ids: manifest.map(e => e.id) } } : {}), state: 'uploading' });
    }
    // Manifest is immutable after this point, including optional request-field presence.
    for (const entry of run.manifest) {
      const job = await this.db.Job.findById(entry.jobId).lean();
      if (!job.attempts.some(a => a.id === entry.id)) {
        await this.jobSet(job, { attempts: [...job.attempts, { id: entry.id, runId: run._id, body: entry.body }], state: 'exporting' });
      }
    }
    let remote;
    try { remote = await diagnosticOperation('gateway.run_lookup', () => this.gateway.run(run._id)); }
    catch (error) {
      if (error.status !== 404) throw error;
      // 404 is not termination. Only an entirely unexported, expired manifest may be locally closed.
      if (+new Date(run.wire.deadline) <= +this.now()) {
        if (!run.putStarted) { await this.finishRun(run, { status: 'expired', operations: [] }); return; }
        const reason = run.admission?.state === 'rejected' ? 'rejected_run_bounds_expired' : 'remote_run_missing_after_deadline';
        this.warn('Local AI expired manifest retained pending remote evidence', { code: reason, operation: 'gateway.run_lookup', httpStatus: 404 });
        await this.runSet(run, { reason, state: 'needs_review' });
        await this.controlSet({ reason });
        for (const entry of run.manifest) {
          const job = await this.db.Job.findById(entry.jobId).lean();
          await this.jobSet(job, { state: 'needs_review', reason });
        }
        return;
      }
      if (run.admission?.state === 'accepted') throw problem('gateway_accepted_run_missing', 503);
      const control = await this.guard();
      if ((run.admission?.nextAttemptAt && +new Date(run.admission.nextAttemptAt) > +this.now())
        || (control.nextAttemptAt && +control.nextAttemptAt > +this.now())) return;
      // Persist uncertain submission BEFORE sending. A lost response or process
      // never permits retiming, retirement, or a replacement execution identity.
      const nextAttemptAt = new Date(+this.now() + 1800000);
      await this.runSet(run, { putStarted: true, admission: { state: 'uncertain', nextAttemptAt } });
      try {
        await this.guard();
        remote = await diagnosticOperation('gateway.run_admission', async () => {
          const receipt = await this.gateway.putRun(run._id, run.wire);
          verifyReceipt(run, receipt);
          return receipt;
        });
      } catch (failure) {
        const state = rejected(failure) ? 'rejected' : 'uncertain';
        await this.runSet(run, { admission: { state, reason: failure.code, httpStatus: failure.httpStatus, nextAttemptAt } });
        await this.controlSet({ reason: failure.code, nextAttemptAt,
          retry: { stage: 'run_admission', runId: run._id, reason: failure.code, nextAttemptAt } });
        this.warn('Local AI run admission deferred; immutable manifest retained', { code: 'run_admission_deferred', ...errorDiagnostic(failure, 'gateway.run_admission') });
        return;
      }
    }
    await this.acceptRun(run, remote);
    const scheduler = await this.guard();
    const latestRun = await this.db.Run.findById(run._id).lean();
    const stopMode = scheduler.stopIntent?.runId === run._id ? scheduler.stopIntent.mode : latestRun.stopMode;
    if (stopMode && !TERMINAL.has(remote.status)) {
      await this.runSet(run, { stopMode, state: 'stop_pending' });
      await this.guard(); remote = await diagnosticOperation('gateway.run_stop', () => this.gateway.stop(run._id, stopMode));
      await this.runSet(run, { stopConfirmed: true, state: 'stopping' });
    }
    await this.reconcileRun(run, remote);
    if (TERMINAL.has(remote.status)) {
      await this.finishRun(run, remote); return;
    }
    if (stopMode) return;
    if (+new Date(run.wire.deadline) <= +this.now()) return; // Gateway enforces cutoff independently.
    if (remote.status !== 'open') return;
    // Disabling dispatch leaves open manifests unsealed, while polling/publication continues.
    if (!config().enabled || (!config().auto && run.wire.mode === 'automatic')) return;
    const control = await this.guard();
    if (control.nextAttemptAt && +control.nextAttemptAt > +this.now()) return;
    try {
      for (const entry of run.manifest) {
        const job = await this.db.Job.findById(entry.jobId).lean();
        await this.service.validateFrozen(job);
        if (!remote.operations.some(op => op.id === entry.id)) {
          await this.guard(); await diagnosticOperation('gateway.operation_upload', () => this.gateway.putOperation(run._id, entry.id, entry.body));
        }
      }
      remote = await diagnosticOperation('gateway.seal_verification', () => this.gateway.run(run._id));
      verifyReceipt(run, remote);
      if (remote.operations.length !== run.manifest.length || !run.manifest.every(e => remote.operations.some(o => o.id === e.id && o.logical_job_id === e.jobId))) throw problem('manifest_incomplete', 503);
      for (const e of run.manifest) await this.service.validateFrozen(await this.db.Job.findById(e.jobId).lean());
      const beforeSeal = await this.guard();
      const fresh = await this.db.Run.findById(run._id).lean();
      if (fresh.stopMode || beforeSeal.stopIntent?.runId === run._id) return;
      let seal;
      if (run.wire.schema_version === 2) {
        seal = { operations: run.manifest.map(entry => {
          const op = remote.operations.find(o => o.id === entry.id);
          if (op.schema_version !== 2 || op.request_digest !== digest(entry.body)) throw problem('operation_digest_mismatch', 409);
          return { operation_id: entry.id, request_digest: op.request_digest };
        }) };
      }
      await diagnosticOperation('gateway.run_seal', () => this.gateway.start(run._id, seal));
      await this.runSet(run, { state: 'sealed' });
    } catch (error) {
      if ([401, 403, 409, 413, 422, 507].includes(error.status)) {
        this.warn('Local AI operation acceptance rejected; run stop required', { code: 'operation_acceptance_rejected', ...errorDiagnostic(error, 'gateway.operation_upload') });
        // Seal nothing after partial quota/validation rejection. Stop intent is durable first.
        await this.runSet(run, { stopMode: 'cancel_active', state: 'stop_pending', reason: error.code || 'acceptance_rejected' });
        await this.guard(); await diagnosticOperation('gateway.run_stop', () => this.gateway.stop(run._id, 'cancel_active'));
        await this.controlSet({ nextAttemptAt: new Date(+this.now() + 1800000), reason: error.code, retry: null, ...(error.status === 507 ? { cohortLimit: Math.max(1, Math.floor(run.manifest.length / 2)) } : {}) });
      } else throw error;
    }
  }
  async acceptRun(run, remote) {
    verifyReceipt(run, remote);
    if (run.admission?.state !== 'accepted') await this.runSet(run, { admission: { state: 'accepted', acceptedAt: this.now() } });
    const control = await this.guard();
    if (!resolvedRetry(control, run)) return;
    // Compare-and-set so an intervening stop or unrelated deferral wins.
    await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence,
      activeRun: run._id, reason: control.reason, nextAttemptAt: control.nextAttemptAt,
      retry: control.retry || null, stopIntent: control.stopIntent || null },
    { $set: { reason: null, nextAttemptAt: null, retry: null } });
  }
  async reconcileRun(run, remote) {
    await this.runSet(run, { remote: { ...remote, operations: remote.operations.map(({ result, ...op }) => op) } });
    for (const entry of run.manifest) {
      const op = remote.operations.find(o => o.id === entry.id);
      if (op) await this.reconcileOperation(await this.db.Job.findById(entry.jobId).lean(), op);
    }
  }
  async reconcileOperation(job, op) {
    if (op.logical_job_id !== job._id || !job.attempts.some(a => a.id === op.id)) throw problem('gateway_operation_mismatch', 503);
    const attempts = job.attempts.map(a => a.id === op.id ? { ...a, remote: op } : a);
    await this.jobSet(job, { attempts }); // Preserve successful but malformed evidence; never rerun it.
    if (op.status === 'succeeded') {
      if (!job.published) {
        try {
          await this.service.sourceAccess(job);
          let result = job.result;
          if (!result) {
            if (job.type === 'llm.chat') {
              const raw = op.result;
              if (raw?.done !== true || typeof raw.message?.content !== 'string' || !raw.message.content.trim()
                || (raw.message.tool_calls && (!Array.isArray(raw.message.tool_calls) || raw.message.tool_calls.length)) || Buffer.byteLength(JSON.stringify(raw)) > 2097152) throw problem('malformed_successful_text_result');
              result = { text: raw.message.content, ...(typeof raw.message.thinking === 'string' ? { thinking: raw.message.thinking } : {}) };
            } else result = await importImage(this.gateway, job, op);
          }
          await this.jobSet(job, { result, state: 'succeeded', reason: null });
          await this.service.project(job);
          await this.jobSet(job, { published: true });
        } catch (error) {
          if (error.code === 'coordinator_fenced') throw error;
          await this.jobSet(job, { state: 'needs_review', reason: error.code || 'publication_failed' });
          this.warn('Local AI result retained for publication review', { jobId: job._id, code: error.code || 'publication_failed' });
          return;
        }
      }
      if (!job.acknowledged) {
        if (typeof op.result_digest !== 'string' || !op.result_digest) { await this.jobSet(job, { reason: 'result_digest_missing' }); return; }
        await this.guard(); await this.gateway.ack(op.id, op.result_digest);
        await this.jobSet(job, { acknowledged: true });
      }
    } else if (op.status === 'outcome_unknown' || (OP_TERMINAL.has(op.status) && !safeReplacement(op))) {
      await this.jobSet(job, { state: 'needs_review', reason: 'remote_outcome_uncertain' });
    } else if (OP_TERMINAL.has(op.status)) {
      await this.jobSet(job, { state: op.status === 'failed' ? 'failed' : 'deferred', reason: op.error || op.status });
    } else if (!job.published) await this.jobSet(job, { state: job.runId ? op.status : 'needs_review', reason: job.runId ? null : 'remote_execution_unresolved' });
  }
  async finishRun(run, remote) {
    for (const entry of run.manifest) {
      const job = await this.db.Job.findById(entry.jobId).lean();
      const op = remote.operations.find(o => o.id === entry.id);
      // Absence is definitive only in a known, closed immutable run, not a 404 or timeout.
      if (!op) {
        await this.jobSet(job, { runId: null, state: job.attempts.length < 5 ? 'queued' : 'needs_review', reason: job.attempts.length < 5 ? 'not_accepted_before_run_closed' : 'attempt_limit_reached', nextAttemptAt: windowAt(this.now()).next });
      } else if (safeReplacement(op) && ['interrupted', 'deferred'].includes(op.status) && job.attempts.length < 5) {
        await this.jobSet(job, { runId: null, state: 'queued', nextAttemptAt: windowAt(this.now()).next });
      } else {
        await this.jobSet(job, { runId: null, ...(!['succeeded', 'failed', 'needs_review'].includes(job.state) ? { state: 'needs_review', reason: 'closed_run_requires_operation_reconciliation' } : {}) });
      }
    }
    await this.runSet(run, { state: 'closed' });
    await this.controlSet({ activeRun: null });
    await this.service.reconcileCapacity();
  }
  async repairClaims() {
    // A DB request issued by a terminated process may arrive late. Claims are
    // projections, not permission to export outside a frozen manifest.
    const jobs = await this.db.Job.find({ state: 'claimed', runId: { $ne: null } }).limit(20).lean();
    for (const job of jobs) {
      const run = await this.db.Run.findById(job.runId).lean();
      if (!run) {
        await this.jobSet(job, { state: 'needs_review', reason: 'claim_manifest_missing' });
      } else if (run.state !== 'building' && !run.manifest.some(entry => entry.jobId === job._id)) {
        await this.jobSet(job, { state: 'queued', runId: null, reason: 'unexported_claim_repaired' });
      }
    }
  }
  async reconcileDetached() {
    const jobs = await this.db.Job.find({ runId: null, $or: [{ state: 'needs_review' }, { state: 'succeeded', $or: [{ acknowledged: false }, { slot: { $type: 'number' } }] }, { 'source.conversationId': { $exists: true }, state: { $in: ['queued', 'cancelled'] } }] }).sort({ reconciledAt: 1, createdAt: 1 }).limit(20).lean();
    for (const job of jobs) {
      await this.guard();
      const latest = job.attempts.at(-1);
      if (latest && ['needs_review', 'succeeded'].includes(job.state)) {
        try {
          const op = await this.gateway.request('GET', `/batch/operations/${latest.id}`);
          await this.reconcileOperation(job, op);
          if (safeReplacement(op) && ['interrupted', 'deferred'].includes(op.status) && job.attempts.length < 5) {
            await this.jobSet(job, { state: 'queued', nextAttemptAt: windowAt(this.now()).next });
          }
        } catch (error) {
          if (error.code === 'coordinator_fenced') throw error;
          if (error.status !== 404) this.warn('Local AI operation reconciliation deferred', { jobId: job._id, code: error.code || 'storage_failure' });
        }
      } else {
        await this.service.project(job).catch(error => {
          if (![401, 403].includes(error.status)) throw error;
        });
      }
      await this.jobSet(job, { reconciledAt: this.now() });
    }
    await this.service.reconcileCapacity();
  }
  async manage(actor, action) {
    await this.service.principal(actor.ownerId, null, CAP.manage);
    await this.db.Control.updateOne({ _id: 'scheduler' }, { $setOnInsert: { leaseUntil: new Date(0), fence: 0 } }, { upsert: true });
    if (action === 'start') {
      if (!config().enabled) throw problem('batch_dispatch_disabled', 503);
      const updated = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', activeRun: null }, { $set: { manualRequestedAt: this.now(), manualDeadline: new Date(runWire('manual', this.now()).deadline), manualGatewayDeadline: null, nextAttemptAt: null, retry: null } }, { returnDocument: 'after' }).lean();
      if (!updated) throw problem('run_already_active', 409);
      return updated;
    }
    if (!['finish_current', 'cancel_active'].includes(action)) throw problem('invalid_action');
    // Persist suppression and run-scoped stop intent in one document. Repairing the
    // Run projection is optional; a crash between writes cannot lose the stop.
    const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler' }, [{ $set: {
      suppressedWindow: windowAt(this.now()).key, manualRequestedAt: null, manualDeadline: null,
      stopIntent: { runId: '$activeRun', mode: action === 'cancel_active' ? 'cancel_active' : {
        $cond: [{ $and: [{ $eq: ['$stopIntent.runId', '$activeRun'] }, { $eq: ['$stopIntent.mode', 'cancel_active'] }] }, 'cancel_active', 'finish_current'],
      } },
    } }], { returnDocument: 'after', updatePipeline: true }).lean();
    if (control.activeRun) {
      await this.db.Run.updateOne({ _id: control.activeRun }, { $set: { stopMode: control.stopIntent.mode, state: 'stop_pending' } });
    }
    return control;
  }
}
module.exports = { Worker, TERMINAL };
