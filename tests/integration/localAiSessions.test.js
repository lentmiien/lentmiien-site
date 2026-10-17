jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const mongoose = require('mongoose');
require('../../database');
const { performance } = require('perf_hooks');
const { LocalAiService } = require('../../services/localAi/service');
const { Worker } = require('../../services/localAi/worker');
const { Gateway } = require('../../services/localAi/gateway');
const { problem, digest } = require('../../services/localAi/policy');
const { publicSession } = require('../../services/localAi/sessions');
const db = require('../../models/local_ai');
const suite = process.env.LOCAL_AI_TEST_MONGO_URI ? describe : describe.skip;
const clone = value => JSON.parse(JSON.stringify(value));
suite('durable sessions with production model bootstrap and standalone Mongo', () => {
  let worker, service, gateway, now, remote, calls, receipts, runs, fault, archived;
  const env = { ...process.env };
  const caps = () => ({ schema2: { operation_reservation_bytes: 35717120 }, protocol: 'durable-local-ai', version: 1, enabled: true, server_now: new Date(+now + (fault.skew || 0)).toISOString(),
    gateway_epoch: fault.epoch || 'epoch1', constraints: { seal_required: true }, features: { exclusive_batch_sessions: !fault.disabled },
    session_capability_version: 1, sessions: { same_coordinator_resume: true, resume_preserves_deadlines: true } });
  const status = (record = remote) => ({ ...record, server_now: now.toISOString(), gateway_epoch: fault.epoch || 'epoch1',
    hard_remaining_seconds: Math.max(0, (+new Date(record.hard_deadline) - +now) / 1000),
    lease_remaining_seconds: Math.max(0, (+new Date(record.lease_deadline) - +now) / 1000),
    dispatch_allowed: record.state === 'held', cleanup: fault.cleanup || 'verified' });
  const http = { request: async req => {
    const path = new URL(req.url).pathname, method = req.method;
    const body = req.data, h = req.headers;
    calls.push({ method, path, body: body && clone(body), headers: { ...h } });
    const reply = data => ({ data: clone(data), headers: {}, status: 200 });
    const fail = (code, codeStatus = 409) => { throw { response: { status: codeStatus, data: { detail: { code } } } }; };
    if (path === '/batch/capabilities') return reply(caps());
    if (path === '/batch/capacity') return reply({ available_bytes: 2 ** 31, remaining_records: 1000 });
    if (path === '/batch/activities') return reply({ activities: [] });
    if (path.startsWith('/batch/sessions/')) {
      const [, , , id, action = 'acquire'] = path.split('/');
      if (method === 'GET') { const record = remote?.id === id ? remote : archived.get(id); if (!record) return fail('not_found', 404); return reply(status(record)); }
      const key = h['Idempotency-Key'];
      if (!key) return fail('missing_key');
      const saved = await db.SessionMutation.findOne({ sessionId: id, key }).select('+authority').lean();
      expect(saved).toBeTruthy(); expect(saved.body).toEqual(body);
      if (receipts.has(key)) return reply({ ...status(), replayed: true, mutation_outcome: receipts.get(key) });
      if (h['X-Batch-Gateway-Epoch'] !== (fault.epoch || 'epoch1')) return fail('batch_gateway_epoch_changed');
      if (action === 'acquire') {
        if (fault.busy) return fail('gpu_batch_session_busy');
        if (remote) { expect(remote.state).toBe('released'); archived.set(remote.id, remote); }
        remote = { id, generation: 1, coordinator: h['X-Batch-Coordinator-Id'], token: h['X-Batch-Session-Token'], state: 'held',
          hard_deadline: body.not_after, lease_deadline: new Date(+now + 120000).toISOString() };
      } else {
        if (Number(h['X-Batch-Session-Generation']) !== remote.generation || h['X-Batch-Session-Token'] !== remote.token || h['X-Batch-Coordinator-Id'] !== remote.coordinator) return fail('batch_session_authority_invalid', 403);
        if (action === 'renew') {
          if (remote.state === 'recovery_required') return fail('batch_session_recovery_incomplete');
          remote.lease_deadline = new Date(+now + 120000).toISOString();
        }
        if (action === 'resume') {
          if (fault.resumeBlocked) return fail('batch_session_recovery_incomplete');
          remote.state = 'held'; remote.resume_required = false; remote.recovery_reason = null;
        }
        if (action === 'recover') {
          expect(body.previous_coordinator_terminated).toBe(true);
          remote.generation++; remote.token = h['X-Batch-Next-Session-Token']; remote.coordinator = body.coordinator_id; remote.state = 'held';
        }
        if (action === 'stop') remote.state = 'stopping';
        if (action === 'close') {
          expect(body.last_run_sequence).toBe(runs.size);
          expect([...runs.values()].every(r => ['drained', 'stopped'].includes(r.status))).toBe(true);
          remote.state = 'closing';
        }
      }
      receipts.set(key, { state: remote.state, generation: remote.generation });
      if (fault.lost === action) { fault.lost = null; throw new Error('lost reply'); }
      const result = status(); delete result.token; delete result.coordinator;
      return reply(result);
    }
    if (path.startsWith('/batch/runs/')) {
      const [, , , id, part, opId] = path.split('/');
      let run = runs.get(id);
      if (method === 'GET') { if (!run) return fail('not_found', 404); return reply(run); }
      if (remote && remote.state !== 'held' && part !== 'stop') return fail('gpu_batch_session_busy');
      if (remote) {
        expect(h['X-Batch-Session-Token']).toBe(remote.token);
        expect(Number(h['X-Batch-Session-Generation'])).toBe(remote.generation);
        expect(h['X-Batch-Gateway-Epoch']).toBe(fault.epoch || 'epoch1');
      }
      if (!part) {
        if (!run) { run = { id, ...clone(body), status: 'open', operations: [] }; runs.set(id, run); }
        else expect(body).toEqual(Object.fromEntries(Object.entries(run).filter(([k]) => !['id', 'status', 'operations'].includes(k))));
      } else if (part === 'operations') {
        if (!run.operations.some(o => o.id === opId)) run.operations.push({ id: opId, logical_job_id: body.logical_job_id, status: 'queued', schema_version: body.schema_version, request_digest: digest(body), body: clone(body), termination_proven: true, cleanup: 'verified' });
      } else if (part === 'start') {
        run.status = fault.active ? 'running' : 'drained';
        if (!fault.active) run.operations.forEach(op => Object.assign(op, { status: 'succeeded', result: { done: true, message: { content: 'synthetic result' } }, result_digest: digest(op.body) }));
      } else if (part === 'stop') run.status = 'stopped';
      if (fault.lost && (fault.lost === part || (!part && fault.lost === 'run'))) { fault.lost = null; throw new Error('lost reply'); }
      return reply(run);
    }
    if (path.includes('/ack')) return reply({});
    if (path.startsWith('/batch/operations/')) return reply([...runs.values()].flatMap(r => r.operations).find(o => o.id === path.split('/')[3]));
    throw new Error(`Unexpected synthetic endpoint ${path}`);
  } };
  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/local_ai_test$/.test(process.env.LOCAL_AI_TEST_MONGO_URI)) throw new Error('Disposable Mongo required');
    await mongoose.connect(process.env.LOCAL_AI_TEST_MONGO_URI, { bufferCommands: false });
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toBeUndefined();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(db).map(m => m.deleteMany({})));
    now = new Date('2026-10-17T17:00:00Z'); remote = null; calls = []; receipts = new Map(); runs = new Map(); archived = new Map(); fault = {};
    process.env.LOCAL_AI_BATCH_ENABLED = 'true'; process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'false';
    process.env.BATCH_SERVER_TOKEN = 'synthetic-credential-long-enough-for-testing'; process.env.BATCH_CLIENT_ID = 'site-test';
    gateway = new Gateway({ http, now: () => +now, monotonic: () => performance.now() });
    service = new LocalAiService({ gateway }); await service.initialize();
    service.principal = jest.fn(async () => ({})); service.sourceAccess = jest.fn(async () => ({}));
    service.validateFrozen = jest.fn(async () => {}); service.project = jest.fn(async () => {});
    worker = new Worker(service, { ready: () => true, now: () => new Date(now), terminated: async c => !c.holder }); worker.running = true;
  });
  afterEach(() => worker.stop());
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); process.env = env; });
  async function job(id, affinity = id) {
    return db.Job.create({ _id: id, ownerId: 'owner', key: id, digest: id, slot: await db.Job.countDocuments(), ownerSlot: await db.Job.countDocuments(),
      affinity, type: 'llm.chat', request: { model: id, messages: [{ role: 'user', content: 'synthetic' }], max_tokens: 32 }, source: {}, nextAttemptAt: now });
  }
  const start = async () => { await worker.manage({ ownerId: 'admin' }, 'start'); await worker.tick(); };
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { now = new Date(+now + 11000); await worker.tick(); } };
  const mutations = action => calls.filter(c => c.method !== 'GET' && c.path.endsWith(action));
  test('three affinities share one session and close only after the final cohort', async () => {
    await job('comfy'); await job('vision'); await job('text');
    process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = 'true';
    await db.Job.updateOne({ _id: 'comfy' }, { $set: { type: 'comfy.workflow', schemaVersion: 2,
      request: { workflow_id: 'synthetic-workflow', template_sha256: 'a'.repeat(64), bindings: {} }, source: { reservationBytes: 35717120 } } });
    await db.Job.updateOne({ _id: 'vision' }, { $set: { schemaVersion: 2 } });
    service.workflows.negotiate = jest.fn(async () => caps()); service.inputs.stage = jest.fn(async () => {});
    const reconcile = worker.reconcileOperation.bind(worker);
    worker.reconcileOperation = async (j, op) => j.type !== 'comfy.workflow' ? reconcile(j, op)
      : worker.jobSet(j, { state: 'succeeded', result: { synthetic: true }, published: true, acknowledged: true });
    await start(); await tick(7);
    expect(runs.size).toBe(3);
    expect([...runs.values()].map(r => r.session_sequence)).toEqual([1, 2, 3]);
    expect(new Set([...runs.values()].map(r => r.session_id)).size).toBe(1);
    expect(calls.filter(c => c.method === 'PUT' && /\/sessions\//.test(c.path))).toHaveLength(1);
    await tick(2); expect({ state: remote.state, control: (await db.Control.findById('scheduler')).reason, intent: (await db.Session.findOne()).intent }).toMatchObject({ state: 'closing' });
    expect((await db.Control.findById('scheduler')).activeSession).toBe(remote.id);
    remote.state = 'released'; await tick();
    expect((await db.Control.findById('scheduler')).activeSession).toBeNull();
    expect((await db.Control.findById('scheduler')).reason).toBe('queue_drained');
    expect(await db.Job.countDocuments({ state: 'succeeded', acknowledged: true })).toBe(3);
  });
  test('busy acquisition keeps immutable candidate and repeated Start cannot replenish budget', async () => {
    fault.busy = true; await job('a'); await start();
    const original = await db.Session.findOne().select('+token').lean();
    await worker.manage({ ownerId: 'admin' }, 'start'); await tick(2);
    expect(calls.filter(c => c.method === 'PUT' && /\/sessions\//.test(c.path))).toHaveLength(1);
    now = new Date(+now + 1800000); fault.busy = false; await tick();
    const later = await db.Session.findOne().select('+token').lean();
    expect(later.acquire).toEqual(original.acquire); expect(later.token).toBe(original.token);
    expect(later.acquireKey).toBe(original.acquireKey);
  });
  test.each(['acquire', 'renew', 'resume', 'recover', 'close', 'stop'])('lost %s response reconciles same authority and persisted key', async action => {
    await job('a'); if (action === 'acquire') fault.lost = action;
    if (['renew', 'resume', 'recover', 'stop'].includes(action)) fault.active = true;
    await start();
    if (action === 'resume') Object.assign(remote, { state: 'recovery_required', resume_required: true, recovery_reason: 'gateway_restarted' });
    if (action === 'recover') {
      worker.stop(); await db.Control.updateOne({ _id: 'scheduler' }, { $set: { leaseUntil: new Date(0) } });
      worker = new Worker(service, { ready: () => true, now: () => new Date(now), terminated: async () => true }); worker.running = true;
    }
    if (action === 'stop') await worker.manage({ ownerId: 'admin' }, 'cancel_active');
    if (action !== 'acquire') fault.lost = action;
    await tick(7);
    const journal = await db.SessionMutation.find({ action }).select('+authority').lean();
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.some(m => m.receipt)).toBe(true);
    expect(await db.Session.countDocuments()).toBe(1);
  });
  test('Gateway restart uses resume with original token/generation then separate renewal', async () => {
    await job('a'); await start(); const old = await db.Session.findOne().select('+token').lean();
    fault.epoch = 'epoch2'; Object.assign(remote, { state: 'recovery_required', resume_required: true, recovery_reason: 'gateway_restarted' });
    await tick(); const current = await db.Session.findOne().select('+token').lean();
    expect(current.token).toBe(old.token); expect(current.generation).toBe(1); expect(current.acquire).toEqual(old.acquire);
    expect(mutations('/resume')).toHaveLength(1); expect(mutations('/recover')).toHaveLength(0);
  });
  test('heartbeat remains independent of a blocked main tick and retains fence and generation', async () => {
    await job('a'); await start(); const c = await db.Control.findById('scheduler').lean();
    worker.busy = true; now = new Date(+now + 30000); await worker.heartbeat();
    const next = await db.Control.findById('scheduler').lean();
    expect(next.fence).toBe(c.fence); expect(next.ownershipEpoch).toBe(c.ownershipEpoch); expect(remote.generation).toBe(1);
    expect(mutations('/renew').length).toBeGreaterThan(1);
    worker.ready = () => false; const count = calls.length; await worker.heartbeat(); expect(calls).toHaveLength(count);
  });
  test('unsafe resume stops first and does not claim release on HTTP acceptance', async () => {
    await job('a'); await start(); fault.resumeBlocked = true;
    Object.assign(remote, { state: 'recovery_required', resume_required: true, recovery_reason: 'gateway_restarted' });
    await tick(2); expect(remote.state).toBe('stopping');
    expect((await db.Control.findById('scheduler')).activeSession).toBe(remote.id);
    expect(await db.Session.countDocuments()).toBe(1);
  });
  test('unsafe resume releases ownership before a new session with the original fixed budget', async () => {
    fault.active = true; await job('a'); await job('b'); await start();
    const original = await db.Session.findOne().lean(); const originalRun = [...runs.values()][0];
    fault.resumeBlocked = true;
    Object.assign(remote, { state: 'recovery_required', resume_required: true, recovery_reason: 'gateway_restarted' });
    await tick(2); expect(remote.state).toBe('stopping'); expect(await db.Session.countDocuments()).toBe(1);
    // Gateway terminal proof is required before retrying the interrupted operation.
    originalRun.status = 'stopped'; originalRun.operations.forEach(op => Object.assign(op, { status: 'interrupted', termination_proven: true, cleanup: 'verified' }));
    remote.state = 'released'; fault.resumeBlocked = false;
    await tick(3);
    const replacement = await db.Session.findOne({ _id: { $ne: original._id } }).lean();
    expect(replacement).toBeTruthy(); expect(+new Date(replacement.acquire.not_after)).toBeLessThanOrEqual(+new Date(original.acquire.not_after));
    expect(replacement.lastSequence).toBe(1);
    const nextRun = [...runs.values()].find(r => r.session_id === replacement._id);
    expect(nextRun.operations[0].body.retry_of).toBe(originalRun.operations[0].id);
    const stopIndex = calls.findIndex(c => c.method === 'POST' && c.path === `/batch/sessions/${original._id}/stop`);
    const acquireIndex = calls.findIndex(c => c.method === 'PUT' && c.path === `/batch/sessions/${replacement._id}`);
    expect(stopIndex).toBeLessThan(acquireIndex);
  });
  test('alive prior coordinator cannot take over even with expired Mongo lease', async () => {
    await job('a'); await start(); await db.Control.updateOne({ _id: 'scheduler' }, { $set: { leaseUntil: new Date(0), holder: 'live-other' } });
    const before = calls.length; await worker.tick(); expect(calls).toHaveLength(before); expect(mutations('/recover')).toHaveLength(0);
  });
  test('revision changes and in-flight intake defeat drain; post-seal enqueue belongs to later work', async () => {
    await job('a'); await start();
    await db.Control.updateOne({ _id: 'scheduler' }, { $set: { intakes: [{ id: 'pending', holder: worker.id, ownerHost: 'foreign', ownerPid: 1 }] } });
    await tick();
    await db.Control.updateOne({ _id: 'scheduler' }, { $set: { intakes: [] } });
    let s = await db.Session.findOne().select('+token').lean(), c = await db.Control.findById('scheduler').lean();
    await db.Control.updateOne({ _id: c._id }, { $inc: { queueRevision: 1 } });
    await worker.sessions.drain(s, 'queue_drained', c.queueRevision);
    expect((await db.Control.findById(c._id)).intakeSealed).toBe(false);
    await tick(2); expect((await db.Control.findById(c._id)).intakeSealed).toBe(true);
    await job('late'); await tick(); expect(runs.size).toBe(1); expect((await db.Job.findById('late')).state).toBe('queued');
  });
  test('blocked affinity does not starve viable groups and all-blocked queue releases promptly', async () => {
    await job('bad'); await job('good'); service.validateFrozen.mockImplementation(async j => { if (j._id === 'bad') throw problem('missing_file', 503); });
    await start(); await tick(3); expect([...runs.values()][0].operations[0].logical_job_id).toBe('good');
    await tick(7); expect((await db.Session.findOne()).intent.reason).toBe('eligible_work_blocked');
    expect((await db.Job.findById('bad')).state).toBe('queued');
  });
  test('long preparation renews independently without invalidating its in-flight tick fence', async () => {
    await job('a'); await job('b'); await start();
    let release, entered; const blocked = new Promise(resolve => { entered = resolve; });
    service.validateFrozen.mockImplementation(async j => { if (j._id === 'b') { entered(); await new Promise(resolve => { release = resolve; }); } });
    const driving = worker.tick(); await Promise.race([blocked, driving.then(async () => { throw new Error('Tick ended before reaching the intended asynchronous barrier'); })]);
    const fence = worker.fence; now = new Date(+now + 30000); await worker.heartbeat();
    expect(worker.fence).toBe(fence); expect(remote.generation).toBe(1); expect(mutations('/renew').length).toBeGreaterThan(1);
    release(); service.validateFrozen.mockImplementation(async () => {}); await driving;
    expect(runs.size).toBe(2); expect([...runs.values()][1].session_sequence).toBe(2);
  });
  test('slow collection can finish after verified release while the tick is still in flight', async () => {
    await job('a'); await start();
    let release, entered; const collecting = new Promise(resolve => { entered = resolve; });
    service.project.mockImplementationOnce(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
    const driving = worker.tick(); await Promise.race([collecting, driving.then(async () => { throw new Error('Tick ended before reaching the intended asynchronous barrier'); })]);
    expect(remote.state).toBe('closing'); remote.state = 'released'; await worker.heartbeat();
    expect((await db.Control.findById('scheduler')).activeSession).toBeNull();
    release(); await driving;
    expect(await db.Job.findById('a').lean()).toMatchObject({ published: true, acknowledged: true });
  });
  test('crash between queue seal CAS and session projection reconstructs the exact close intent', async () => {
    await job('a'); await start();
    const save = worker.sessions.save.bind(worker.sessions); let failed = false;
    worker.sessions.save = async (record, set, unset) => {
      if (!failed && set.intent?.action === 'close') { failed = true; throw new Error('synthetic interrupted projection'); }
      return save(record, set, unset);
    };
    await tick();
    const control = await db.Control.findById('scheduler').lean();
    expect(control.intakeSealed).toBe(true); expect(control.drainIntent).toMatchObject({ lastSequence: 1, intent: { action: 'close' } });
    await tick(); expect(remote.state).toBe('closing');
    expect(mutations('/close').at(-1).body).toEqual({ last_run_sequence: 1, queue_revision: String(control.drainIntent.revision) });
  });
  test('manual request key remains idempotent after release and never starts later arrivals', async () => {
    await job('a'); await worker.manage({ ownerId: 'admin' }, 'start', 'stable_click'); await worker.tick(); await tick(2);
    remote.state = 'released'; await tick(); await job('later');
    const count = await db.Session.countDocuments();
    await worker.manage({ ownerId: 'admin' }, 'start', 'stable_click'); await tick();
    expect(await db.Session.countDocuments()).toBe(count); expect((await db.Control.findById('scheduler')).manualDeadline).toBeNull();
    expect((await db.Job.findById('later')).state).toBe('queued');
  });
  test('stop during CPU preparation prevents acquisition; cancel dominates finish-current', async () => {
    await job('a');
    service.validateFrozen.mockImplementationOnce(async () => { await worker.manage({ ownerId: 'admin' }, 'cancel_active'); });
    await start(); expect(remote).toBeNull(); expect(runs.size).toBe(0);
    await worker.manage({ ownerId: 'admin' }, 'finish_current');
    expect((await db.Control.findById('scheduler')).stopIntent.mode).toBe('cancel_active');
  });
  test('stop while acquisition capability probe is in flight is caught by stop revision', async () => {
    await job('a'); await worker.manage({ ownerId: 'admin' }, 'start');
    const create = worker.sessions.create.bind(worker.sessions);
    worker.sessions.create = async (control, mode) => { await worker.manage({ ownerId: 'admin' }, 'cancel_active'); return create(control, mode); };
    await worker.tick(); expect(remote).toBeNull(); expect(runs.size).toBe(0);
    expect((await db.Control.findById('scheduler')).activeSession).toBeNull();
  });
  test('automatic pre-01 Gateway skew retries the real boundary rather than thirty minutes later', async () => {
    now = new Date('2026-10-17T16:00:10Z'); fault.skew = -39000; process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'true';
    await job('a'); await worker.tick();
    expect(remote).toBeNull(); const control = await db.Control.findById('scheduler').lean();
    expect(control.reason).toBe('waiting_gateway_window');
    expect(+control.nextAttemptAt - +now).toBe(29000);
  });
  test('workstation +39s clock does not become the acquire deadline authority', async () => {
    fault.skew = -39000; await job('a'); await start();
    const session = await db.Session.findOne().lean();
    expect(+new Date(session.acquire.not_after)).toBeLessThanOrEqual(+now - 39000 + 18000000);
    const original = session.acquire.not_after; now = new Date(+now - 60000); await tick();
    expect((await db.Session.findOne()).acquire.not_after).toBe(original);
  });
  test('actual live PID blocks takeover; verified child exit permits one token rotation', async () => {
    const { spawn } = require('child_process');
    const { once } = require('events');
    const { processIdentity, previousCoordinatorTerminated } = require('../../services/localAi/coordinator');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await once(child, 'spawn');
    try {
      fault.active = true; await job('a'); await start(); worker.stop();
      const identity = { ownerHost: require('os').hostname(), ownerPid: child.pid, ownerProcessStart: await processIdentity(child.pid) };
      await db.Control.updateOne({ _id: 'scheduler' }, { $set: { ...identity, leaseUntil: new Date(0) } });
      await db.Session.updateOne({}, { $set: identity });
      worker = new Worker(service, { ready: () => true, now: () => now, terminated: previousCoordinatorTerminated }); worker.running = true;
      await tick(); expect(mutations('/recover')).toHaveLength(0);
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
      await tick(); expect(mutations('/recover')).toHaveLength(1); expect(remote.generation).toBe(2);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
  });
  test('cross-host takeover requires a durable operator assertion after actual fencing', async () => {
    fault.active = true; await job('a'); await start(); const previous = worker.id; worker.stop();
    await db.Control.updateOne({ _id: 'scheduler' }, { $set: { ownerHost: 'synthetic-other-host', leaseUntil: new Date(0) } });
    await db.Session.updateOne({}, { $set: { ownerHost: 'synthetic-other-host' } });
    worker = new Worker(service, { ready: () => true, now: () => now }); worker.running = true;
    await tick(); expect(mutations('/recover')).toHaveLength(0);
    // Model the trusted operator command after external termination; timeout alone cannot do this.
    await db.Control.updateOne({ _id: 'scheduler', holder: previous }, { $set: { holder: null, operatorFence: { holder: previous, actorId: 'admin', confirmedAt: now } }, $inc: { fence: 1 } });
    await tick(); expect(mutations('/recover')).toHaveLength(1); expect(remote.generation).toBe(2);
  });
  test('expired lease and stale generation cannot authorize a new run mutation', async () => {
    await job('a'); await start(); const run = await db.Run.findOne().lean();
    remote.lease_deadline = new Date(+now - 1).toISOString();
    await expect(worker.sessions.authority(run)).rejects.toMatchObject({ code: 'session_dispatch_fenced' });
    remote.lease_deadline = new Date(+now + 100000).toISOString();
    const hard = remote.hard_deadline; remote.hard_deadline = new Date(+now - 1).toISOString();
    await expect(worker.sessions.authority(run)).rejects.toMatchObject({ code: 'session_dispatch_fenced' });
    remote.hard_deadline = hard; remote.generation++;
    await expect(worker.sessions.authority(run)).rejects.toMatchObject({ code: 'session_dispatch_fenced' });
  });
  test('cleanup uncertainty retains the visible fence and explicit stop retry gets a fresh key', async () => {
    await job('a'); await start(); await worker.manage({ ownerId: 'admin' }, 'cancel_active'); await tick();
    remote.state = 'release_failed'; fault.cleanup = 'uncertain'; await tick();
    expect((await db.Control.findById('scheduler')).activeSession).toBe(remote.id);
    const before = mutations('/stop').at(-1).headers['Idempotency-Key'];
    await worker.manage({ ownerId: 'admin' }, 'cancel_active'); await tick();
    expect(mutations('/stop').at(-1).headers['Idempotency-Key']).not.toBe(before);
  });
  test('new work fails closed on the old Gateway while ordinary model reads exclude secrets', async () => {
    fault.disabled = true; await job('a'); await expect(start()).rejects.toMatchObject({ code: 'exclusive_sessions_unavailable' }); expect(runs.size).toBe(0);
    fault.disabled = false; await start();
    expect((await db.Session.findOne().lean()).token).toBeUndefined();
    expect((await db.SessionMutation.findOne().lean()).authority).toBeUndefined();
    const privateRecord = await db.Session.findOne().select('+token').lean();
    expect(JSON.stringify(publicSession(privateRecord))).not.toContain(privateRecord.token);
  });
});
