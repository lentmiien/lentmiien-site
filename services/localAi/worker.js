const { randomUUID } = require('crypto');
const { CAP, problem, digest, windowAt, runWire, safeReplacement } = require('./policy');
const { config } = require('./gateway');
const { importImage } = require('./artifacts');
const { ownerIdentity, previousCoordinatorTerminated } = require('./coordinator');
const { CodexActivity } = require('./codexActivity');
const { isDatabaseReady } = require('../../middleware/databaseReadiness');
const logger = require('../../utils/logger');
const { errorDiagnostic, operation: diagnosticOperation } = require('./diagnostics');
const { Sessions } = require('./sessions');
const { verifyReceipt, rejected, resolvedRetry } = require('./admissionRetry');
const TERMINAL = new Set(['drained', 'needs_review', 'stopped', 'expired']);
const OP_TERMINAL = new Set(['succeeded', 'failed', 'interrupted', 'deferred', 'outcome_unknown']);
const LEASE_MS = 90000;
class Worker {
  constructor(service, { ready = isDatabaseReady, now = () => new Date(), terminated = previousCoordinatorTerminated } = {}) {
    this.service = service; this.db = service.db; this.gateway = service.gateway;
    this.ready = ready; this.now = now; this.terminated = terminated; this.id = randomUUID(); this.running = false; this.busy = false; this.fence = null; this.warnings = new Map(); this.sessions = new Sessions(this); this.heartbeatBusy = false;
    this.authorityChain = Promise.resolve();
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
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 25000); this.heartbeatTimer.unref?.();
    this.tick();
  }
  stop() { this.running = false; this.fence = null; clearInterval(this.timer); clearInterval(this.heartbeatTimer); }
  async heartbeat() {
    if (this.heartbeatBusy || !this.running || !this.ready() || this.fence === null) return;
    this.heartbeatBusy = true;
    try {
      // Extending Mongo authority never advances the per-tick fence or Gateway generation.
      await this.guard();
      await this.sessions.sync();
    } catch (error) {
      this.warn('Local AI session heartbeat requires reconciliation', { code: error.code || 'heartbeat_failed' });
    } finally { this.heartbeatBusy = false; }
  }
  withAuthority(action) {
    // Serialize only authority reads/writes, never Gateway calls or reconciliation.
    // The independent heartbeat must still renew during long scheduler work.
    const result = this.authorityChain.then(action);
    this.authorityChain = result.catch(() => {});
    return result;
  }
  guard() {
    return this.withAuthority(async () => {
      if (!this.running || !this.ready() || this.fence === null) throw problem('coordinator_fenced', 409);
      const fence = this.fence;
      const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', holder: this.id, fence, leaseUntil: { $gt: this.now() } },
        { $set: { leaseUntil: new Date(+this.now() + LEASE_MS) } }, { returnDocument: 'after' }).lean();
      if (!control || !this.running || !this.ready() || this.fence !== fence) {
        if (this.fence === fence) this.fence = null;
        throw problem('coordinator_fenced', 409);
      }
      return control;
    });
  }
  acquire() {
    return this.withAuthority(async () => {
      if (!this.running || !this.ready()) return null;
      const previous = await this.db.Control.findById('scheduler').lean();
      if (previous.holder !== this.id) {
        if (+previous.leaseUntil > +this.now()) return null;
        // Gateway takeover still requires proof that the prior process terminated.
        if (!await this.terminated(previous)) {
          this.warn('Local AI coordinator takeover blocked until old process is fenced', { code: 'coordinator_termination_unproven' });
          return null;
        }
      }
      const identity = await ownerIdentity();
      if (!this.running || !this.ready()) return null;
      const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', fence: previous.fence, holder: previous.holder },
        { $set: { holder: this.id, ...identity, leaseUntil: new Date(+this.now() + LEASE_MS) }, $inc: { fence: 1, ownershipEpoch: previous.holder === this.id ? 0 : 1 } }, { returnDocument: 'after' }).lean();
      if (!control || !this.running || !this.ready()) return null;
      this.fence = control.fence;
      return control;
    });
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
      operation = 'Control.acquire';
      const control = await this.acquire();
      if (!control) return;
      operation = 'coordinator.reconcile';
      await this.service.reconcileCapacity();
      await this.repairClaims();
      for (const intake of control.intakes || []) {
        if (await this.db.Job.exists({ _id: intake.id }) || await this.terminated(intake)) {
          await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence },
            { $pull: { intakes: { id: intake.id } }, $inc: { queueRevision: 1 } });
        }
      }
      // Projection and result repair continue outside windows and with dispatch disabled.
      await new CodexActivity({ gateway: this.gateway }).reconcileProven();
      const session = await this.sessions.sync();
      if (control.activeRun) {
        const run = await this.db.Run.findOneAndUpdate({ _id: control.activeRun }, { $set: { fence: this.fence } }, { returnDocument: 'after' }).lean();
        if (!run) throw problem('active_manifest_missing', 503);
        if (session?.pendingRun?.id === run._id && run.state === 'building') {
          for (const id of session.pendingRun.jobs) {
            await this.guard();
            await this.db.Job.updateOne({ _id: id, state: 'queued', runId: null }, { $set: { runId: run._id, state: 'claimed', reason: null }, $inc: { version: 1 } });
          }
          const fresh = await this.sessions.read(session._id);
          await this.sessions.save(fresh, { lastSequence: session.pendingRun.sequence, pendingRun: null });
        }
        await this.drive(run);
        if (session && !(await this.guard()).activeRun) {
          if (config().enabled) await this.dispatchSession(await this.sessions.read(session._id));
          await this.sessions.sync();
        }
        await this.reconcileDetached();
        return;
      }
      if (!session) await this.reconcileDetached();
      if (!config().enabled) { if (session) await this.reconcileDetached(); return; }
      operation = 'coordinator.dispatch';
      await this.dispatchSession(session);
      if (session) { await this.sessions.sync(); await this.reconcileDetached(); }
    } catch (error) {
      if (error.code !== 'coordinator_fenced') {
        this.warn('Local AI coordinator requires retry or review', { code: Number.isInteger(error.code) ? error.code : 'coordinator_failure', ...errorDiagnostic(error, operation) });
        if (this.fence !== null && this.ready()) await this.controlSet({ reason: error.code || 'storage_failure', nextAttemptAt: new Date(+this.now() + 10000), retry: null }).catch(() => {});
      }
    } finally { this.busy = false; }
  }
  async dispatchSession(existing) {
    const current = await this.guard();
    let session = existing?.state === 'released' ? null : existing;
    const w = windowAt(this.now());
    const manual = current.manualDeadline && +current.manualDeadline > +this.now();
    if (!session && current.fallbackSession) {
      const original = await this.sessions.read(current.fallbackSession);
      if (original && ((original.acquire.mode === 'manual' && !manual)
        || (original.acquire.mode === 'automatic' && original.requestId !== w.key))) {
        const suppressedWindow = original.acquire.mode === 'manual' ? windowAt(new Date(original.acquire.not_after)).key : original.requestId;
        await this.controlSet({ fallbackSession: null, suppressedWindow });
        current.fallbackSession = null; current.suppressedWindow = suppressedWindow;
      }
    }
    if (session && (session.state !== 'held' || session.intent)) return;
    if (!session && !manual && (!config().auto || !w.inside || current.suppressedWindow === w.key || +current.manualStoppedUntil > +this.now())) return;
    if (current.intakeSealed || (!session && current.nextAttemptAt && +current.nextAttemptAt > +this.now())) return;
    // Never adopt or modify accepted legacy wire bodies. Reconcile them first.
    if (!session && await this.db.Run.exists({ state: { $ne: 'closed' }, sessionId: null, putStarted: true })) {
      const legacy = await this.db.Run.findOneAndUpdate({ state: { $ne: 'closed' }, sessionId: null, putStarted: true }, { $set: { fence: this.fence } }, { sort: { createdAt: 1 }, returnDocument: 'after' }).lean();
      await this.controlSet({ reason: 'legacy_run_reconciliation_required', activeRun: legacy._id });
      await this.drive(legacy); return;
    }
    const due = { slot: { $type: 'number' }, state: 'queued', runId: null, $or: [{ blockedUntil: null }, { blockedUntil: { $lte: this.now() } }],
      ...(!config().media ? { schemaVersion: { $ne: 2 } } : {}),
      ...(manual ? {} : { nextAttemptAt: { $lte: this.now() } }) };
    // Observe revision BEFORE inspecting work. Any concurrent intake invalidates drain CAS.
    const revision = current.queueRevision;
    const candidates = await this.db.Job.find(due).sort({ createdAt: 1, slot: 1 }).limit(1000).lean();
    const groups = new Map();
    for (const job of candidates) {
      const key = `${job.schemaVersion || 1}:${job.affinity}`;
      if (!groups.has(key)) groups.set(key, []);
      if (groups.get(key).length < Math.max(1, Math.min(8, current.cohortLimit || 8))) groups.get(key).push(job);
    }
    let selected = null;
    const caps = groups.size ? await this.gateway.capabilities() : null;
    if (caps) {
      try { require('./sessions').capability(caps); }
      catch (error) {
        if (!session) throw error;
        const fresh = await this.sessions.read(session._id);
        await this.sessions.save(fresh, { intent: { action: 'stop', mode: 'finish_current', reason: 'exclusive_sessions_unavailable' } });
        return;
      }
    }
    for (let group of groups.values()) {
      try {
        const viable = [];
        for (const job of group) {
          await this.guard();
          try { await this.service.validateFrozen(job); viable.push(job); }
          catch (error) {
            if (![401, 403, 409, 413, 422].includes(error.status)) throw error;
            await this.jobSet(job, { state: 'needs_review', reason: error.code || 'input_policy_rejected' });
            this.warn('Local AI input requires review before dispatch', { code: error.code || 'input_policy_rejected', jobId: job._id });
          }
        }
        group = viable;
        if (!group.length) continue;
        if (group[0].schemaVersion === 2) {
          if (group[0].type === 'comfy.workflow') await this.service.workflows.negotiate();
          group = await this.fitCohort(group, caps, true);
          for (const job of group) { await this.guard(); await this.service.inputs.stage(job); }
          group = await this.fitCohort(group, caps, false);
        }
        selected = group; break;
      } catch (error) {
        if (error.code === 'coordinator_fenced') throw error;
        this.warn('Local AI affinity blocked; checking other queued groups', { code: error.code || 'cohort_preparation_failed' });
        for (const job of group) if (job.state === 'queued' && job.reason !== 'cohort_preparation_blocked') {
          await this.jobSet(job, { reason: 'cohort_preparation_blocked' });
        }
      }
    }
    if (!selected) {
      if (!session) {
        if (manual && !groups.size) await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence, queueRevision: revision, intakes: { $size: 0 }, activeSession: null }, { $set: { manualRequestedAt: null, manualDeadline: null, fallbackSession: null, suppressedWindow: w.key, reason: 'queue_drained' } });
        return;
      }
      const fresh = await this.sessions.read(session._id);
      if (groups.size && !fresh.noProgressSince) {
        await this.sessions.save(fresh, { noProgressSince: this.now(), blockedChecks: 1, reason: 'all_eligible_groups_blocked' }); return;
      }
      if (groups.size && +this.now() - +fresh.noProgressSince < 60000 && (fresh.blockedChecks || 0) < 6) {
        await this.sessions.save(fresh, { blockedChecks: (fresh.blockedChecks || 0) + 1 }); return;
      }
      const blocked = groups.size || await this.db.Job.exists({ state: { $in: ['queued', 'needs_review'] }, slot: { $type: 'number' }, runId: null });
      await this.sessions.drain(fresh, blocked ? 'eligible_work_blocked' : 'queue_drained', revision);
      return;
    }
    if (!session) {
      const liveControl = await this.guard();
      if ((liveControl.stopIntent && (manual || liveControl.suppressedWindow === w.key)) || (manual && !liveControl.manualDeadline)) return;
      session = await this.sessions.create(await this.guard(), manual ? 'manual' : 'automatic');
      if (session) session = await this.sessions.sync();
      if (!session || session.state !== 'held' || session.intent) return;
    }
    const before = await this.guard();
    if (before.stopIntent?.sessionId === session._id || before.stopIntent?.requestId === session.requestId) return;
    await this.sessions.authority({ sessionId: session._id });
    // Persist sequence AND run identity before creating the separate run document.
    // Repair reuses this exact plan after any crash between standalone writes.
    let fresh = await this.sessions.read(session._id);
    if (!fresh.pendingRun) {
      const remote = await this.gateway.request('GET', `/batch/sessions/${session._id}`);
      if (require('./sessions').remaining(remote, this.gateway.monotonic()) < 5000) return;
      await this.sessions.save(fresh, { pendingRun: { id: randomUUID(), sequence: fresh.lastSequence + 1,
        jobs: selected.map(j => j._id), wire: { mode: fresh.acquire.mode, not_before: remote.server_now,
          deadline: remote.hard_deadline, session_id: fresh._id, session_sequence: fresh.lastSequence + 1 } }, reason: null, noProgressSince: null, blockedChecks: 0 });
    }
    const plan = fresh.pendingRun;
    await this.db.Run.updateOne({ _id: plan.id }, { $setOnInsert: { wire: plan.wire, fence: this.fence,
      sessionId: fresh._id, sessionSequence: plan.sequence, state: 'building', manifest: [] } }, { upsert: true });
    await this.guard();
    const activated = await this.db.Control.updateOne({ _id: 'scheduler', holder: this.id, fence: this.fence, activeRun: null,
      activeSession: fresh._id, intakeSealed: false, stopIntent: before.stopIntent || null },
    { $set: { activeRun: plan.id, reason: 'session_held', nextAttemptAt: null, retry: null } });
    if (!activated.matchedCount) return;
    for (const id of plan.jobs) {
      await this.guard();
      await this.db.Job.updateOne({ _id: id, state: 'queued', runId: null }, { $set: { runId: plan.id, state: 'claimed', reason: null }, $inc: { version: 1 } });
    }
    fresh = await this.sessions.read(fresh._id);
    await this.sessions.save(fresh, { lastSequence: plan.sequence, pendingRun: null });
    const run = await this.db.Run.findById(plan.id).lean();
    await this.drive(run);
  }
  async fitCohort(jobs, caps, includeUploads) {
    const capacity = await this.gateway.capacity();
    if (!Number.isSafeInteger(capacity.available_bytes) || !Number.isSafeInteger(capacity.remaining_records)) throw problem('gateway_capacity_unavailable', 503);
    let bytes = 1048576, uploadHeadroom = false;
    const inputs = new Set(), selected = [];
    for (const job of jobs) {
      const reserve = job.type === 'comfy.workflow' ? job.source.reservationBytes : caps.schema2?.operation_reservation_bytes;
      if (!Number.isSafeInteger(reserve) || reserve < 35717120) throw problem('gateway_capacity_unavailable', 503);
      let extra = reserve;
      if (includeUploads) {
        const refs = job.type === 'comfy.workflow' ? Object.values(job.request.bindings) : job.request.messages.flatMap(m => m.images || []);
        for (const ref of refs) if (!inputs.has(ref.artifact_id)) {
          const record = await this.service.inputs.resolve({ ownerId: job.ownerId, tokenId: job.tokenId }, ref);
          let receipt;
          try { receipt = await this.gateway.input(record._id); } catch (error) { if (error.status !== 404) throw error; }
          if (receipt) require('./inputs').verifyReceipt(record, receipt);
          else {
            extra += record.descriptor.bytes + 4096;
            if (!uploadHeadroom) { extra += 2 * 33554432 + 65536; uploadHeadroom = true; }
          }
          inputs.add(ref.artifact_id);
        }
      }
      if (bytes + extra > capacity.available_bytes || selected.length + 1 >= capacity.remaining_records) break;
      bytes += extra; selected.push(job);
    }
    if (!selected.length) throw problem('gateway_cohort_storage_quota', 507);
    return selected;
  }
  async drive(run) {
    const intent = (await this.guard()).stopIntent;
    if (run.sessionId && (intent?.sessionId === run.sessionId || (await this.sessions.read(run.sessionId))?.intent) && !run.putStarted) {
      if (run.state === 'building') {
        const claimed = await this.db.Job.find({ runId: run._id }).lean();
        await this.runSet(run, { manifest: claimed.map(job => ({ jobId: job._id })) });
      }
      await this.finishRun(run, { status: 'stopped', operations: [] }); return;
    }
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
      await this.runSet(run, { manifest, ...(media ? { wire: { ...run.wire, schema_version: 2, operation_ids: manifest.map(e => e.id), ...(manifest.some(e => e.body.type === 'comfy.workflow') ? { operation_budgets: manifest.map(e => ({ operation_id: e.id, type: e.body.type, ...(e.body.type === 'comfy.workflow' ? { workflow_id: e.body.request.workflow_id, template_sha256: e.body.request.template_sha256 } : {}) })) } : {}) } } : {}), state: 'uploading' });
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
      // Held work retains short stage retries, never an old unowned 30-minute pause.
      const controlRetry = run.sessionId && +control.nextAttemptAt - +this.now() > 10000 ? 0 : +control.nextAttemptAt || 0;
      const retryAt = Math.max(+new Date(run.admission?.nextAttemptAt || 0), controlRetry);
      if (retryAt > +this.now()) return;
      // Persist uncertain submission BEFORE sending. A lost response or process
      // never permits retiming, retirement, or a replacement execution identity.
      const nextAttemptAt = new Date(+this.now() + (run.sessionId ? 10000 : 1800000));
      await this.runSet(run, { putStarted: true, admission: { state: 'uncertain', nextAttemptAt } });
      try {
        await this.guard();
        remote = await diagnosticOperation('gateway.run_admission', async () => {
          const receipt = await this.gateway.putRun(run._id, run.wire, await this.sessions.authority(run));
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
      await this.guard(); remote = await diagnosticOperation('gateway.run_stop', async () => this.gateway.stop(run._id, stopMode, await this.sessions.authority(run, { stopping: true })));
      await this.runSet(run, { stopConfirmed: true, state: 'stopping' });
    }
    if (run.sessionId && TERMINAL.has(remote.status)) {
      // Persist terminal execution evidence first. GPU ownership can close before
      // potentially slow private downloads, publication or ACK reconciliation.
      await this.runSet(run, { remote: { ...remote, operations: remote.operations.map(({ result, ...op }) => op) } });
      for (const entry of run.manifest) {
        const op = remote.operations.find(o => o.id === entry.id);
        if (!op) continue;
        const job = await this.db.Job.findById(entry.jobId).lean();
        this.verifyOperation(job, op);
        await this.jobSet(job, { attempts: job.attempts.map(a => a.id === op.id ? { ...a, remote: op } : a),
          ...(op.status === 'succeeded' && !job.published ? { state: 'collecting' } : {}) });
      }
      await this.finishRun(run, remote); return;
    }
    await this.reconcileRun(run, remote);
    if (TERMINAL.has(remote.status)) {
      await this.finishRun(run, remote); return;
    }
    if (stopMode) return;
    if (run.sessionId && (await this.sessions.read(run.sessionId))?.state !== 'held') return;
    if (+new Date(run.wire.deadline) <= +this.now()) return; // Gateway enforces cutoff independently.
    if (remote.status !== 'open') return;
    // Disabling dispatch leaves open manifests unsealed, while polling/publication continues.
    if (!config().enabled || (!config().auto && run.wire.mode === 'automatic')) return;
    const control = await this.guard();
    if (control.nextAttemptAt && +control.nextAttemptAt > +this.now()
      && (!run.sessionId || +control.nextAttemptAt - +this.now() <= 10000)) return;
    try {
      for (const entry of run.manifest) {
        const job = await this.db.Job.findById(entry.jobId).lean();
        await this.service.validateFrozen(job);
        if (!remote.operations.some(op => op.id === entry.id)) {
          await this.guard(); await diagnosticOperation('gateway.operation_upload', async () => this.gateway.putOperation(run._id, entry.id, entry.body, await this.sessions.authority(run)));
          if (run.noProgressSince) await this.runSet(run, { noProgressSince: null, blockedChecks: 0 });
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
          if (op.schema_version !== 2 || !/^[a-f0-9]{64}$/.test(op.request_digest) || (entry.body.type !== 'comfy.workflow' && op.request_digest !== digest(entry.body))) throw problem('operation_digest_mismatch', 409);
          return { operation_id: entry.id, request_digest: op.request_digest };
        }) };
      }
      if (seal) {
        if (run.seal && digest(run.seal) !== digest(seal)) throw problem('operation_digest_mismatch', 409);
        if (!run.seal) await this.runSet(run, { seal });
        seal = run.seal;
      }
      await diagnosticOperation('gateway.run_seal', async () => this.gateway.start(run._id, seal, await this.sessions.authority(run)));
      await this.runSet(run, { state: 'sealed' });
    } catch (error) {
      if (run.sessionId && run.wire.schema_version === 2 && error.status === 507) {
        if (!run.noProgressSince) await this.runSet(run, { noProgressSince: this.now(), blockedChecks: 1, reason: 'cohort_storage_blocked' });
        else if (+this.now() - +run.noProgressSince >= 60000 || (run.blockedChecks || 0) >= 6) {
          await this.runSet(run, { stopMode: 'cancel_active', state: 'stop_pending', reason: 'cohort_storage_blocked' });
          await this.gateway.stop(run._id, 'cancel_active', await this.sessions.authority(run, { stopping: true }));
        } else await this.runSet(run, { blockedChecks: (run.blockedChecks || 0) + 1 });
        return;
      }
      if (['session_dispatch_fenced', 'session_changed', 'batch_gateway_epoch_changed'].includes(error.code)) return;
      if ([401, 403, 409, 413, 422].includes(error.status) || (error.status === 507 && run.wire.schema_version !== 2)) {
        this.warn('Local AI operation acceptance rejected; run stop required', { code: 'operation_acceptance_rejected', ...errorDiagnostic(error, 'gateway.operation_upload') });
        // Seal nothing after partial quota/validation rejection. Stop intent is durable first.
        await this.runSet(run, { stopMode: 'cancel_active', state: 'stop_pending', reason: error.status === 507 ? 'cohort_storage_blocked' : error.code || 'acceptance_rejected' });
        await this.guard(); await diagnosticOperation('gateway.run_stop', async () => this.gateway.stop(run._id, 'cancel_active', await this.sessions.authority(run, { stopping: true })));
        await this.controlSet({ nextAttemptAt: new Date(+this.now() + 1800000), reason: error.code, retry: null, ...(error.status === 507 && !run.sessionId ? { cohortLimit: Math.max(1, Math.floor(run.manifest.length / 2)) } : {}) });
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
  verifyOperation(job, op) {
    if (op.logical_job_id !== job._id || !job.attempts.some(a => a.id === op.id)) throw problem('gateway_operation_mismatch', 503);
    const previous = job.attempts.find(a => a.id === op.id)?.remote;
    if (job.type === 'comfy.workflow' && previous?.result && (previous.result_digest !== op.result_digest || digest(previous.result) !== digest(op.result))) throw problem('gateway_result_changed', 409);
  }
  async reconcileOperation(job, op) {
    this.verifyOperation(job, op);
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
            } else result = job.type === 'comfy.workflow' ? await require('./outputs').collect(this.gateway, this.db, job, op) : await importImage(this.gateway, job, op);
          }
          if (job.type === 'comfy.workflow') {
            require('./outputs').manifest(job, op);
            if (result.resultDigest !== op.result_digest || result.manifestDigest !== digest(op.result)) throw problem('gateway_result_changed', 409);
            for (const artifact of result.artifacts) await require('./outputs').read(artifact);
          }
          await this.service.sourceAccess(job);
          await this.jobSet(job, { result, state: 'succeeded', reason: null });
          await this.service.project(job);
          await this.jobSet(job, { published: true });
        } catch (error) {
          if (error.code === 'coordinator_fenced') throw error;
          const collecting = job.type === 'comfy.workflow' && (error.status >= 500 || /^Mongo/.test(error.name || '') || Number.isInteger(error.code) || ['ENOENT', 'ENOSPC', 'EIO', 'EPERM'].includes(error.code));
          await this.jobSet(job, { state: collecting ? 'collecting' : 'needs_review', reason: error.code || 'publication_failed' });
          this.warn('Local AI result retained for publication review', { jobId: job._id, code: error.code || 'publication_failed' });
          return;
        }
      }
      if (job.type === 'comfy.workflow' && op.integrity_error) { await this.jobSet(job, { state: 'needs_review', reason: op.integrity_error }); return; }
      if (!job.acknowledged) {
        if (typeof op.result_digest !== 'string' || !op.result_digest) { await this.jobSet(job, { reason: 'result_digest_missing' }); return; }
        await this.service.sourceAccess(job);
        if (job.type === 'comfy.workflow') for (const artifact of job.result.artifacts) await require('./outputs').read(artifact);
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
        await this.jobSet(job, { runId: null, ...(!['succeeded', 'failed', 'needs_review', 'collecting'].includes(job.state) ? { state: 'needs_review', reason: 'closed_run_requires_operation_reconciliation' } : {}) });
      }
    }
    if (run.reason === 'cohort_storage_blocked') await this.db.Job.updateMany({ _id: { $in: run.manifest.map(e => e.jobId) }, state: 'queued', runId: null }, { $set: { blockedUntil: new Date(+this.now() + 1800000), reason: 'cohort_storage_blocked' }, $inc: { version: 1 } });
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
    const jobs = await this.db.Job.find({ runId: null, $or: [{ state: { $in: ['needs_review', 'collecting'] } }, { state: 'succeeded', $or: [{ acknowledged: false }, { slot: { $type: 'number' } }] }, { 'source.conversationId': { $exists: true }, state: { $in: ['queued', 'cancelled'] } }] }).sort({ reconciledAt: 1, createdAt: 1 }).limit(20).lean();
    for (const job of jobs) {
      await this.guard();
      const latest = job.attempts.at(-1);
      if (latest && ['needs_review', 'collecting', 'succeeded'].includes(job.state)) {
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
  async manage(actor, action, requestKey) {
    await this.service.principal(actor.ownerId, null, CAP.manage);
    await this.db.Control.updateOne({ _id: 'scheduler' }, { $setOnInsert: { leaseUntil: new Date(0), fence: 0 } }, { upsert: true });
    if (action === 'start') {
      if (!config().enabled) throw problem('batch_dispatch_disabled', 503);
      const existing = await this.db.Control.findById('scheduler').lean();
      if (!requestKey && (existing.activeSession || existing.activeRun || (existing.manualDeadline && +existing.manualDeadline > +this.now()))) return existing;
      if (requestKey !== undefined && !require('./policy').ID.test(requestKey)) throw problem('invalid_idempotency_key');
      const requestId = digest([actor.ownerId, requestKey || randomUUID()]);
      await this.db.SessionRequest.updateOne({ _id: requestId }, { $setOnInsert: { ownerId: actor.ownerId,
        requestedAt: this.now(), localDeadline: new Date(runWire('manual', this.now()).deadline) } }, { upsert: true });
      let request = await this.db.SessionRequest.findById(requestId).lean();
      if (request.accepted || existing.manualRequestId === requestId || existing.activeSession || existing.activeRun
        || (existing.manualDeadline && +existing.manualDeadline > +this.now())) {
        await this.db.SessionRequest.updateOne({ _id: requestId }, { $set: { accepted: true } });
        return existing;
      }
      if (+request.localDeadline <= +this.now()) throw problem('manual_budget_expired', 409);
      const caps = await this.gateway.capabilities(); require('./sessions').capability(caps);
      const serverNow = Date.parse(caps.server_now), timing = caps._timing;
      if (!timing || timing.rtt > 2000 || !Number.isFinite(serverNow)) throw problem('gateway_clock_uncertain', 503);
      const serverWindow = windowAt(new Date(serverNow));
      const cutoff = +serverWindow.end > serverNow ? +serverWindow.end : +serverWindow.end + 86400000;
      const gatewayDeadline = new Date(Math.min(serverNow + Math.min(18000000, +request.localDeadline - +this.now()), cutoff) - timing.rtt - 1000);
      if (!request.gatewayDeadline) await this.db.SessionRequest.updateOne({ _id: requestId, gatewayDeadline: null }, { $set: { gatewayDeadline } });
      request = await this.db.SessionRequest.findById(requestId).lean();
      const updated = await this.db.Control.findOneAndUpdate({ _id: 'scheduler', activeRun: null, activeSession: null,
        manualRequestId: existing.manualRequestId || null, manualDeadline: existing.manualDeadline || null, stopRevision: existing.stopRevision || 0 },
      { $set: { manualRequestId: requestId, manualRequestedAt: request.requestedAt,
        manualDeadline: request.localDeadline, manualGatewayDeadline: request.gatewayDeadline,
        stopIntent: null, fallbackSession: null, manualStoppedUntil: null, intakeSealed: false, drainIntent: null, nextAttemptAt: null, retry: null } }, { returnDocument: 'after' }).lean();
      await this.db.SessionRequest.updateOne({ _id: requestId }, { $set: { accepted: true } });
      return updated || this.db.Control.findById('scheduler').lean();
    }
    if (!['finish_current', 'cancel_active'].includes(action)) throw problem('invalid_action');
    // Persist suppression and run-scoped stop intent in one document. Repairing the
    // Run projection is optional; a crash between writes cannot lose the stop.
    const beforeStop = await this.db.Control.findById('scheduler').lean();
    const stoppedWindow = windowAt(new Date(Math.max(+this.now(), +beforeStop.manualDeadline || 0))).key;
    const control = await this.db.Control.findOneAndUpdate({ _id: 'scheduler' }, [{ $set: {
      stopRevision: { $add: [{ $ifNull: ['$stopRevision', 0] }, 1] }, suppressedWindow: stoppedWindow, manualStoppedUntil: '$manualDeadline', manualRequestedAt: null, manualDeadline: null,
      stopIntent: { sessionId: '$activeSession', requestId: '$manualRequestId', runId: '$activeRun', mode: action === 'cancel_active' ? 'cancel_active' : {
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
