const { randomUUID, randomBytes } = require('crypto');
const { problem, windowAt } = require('./policy');
const { ownerIdentity } = require('./coordinator');
const SAFE_MS = 1000;
const DEFER_MS = 1800000;
const headers = s => ({
  'X-Batch-Gateway-Epoch': s.gatewayEpoch,
  'X-Batch-Coordinator-Id': s.coordinatorId,
  'X-Batch-Session-Generation': String(s.generation),
  'X-Batch-Session-Token': s.token,
});
// Explicit allowlist: this DTO must never grow by spreading a journal document.
function publicSession(s) {
  if (!s) return null;
  return { id: s._id, state: s.state === 'held' && s.intent ? (s.intent.action === 'close' ? 'closing' : 'stopping') : s.state, reason: s.reason || null, mode: s.acquire?.mode,
    deadline: s.remote?.hard_deadline || s.acquire?.not_after, lease_deadline: s.remote?.lease_deadline,
    cohort: s.lastSequence, retry_stage: s.state === 'waiting' ? 'session_acquire' : s.state === 'recovery_required' ? 'session_resume' : null,
    next_attempt_at: s.nextAttemptAt, cleanup: s.remote?.cleanup,
    recovery_reason: s.remote?.recovery_reason, stopping_mode: s.intent?.mode };
}
function remaining(remote, monotonic) {
  const t = remote?._timing;
  if (!t || ![monotonic, t.received, remote.hard_remaining_seconds, remote.lease_remaining_seconds].every(Number.isFinite) || !Number.isFinite(t.rtt) || t.rtt < 0 || t.rtt > 2000 || monotonic < t.received || monotonic - t.received > 5000) return 0;
  return Math.min(remote.hard_remaining_seconds, remote.lease_remaining_seconds) * 1000 - t.rtt - (monotonic - t.received) - SAFE_MS;
}
function capability(caps) {
  if (caps?.protocol !== 'durable-local-ai' || caps.version !== 1 || !caps.enabled || !caps.constraints?.seal_required
    || caps.features?.exclusive_batch_sessions !== true || caps.session_capability_version !== 1
    || caps.sessions?.same_coordinator_resume !== true || caps.sessions?.resume_preserves_deadlines !== true
    || !caps.gateway_epoch) throw problem('exclusive_sessions_unavailable', 503);
}
class Sessions {
  constructor(worker) { this.worker = worker; this.db = worker.db; this.gateway = worker.gateway; this.syncing = null; }
  read(id) { return this.db.Session.findById(id).select('+token').lean(); }
  async save(s, set, unset = {}) {
    await this.worker.guard();
    const updated = await this.db.Session.findOneAndUpdate({ _id: s._id, version: s.version },
      { $set: set, $unset: unset, $inc: { version: 1 } }, { returnDocument: 'after' }).select('+token').lean();
    if (!updated) throw problem('session_changed', 409);
    Object.assign(s, updated); return s;
  }
  async mutate(s, action, key, body = {}, nextToken) {
    await this.worker.guard();
    const id = `${s._id}_${key}`;
    // Durable old authority is retained even after token rotation or a lost reply.
    await this.db.SessionMutation.updateOne({ _id: id }, { $setOnInsert: {
      sessionId: s._id, action, key, body, authority: headers(s), ...(nextToken ? { nextToken } : {}),
    } }, { upsert: true });
    const m = await this.db.SessionMutation.findById(id).select('+authority +nextToken').lean();
    if (m.action !== action || JSON.stringify(m.body) !== JSON.stringify(body)) throw problem('session_mutation_conflict', 409);
    await this.worker.guard();
    const response = await this.gateway.request(action === 'acquire' ? 'PUT' : 'POST',
      `/batch/sessions/${s._id}${action === 'acquire' ? '' : `/${action}`}`, m.body, false, false, false,
      { ...m.authority, 'X-Batch-Gateway-Epoch': s.gatewayEpoch, 'Idempotency-Key': m.key,
        ...(m.nextToken ? { 'X-Batch-Next-Session-Token': m.nextToken } : {}) });
    await this.worker.guard();
    await this.db.SessionMutation.updateOne({ _id: id }, { $set: { receipt: response, completedAt: this.worker.now() } });
    return response;
  }
  async create(control, mode) {
    const caps = await this.gateway.capabilities(); capability(caps);
    let t = caps._timing, now = Date.parse(caps.server_now);
    let retainedHard = Infinity, retainedRemaining = Infinity;
    if (control.fallbackSession) {
      const original = await this.gateway.request('GET', `/batch/sessions/${control.fallbackSession}`);
      if (original.state !== 'released' || original.cleanup !== 'verified' || original.gateway_epoch !== caps.gateway_epoch) throw problem('session_fallback_unverified', 409);
      t = original._timing; now = Date.parse(original.server_now);
      retainedHard = Date.parse(original.hard_deadline);
      retainedRemaining = original.hard_remaining_seconds * 1000 - (t?.rtt || 0) - SAFE_MS;
    }
    if (!t || t.rtt > 2000 || !Number.isFinite(now)) throw problem('gateway_clock_uncertain', 503);
    const w = windowAt(new Date(now));
    if (mode === 'automatic' && !w.inside) {
      // Site's wall clock may lead Gateway at 01:00. Retry at the actual boundary.
      await this.worker.controlSet({ nextAttemptAt: new Date(+this.worker.now() + Math.max(1000, +w.next - now)), reason: 'waiting_gateway_window' });
      return null;
    }
    const localRemaining = mode === 'manual' ? +control.manualDeadline - +this.worker.now() : 18000000;
    const cutoff = +w.end > now ? +w.end : +w.end + 86400000;
    const end = Math.min(now + Math.min(18000000, localRemaining, retainedRemaining) - t.rtt - SAFE_MS, cutoff - SAFE_MS, retainedHard,
      control.manualGatewayDeadline && mode === 'manual' ? +control.manualGatewayDeadline : Infinity);
    const seconds = Math.floor((end - now) / 1000);
    if (seconds < 5) {
      // End the exhausted logical request, including its fallback anchor. A later
      // automatic window may start a new request; it must not revive this one.
      await this.worker.controlSet({ fallbackSession: null, manualRequestedAt: null, manualDeadline: null,
        suppressedWindow: windowAt(this.worker.now()).key, reason: 'original_budget_expired' });
      return null;
    }
    const identity = await ownerIdentity();
    const s = { _id: randomUUID(), activeSlot: 1, coordinatorId: this.worker.id, ownershipEpoch: control.ownershipEpoch,
      ...identity, generation: 1, token: randomBytes(32).toString('hex'), gatewayEpoch: caps.gateway_epoch,
      acquire: { mode, max_duration_seconds: seconds, not_after: new Date(end).toISOString() }, acquireKey: randomUUID(),
      stopRevision: control.stopRevision || 0, requestId: mode === 'manual' ? control.manualRequestId : w.key, state: 'waiting', version: 0, lastSequence: 0, renewSequence: 0 };
    await this.worker.guard();
    await this.db.Session.create(s);
    // A crash here leaves the unique activeSlot as the authoritative candidate.
    await this.worker.controlSet({ activeSession: s._id, intakeSealed: false, drainIntent: null,
      ...(mode === 'manual' ? { manualGatewayDeadline: new Date(end) } : {}) });
    return s;
  }
  sync() {
    if (!this.syncing) this.syncing = this.reconcile().finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async reconcile() {
    const c = await this.worker.guard();
    let s = c.activeSession ? await this.read(c.activeSession) : await this.db.Session.findOne({ activeSlot: 1 }).select('+token').lean();
    if (!s) return null;
    if (!c.activeSession) await this.worker.controlSet({ activeSession: s._id });
    let remote;
    try { remote = await this.gateway.request('GET', `/batch/sessions/${s._id}`); }
    catch (error) {
      if (error.status !== 404 || s.remote) throw error;
      if (s.intent || c.stopRevision > s.stopRevision || c.stopIntent?.sessionId === s._id || (c.stopIntent && c.stopIntent.requestId === s.requestId)) {
        // A prior acquire can still be in flight. Replay it to settle acceptance,
        // then owned stop; a 404 alone never proves cancellation.
      } else if (s.nextAttemptAt && +s.nextAttemptAt > +this.worker.now()) return s;
      if ((s.intent || c.stopRevision > s.stopRevision || c.stopIntent?.sessionId === s._id || c.stopIntent?.requestId === s.requestId)
        && (['gpu_batch_session_busy', 'batch_session_unhealthy', 'batch_session_acquisition_deferred'].includes(s.reason) || !await this.db.SessionMutation.exists({ sessionId: s._id, action: 'acquire' }))) {
        await this.save(s, { state: 'released', reason: 'stopped_before_acquire' }, { activeSlot: 1 });
        await this.worker.controlSet({ activeSession: null, lastSession: publicSession(s), reason: 'stopped_before_acquire' });
        return s;
      }
      const caps = await this.gateway.capabilities(); capability(caps);
      await this.save(s, { gatewayEpoch: caps.gateway_epoch });
      try { remote = await this.mutate(s, 'acquire', s.acquireKey, s.acquire); }
      catch (failure) {
        if (failure.gatewayResponse && ['gpu_batch_session_busy', 'batch_session_unhealthy', 'batch_session_acquisition_deferred'].includes(failure.code)) {
          await this.save(s, { state: 'waiting', reason: failure.code, nextAttemptAt: new Date(+this.worker.now() + DEFER_MS) });
          return s;
        }
        if (failure.code === 'batch_session_deadline_elapsed') {
          await this.save(s, { state: 'released', reason: 'original_budget_expired' }, { activeSlot: 1 });
          await this.worker.controlSet({ activeSession: null, manualRequestedAt: null, manualDeadline: null, reason: 'original_budget_expired' });
          return s;
        }
        throw failure;
      }
    }
    // Complete lost replies using their exact persisted authority and key. GET
    // gives current state but cannot replace a mutation receipt (notably renew).
    s.gatewayEpoch = remote.gateway_epoch;
    const pending = await this.db.SessionMutation.find({ sessionId: s._id, completedAt: null, rejectedAt: null, action: { $ne: 'recover' } }).limit(16).lean();
    for (const m of pending) {
      try {
        remote = await this.mutate(s, m.action, m.key, m.body);
        if (m.action === 'resume') await this.save(s, { lastRenewedAt: null });
      } catch (error) {
        if (!['batch_session_expired', 'batch_session_released', 'batch_session_not_held', 'batch_session_resume_not_allowed', 'batch_session_recovery_incomplete'].includes(error.code)) throw error;
        await this.db.SessionMutation.updateOne({ _id: m._id }, { $set: { rejectedAt: this.worker.now() } });
      }
    }
    if (remote.id !== s._id) throw problem('session_receipt_mismatch', 503);
    await this.save(s, { remote, gatewayEpoch: remote.gateway_epoch, state: remote.state, nextAttemptAt: null,
      ...(['waiting', 'acquiring', 'recovery_required'].includes(s.state) && remote.state === 'held' ? { reason: null } : {}) });
    if (s.acquire.mode === 'manual' && remote.hard_deadline) {
      const anchored = +new Date(remote.hard_deadline);
      if (!c.manualGatewayDeadline || anchored < +c.manualGatewayDeadline) await this.worker.controlSet({ manualGatewayDeadline: new Date(anchored) });
    }
    if (remote.state === 'released' && remote.cleanup === 'verified') {
      const fallback = s.intent?.reason === 'restart_fallback' && remote.hard_remaining_seconds > 5;
      await this.save(s, { state: 'released', reason: s.intent?.reason || 'session_released' }, { activeSlot: 1 });
      await this.worker.controlSet({ activeSession: null, lastSession: publicSession(s), intakeSealed: false, drainIntent: null, nextAttemptAt: null,
        reason: s.intent?.reason || 'session_released', fallbackSession: fallback ? s._id : null,
        ...(!fallback ? { manualRequestedAt: null, manualDeadline: null, ...(s.acquire.mode === 'manual' ? { suppressedWindow: windowAt(this.worker.now()).key } : {}) } : {}) });
      return s;
    }
    const latest = await this.worker.guard();
    const stop = latest.stopIntent?.sessionId === s._id || latest.stopIntent?.requestId === s.requestId || latest.stopRevision > s.stopRevision;
    if (stop && (!s.intent || s.intent.stopRevision !== latest.stopRevision)) {
      const mode = s.intent?.mode === 'cancel_active' ? 'cancel_active' : latest.stopIntent?.mode || 'cancel_active';
      await this.save(s, { intent: { action: 'stop', mode, reason: 'operator_stop', stopRevision: latest.stopRevision, key: `stop_${mode}_${latest.stopRevision}` } });
    }
    if (!s.intent && latest.intakeSealed && latest.drainIntent?.sessionId === s._id) {
      await this.save(s, { intent: latest.drainIntent.intent, sealedRevision: latest.drainIntent.revision });
    }
    if (s.pendingRecovery) {
      const pending = s.pendingRecovery;
      const m = await this.db.SessionMutation.findById(`${s._id}_${pending.key}`).select('+nextToken').lean();
      if (!m?.nextToken) throw problem('session_recovery_journal_missing', 503);
      remote = await this.mutate(s, 'recover', pending.key, m.body, m.nextToken);
      await this.save(s, { coordinatorId: pending.coordinatorId, token: m.nextToken, generation: remote.generation,
        remote, state: remote.state, ...pending.identity, pendingRecovery: null });
    }
    if (s.coordinatorId !== this.worker.id) {
      const proven = latest.operatorFence?.holder === s.coordinatorId || await this.worker.terminated({ ...s, holder: s.coordinatorId });
      if (!proven) { await this.save(s, { reason: 'coordinator_termination_unproven' }); return s; }
      if (remaining(remote, this.gateway.monotonic()) > 0 && !s.intent) {
        const key = `recover_${this.worker.id}`;
        let m = await this.db.SessionMutation.findById(`${s._id}_${key}`).select('+nextToken').lean();
        const token = m?.nextToken || randomBytes(32).toString('hex');
        const body = { previous_coordinator_terminated: true, coordinator_id: this.worker.id };
        // Both future authority and OS identity precede network I/O. A third
        // process can reconcile this exact transfer before attempting its own.
        await this.db.SessionMutation.updateOne({ _id: `${s._id}_${key}` }, { $setOnInsert: {
          sessionId: s._id, action: 'recover', key, body, authority: headers(s), nextToken: token,
        } }, { upsert: true });
        await this.save(s, { pendingRecovery: { key, coordinatorId: this.worker.id, identity: await ownerIdentity() } });
        remote = await this.mutate(s, 'recover', key, body, token);
        await this.save(s, { coordinatorId: this.worker.id, token, generation: remote.generation, remote, state: remote.state,
          ...await ownerIdentity(), pendingRecovery: null, ownershipEpoch: latest.ownershipEpoch });
      } else if (!s.intent) await this.save(s, { intent: { action: 'stop', mode: 'cancel_active', reason: 'original_budget_expired' } });
    }
    const config = require('./gateway').config();
    if (!s.intent && (!config.enabled || (s.acquire.mode === 'automatic' && !config.auto))) {
      await this.save(s, { intent: { action: 'stop', mode: 'finish_current', reason: 'dispatch_disabled' } });
    }
    if (s.intent) {
      if (!['stopping', 'closing', 'released', 'release_failed'].includes(remote.state)
        || !s.intent.sent) {
        const body = s.intent.action === 'close' ? { last_run_sequence: s.lastSequence, queue_revision: String(s.sealedRevision) } : { mode: s.intent.mode };
        remote = await this.mutate(s, s.intent.action, s.intent.key || `${s.intent.action}_${s.intent.mode || s.sealedRevision}`, body);
        await this.save(s, { remote, state: remote.state, intent: { ...s.intent, sent: true } });
      }
      return s;
    }
    if (remote.state === 'recovery_required') {
      if (remote.resume_required && remote.recovery_reason === 'gateway_restarted' && remaining(remote, this.gateway.monotonic()) > 5000) {
        try {
          remote = await this.mutate(s, 'resume', `resume_${remote.gateway_epoch}`, {});
          await this.save(s, { remote, state: remote.state, reason: null, lastRenewedAt: null });
          remote = await this.gateway.request('GET', `/batch/sessions/${s._id}`);
        } catch (error) {
          if (!['batch_session_recovery_incomplete', 'batch_session_expired', 'batch_session_resume_not_allowed'].includes(error.code)) throw error;
          await this.save(s, { reason: error.code, intent: { action: 'stop', mode: 'cancel_active', reason: 'restart_fallback' } });
          return s;
        }
      } else {
        await this.save(s, { intent: { action: 'stop', mode: 'cancel_active', reason: 'restart_fallback' } }); return s;
      }
    }
    const beforeRenew = await this.worker.guard();
    if (beforeRenew.stopRevision > s.stopRevision) return s;
    if (['held', 'acquiring'].includes(remote.state) && remaining(remote, this.gateway.monotonic()) > 0
      && (!s.lastRenewedAt || +this.worker.now() - +s.lastRenewedAt >= 25000 || remote.lease_remaining_seconds < 60)) {
      remote = await this.mutate(s, 'renew', `renew_${s.renewSequence}`, {});
      await this.save(s, { remote, state: remote.state, renewSequence: s.renewSequence + 1, lastRenewedAt: this.worker.now() });
    }
    return s;
  }
  async authority(run, { stopping = false } = {}) {
    const control = await this.worker.guard();
    if (!run.sessionId) return undefined;
    const s = await this.read(run.sessionId);
    if (!s || control.activeSession !== s._id || s.coordinatorId !== this.worker.id) throw problem('session_dispatch_fenced', 409);
    const remote = await this.gateway.request('GET', `/batch/sessions/${s._id}`);
    if (remote.generation !== s.generation || remote.gateway_epoch !== s.gatewayEpoch) throw problem('session_dispatch_fenced', 409);
    if (!stopping && (s.intent || control.stopRevision > s.stopRevision || control.intakeSealed || control.stopIntent?.sessionId === s._id || control.stopIntent?.requestId === s.requestId
      || remote.state !== 'held' || !remote.dispatch_allowed || remaining(remote, this.gateway.monotonic()) < 5000)) throw problem('session_dispatch_fenced', 409);
    const latest = await this.worker.guard();
    if (!stopping && (latest.stopRevision > s.stopRevision || latest.intakeSealed || latest.stopIntent?.sessionId === s._id || latest.stopIntent?.requestId === s.requestId)) throw problem('session_dispatch_fenced', 409);
    return headers(s);
  }
  async drain(s, reason = 'queue_drained', observedRevision) {
    const c = await this.worker.guard();
    if (c.activeRun || c.intakes?.length) return;
    const fresh = await this.read(s._id);
    const runs = await this.db.Run.find({ sessionId: s._id }).select('remote.status remote.operations.status remote.operations.termination_proven remote.operations.cleanup').lean();
    const unresolved = fresh.pendingRun || runs.some(run => !['drained', 'stopped', 'expired'].includes(run.remote?.status)
      || run.remote?.operations?.some(op => !['succeeded', 'failed', 'interrupted', 'deferred'].includes(op.status)
        || op.termination_proven !== true || !['verified', 'not_required'].includes(op.cleanup)));
    const intent = unresolved ? { action: 'stop', mode: 'cancel_active', reason: 'associated_run_unresolved' } : { action: 'close', reason };
    // The control CAS is the queue boundary. Its complete close/stop plan is
    // recoverable even if the following Session projection never commits.
    const sealed = await this.db.Control.updateOne({ _id: 'scheduler', holder: this.worker.id, fence: this.worker.fence,
      queueRevision: observedRevision, intakes: { $size: 0 }, activeRun: null, activeSession: s._id },
    { $set: { intakeSealed: true, drainIntent: { sessionId: s._id, revision: observedRevision, lastSequence: fresh.lastSequence, intent } } });
    if (!sealed.matchedCount) return;
    await this.save(fresh, { sealedRevision: observedRevision, intent });
  }
}
module.exports = { Sessions, publicSession, remaining, capability, headers };
