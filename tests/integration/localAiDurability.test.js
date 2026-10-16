jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn(), info: jest.fn() }));
const mongoose = require('mongoose');
const express = require('express');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { LocalAiService } = require('../../services/localAi/service');
const { Gateway } = require('../../services/localAi/gateway');
const { Worker } = require('../../services/localAi/worker');
const { createRouter } = require('../../routes/localAi');
const { CAP } = require('../../services/localAi/policy');
const { Job, Run, Control, Token } = require('../../models/local_ai');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const Conversation = require('../../models/conversation5');
const Message = require('../../models/chat5');
const ModelCard = require('../../models/ai_model_card');
const { readImage } = require('../../services/localAi/artifacts');
const qwen = require('../fixtures/local-ai/qwen.json');
const clone = x => JSON.parse(JSON.stringify(x));
const suite = process.env.LOCAL_AI_TEST_MONGO_URI ? describe : describe.skip;
suite('standalone Mongo + real HTTP fake Gateway durable integration', () => {
  let server, origin, service, worker, owner, other, actor, clock, runs, fault, readiness, root;
  const env = { ...process.env };
  const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const text = model => ({ type: 'llm.chat', request: { model: model || 'a', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 } });
  const load = id => Job.findById(id).lean();
  const makeWorker = () => { const w = new Worker(service, { ready: () => mongoose.connection.readyState === 1, now: () => new Date(clock), terminated: async () => true }); w.running = true; return w; };
  const expireLease = () => Control.updateOne({ _id: 'scheduler' }, { $set: { leaseUntil: new Date(0) } });
  const tick = async () => { await worker.tick(); };
  beforeAll(async () => {
    const uri = process.env.LOCAL_AI_TEST_MONGO_URI;
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/local_ai_test(?:\?|$)/.test(uri)) throw new Error('Disposable loopback local_ai_test database required');
    await mongoose.connect(uri, { bufferCommands: false });
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-test-'));
    process.env.LOCAL_AI_BATCH_DATA_DIR = root;
    process.env.BATCH_SERVER_TOKEN = 'x'.repeat(40); process.env.BATCH_CLIENT_ID = 'site-test';
    const app = express(); app.use(express.json({ limit: '2mb' }));
    app.use((req, res, next) => {
      if (req.headers.authorization !== `Bearer ${process.env.BATCH_SERVER_TOKEN}` || req.headers['x-batch-client'] !== 'site-test') return res.sendStatus(401);
      if (fault.offline) return res.status(503).json({ detail: { code: 'persistence_unavailable' } });
      next();
    });
    app.get('/llm/models', (req, res) => res.json({ models: ['a', 'b'].map(id => ({ id, provider: 'ollama', upstream_model: id, limits: { max_output_tokens: 8192, max_context_tokens: 131072, max_prompt_chars: 100000 } })) }));
    app.get('/batch/capabilities', (req, res) => res.json({ protocol: 'durable-local-ai', version: 1, enabled: true, constraints: { seal_required: true } }));
    app.get('/batch/activities', (req, res) => res.json({ activities: [] }));
    app.get('/batch/readiness', (req, res) => res.json(readiness));
    app.put('/batch/runs/:id', (req, res) => {
      const prior = runs.get(req.params.id);
      if (prior && JSON.stringify(prior.wire) !== JSON.stringify(req.body)) return res.status(409).json({ detail: { code: 'immutable_run_conflict' } });
      if (!prior) runs.set(req.params.id, { id: req.params.id, ...req.body, wire: clone(req.body), status: 'open', operations: [], stop_mode: null });
      res.json(runs.get(req.params.id));
    });
    app.get('/batch/runs/:id', (req, res) => {
      const run = runs.get(req.params.id); if (!run) return res.status(404).json({ detail: { code: 'not_found' } });
      if (+new Date(run.deadline) <= +clock && !['drained', 'stopped', 'expired', 'needs_review'].includes(run.status)) {
        run.status = 'expired'; run.operations.forEach(op => { if (op.status === 'queued') Object.assign(op, { status: 'deferred', error: 'deadline' }); });
      }
      res.json(run);
    });
    app.put('/batch/runs/:run/operations/:id', (req, res) => {
      const run = runs.get(req.params.run); const old = run.operations.find(o => o.id === req.params.id);
      if (old) return JSON.stringify(old.body) === JSON.stringify(req.body) ? res.status(202).json(old) : res.sendStatus(409);
      if (run.status !== 'open') return res.status(409).json({ detail: { code: 'run_not_open' } });
      if (fault.quota && run.operations.length >= 1) return res.status(507).json({ detail: { code: 'storage_quota' } });
      const op = { id: req.params.id, run_id: run.id, logical_job_id: req.body.logical_job_id, type: req.body.type, body: clone(req.body), status: 'queued', termination_proven: true, cleanup: 'not_required', result: null };
      run.operations.push(op);
      if (fault.upload) { fault.upload = false; return res.status(502).end(); }
      res.status(202).json(op);
    });
    app.post('/batch/runs/:id/start', (req, res) => {
      const run = runs.get(req.params.id); run.status = 'running'; fault.starts = (fault.starts || 0) + 1;
      if (fault.start) { fault.start = false; return res.status(502).end(); }
      res.json(run);
    });
    app.post('/batch/runs/:id/stop', (req, res) => {
      const run = runs.get(req.params.id); run.stop_mode = req.body.mode; run.status = 'stopped';
      run.operations.forEach(op => { if (op.status === 'queued') Object.assign(op, { status: 'deferred', error: 'run_stopped' }); }); res.json(run);
    });
    app.get('/batch/operations/:id', (req, res) => {
      const op = [...runs.values()].flatMap(r => r.operations).find(o => o.id === req.params.id);
      op ? res.json(op) : res.status(404).json({ detail: { code: 'not_found' } });
    });
    app.get('/batch/operations/:id/output', (req, res) => res.type('png').send(fault.png));
    app.post('/batch/operations/:id/ack', (req, res) => {
      const op = [...runs.values()].flatMap(r => r.operations).find(o => o.id === req.params.id);
      if (!op || op.result_digest !== req.body.result_digest) return res.sendStatus(409);
      op.acknowledged_at = new Date().toISOString(); fault.acks = (fault.acks || 0) + 1;
      if (fault.ack) { fault.ack = false; return res.status(502).end(); }
      res.json(op);
    });
    server = await listen(app); origin = `http://127.0.0.1:${server.address().port}`;
    process.env.AI_GATEWAY_BASE_URL = origin;
    service = new LocalAiService({ gateway: new Gateway() }); await service.initialize();
  });
  beforeEach(async () => {
    await Promise.all([Job, Run, Control, Token, User, Role, Conversation, Message, ModelCard].map(m => m.deleteMany({})));
    clock = new Date(); clock.setTime(Date.parse('2026-10-16T16:30:00Z'));
    runs = new Map(); fault = {}; readiness = { healthy: true, idle: true, idle_proven: true, blockers: [] };
    process.env.LOCAL_AI_BATCH_ENABLED = 'true'; process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'true';
    owner = await User.create({ name: 'owner', email: 'test@example.test', type_user: 'admin', hash_password: 'unused' });
    other = await User.create({ name: 'other', email: 'other@example.test', type_user: 'admin', hash_password: 'unused' });
    actor = { ownerId: String(owner._id) }; worker = makeWorker();
  });
  afterEach(() => worker.stop());
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); process.env = env; });
  async function enqueue(key = 'key', payload = text()) {
    const job = await service.submit(actor, key, payload);
    await Job.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } }); return load(job._id);
  }
  function complete(run, result = { done: true, message: { content: 'finished' } }) {
    run.status = 'drained'; for (const op of run.operations) Object.assign(op, { status: 'succeeded', result, result_digest: 'opaque-not-site-digest', cleanup: 'verified' });
  }
  test('concurrent idempotent durable acceptance, mismatch, owner isolation and quotas', async () => {
    const accepted = await Promise.all(Array.from({ length: 8 }, () => service.submit(actor, 'same', text())));
    expect(new Set(accepted.map(j => j._id)).size).toBe(1); expect(await Job.countDocuments()).toBe(1);
    await expect(service.submit(actor, 'same', text('b'))).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(service.get({ ownerId: String(other._id) }, accepted[0]._id)).rejects.toMatchObject({ status: 404 });
    await Job.insertMany(Array.from({ length: 99 }, (_, i) => ({ _id: `quota_${i}`, ownerId: actor.ownerId, key: `quota_${i}`, digest: 'x', slot: i + 1, ownerSlot: i + 1 })));
    await expect(service.submit(actor, 'over-quota', text())).rejects.toMatchObject({ code: 'durable_record_quota' });
  });
  test('readiness requires healthy AND proven idle; 30-minute delay survives restart', async () => {
    await enqueue(); readiness.idle_proven = false; await tick();
    const delay = (await Control.findById('scheduler').lean()).nextAttemptAt;
    expect(+delay).toBe(+clock + 1800000); expect(runs.size).toBe(0);
    worker.stop(); await expireLease(); worker = makeWorker(); readiness.idle_proven = true;
    clock = new Date(+clock + 1799000); await tick(); expect(runs.size).toBe(0);
    clock = new Date(+delay); await tick(); expect(runs.size).toBe(1);
  });
  test('oldest affinity selected before cohort limit and other affinities retain age', async () => {
    await enqueue('a1'); await enqueue('b1', text('b')); await enqueue('a2'); await tick();
    const run = [...runs.values()][0]; expect(run.operations).toHaveLength(2);
    expect(run.operations.every(o => o.body.request.model === 'a')).toBe(true);
    complete(run); await tick(); await tick(); expect([...runs.values()][1].operations[0].body.request.model).toBe('b');
  });
  test('partially uploaded manifest and lost start replies resume without changing IDs or request fields', async () => {
    await enqueue('one'); await enqueue('two'); fault.upload = true; await tick();
    const run = [...runs.values()][0]; expect(run.status).toBe('open'); expect(run.operations).toHaveLength(1);
    const manifest = clone((await Run.findById(run.id).lean()).manifest); const body = clone(run.wire);
    worker.stop(); await expireLease(); worker = makeWorker(); clock = new Date(+clock + 1800000); fault.start = true;
    await tick(); expect(run.status).toBe('running'); expect(run.operations).toHaveLength(2);
    expect((await Run.findById(run.id).lean()).manifest).toEqual(manifest); expect(run.wire).toEqual(body);
    await tick(); expect(fault.starts).toBe(1); expect(run.operations.map(o => o.id)).toEqual(manifest.map(m => m.id));
  });
  test('stale coordinator is fenced before external mutation and database loss stops work', async () => {
    await enqueue(); await tick(); await Control.updateOne({ _id: 'scheduler' }, { $set: { holder: 'another' }, $inc: { fence: 1 } });
    await expect(worker.guard()).rejects.toMatchObject({ code: 'coordinator_fenced' });
    worker.ready = () => false; const count = runs.size; await tick(); expect(runs.size).toBe(count);
  });
  test('quota rejection closes the partial open run without sealing or dropping unaccepted jobs', async () => {
    await enqueue('one'); await enqueue('two'); fault.quota = true; await tick();
    expect(fault.starts).toBeUndefined(); const run = [...runs.values()][0]; expect(run.status).toBe('stopped');
    await tick(); expect(await Job.countDocuments({ state: 'queued', runId: null })).toBe(2);
    expect(await Job.countDocuments()).toBe(2); expect(await Run.countDocuments()).toBe(1);
  });
  test('06 cutoff while Site offline retains completed results and defers unfinished to next night', async () => {
    const one = await enqueue('one'); const two = await enqueue('two'); await tick();
    const run = [...runs.values()][0]; Object.assign(run.operations[0], { status: 'succeeded', result: { done: true, message: { content: 'before cutoff' } }, result_digest: 'done', cleanup: 'verified' });
    worker.stop(); clock = new Date('2026-10-16T21:01:00Z'); await expireLease(); worker = makeWorker(); await tick();
    expect((await load(one._id)).published).toBe(true); const deferred = await load(two._id); expect(deferred.state).toBe('queued');
    expect(deferred.nextAttemptAt.toISOString()).toBe('2026-10-17T16:00:00.000Z');
  });
  test('unknown outcome never automatically replays, even when the run is terminal', async () => {
    const job = await enqueue(); await tick(); const run = [...runs.values()][0]; run.status = 'needs_review';
    Object.assign(run.operations[0], { status: 'outcome_unknown', termination_proven: false, cleanup: 'uncertain' });
    await tick(); await tick(); expect((await load(job._id)).state).toBe('needs_review'); expect(runs.size).toBe(1);
    await expect(service.retry(actor, job._id)).rejects.toMatchObject({ code: 'replacement_not_safe' });
  });
  test('cancel only works before claim; stop intent and suppression survive unreachable Gateway', async () => {
    const cancelled = await enqueue('cancel'); await service.cancel(actor, cancelled._id); expect((await load(cancelled._id)).state).toBe('cancelled');
    const active = await enqueue('active'); await tick(); await expect(service.cancel(actor, active._id)).rejects.toMatchObject({ status: 409 });
    fault.offline = true; await worker.manage(actor, 'cancel_active'); await tick();
    const run = await Run.findOne().lean(); expect(run.stopMode).toBe('cancel_active'); expect(run.state).toBe('stop_pending');
    await worker.manage(actor, 'finish_current'); expect((await Run.findById(run._id)).stopMode).toBe('cancel_active');
    fault.offline = false; await tick(); expect([...runs.values()][0].stop_mode).toBe('cancel_active');
  });
  test('durable publication precedes ack; disabled dispatch still repairs lost ack responses', async () => {
    const job = await enqueue(); await tick(); complete([...runs.values()][0]); fault.ack = true; await tick();
    expect((await load(job._id)).published).toBe(true); expect((await load(job._id)).acknowledged).toBe(false);
    process.env.LOCAL_AI_BATCH_ENABLED = 'false'; worker.stop(); await expireLease(); worker = makeWorker(); await tick();
    expect((await load(job._id)).acknowledged).toBe(true); expect(fault.acks).toBe(2); expect(runs.size).toBe(1);
  });
  test('malformed success and revoked source authorization retain evidence without ack or rerun', async () => {
    const job = await enqueue(); await tick(); complete([...runs.values()][0], { done: true, message: {} }); await tick();
    expect((await load(job._id)).reason).toBe('malformed_successful_text_result'); expect(fault.acks).toBeUndefined();
    await tick(); expect(runs.size).toBe(1);
  });
  test('private PNG import checks hash, dimensions, fixed endpoint and durable provenance', async () => {
    const job = await enqueue('image', { type: 'comfy.image', request: { prompt: qwen } }); await tick();
    fault.png = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#333333' } }).png().toBuffer();
    const hash = crypto.createHash('sha256').update(fault.png).digest('hex');
    complete([...runs.values()][0], { artifact: { name: 'ignored.png', sha256: hash, bytes: fault.png.length, media_type: 'image/png', url: 'http://attacker.invalid/' } });
    await tick(); const saved = await load(job._id); expect(saved.published).toBe(true); expect(saved.result.sha256).toBe(hash);
    expect(await readImage(saved.result)).toEqual(fault.png);
    await fs.writeFile(path.join(root, `${saved.result.artifactId}.png`), 'corrupt'); await expect(readImage(saved.result)).rejects.toThrow();
  });
  test('Chat5 freezes history/settings, repairs deterministic append and rejects tool/media settings', async () => {
    await ModelCard.create({ model_name: 'A', provider: 'Local', api_model: 'a', input_1m_token_cost: 0, output_1m_token_cost: 0, model_type: 'chat', in_modalities: ['text'], out_modalities: ['text'], max_tokens: 8192, max_out_tokens: 100, added_date: new Date(), batch_use: true, context_type: 'system' });
    const message = await Message.create({ user_id: owner.name, category: 'test', contentType: 'text', content: { text: 'history' } });
    const conv = await Conversation.create({ title: 'test', category: 'test', members: [owner.name], messages: [String(message._id)], metadata: { model: 'a', reasoning: 'none' } });
    const payload = { type: 'chat5.response', conversation_id: String(conv._id), prompt: 'new prompt' };
    const job = await enqueue('chat', payload); expect(job.request.messages.map(m => m.content)).toEqual(['history', 'new prompt']);
    await service.project(job); expect((await Conversation.findById(conv._id)).messages).toHaveLength(3);
    await tick(); complete([...runs.values()][0]); await tick(); await service.project(await load(job._id));
    expect(await Message.countDocuments({ localBatchJobId: job._id })).toBe(2); expect((await Message.findById(job.projection.responseId)).content.text).toBe('finished');
    await service.project(job); // stale acceptance must not overwrite a completed response
    expect((await Message.findById(job.projection.responseId)).content.text).toBe('finished');
    await Conversation.updateOne({ _id: conv._id }, { $set: { 'metadata.tools': ['tool'] } });
    await expect(service.submit(actor, 'tool', payload)).rejects.toMatchObject({ code: 'batch_tools_unsupported' });
    await Conversation.updateOne({ _id: conv._id }, { $set: { 'metadata.tools': [] } });
    await Message.updateOne({ _id: message._id }, { $set: { contentType: 'image' } });
    await expect(service.submit(actor, 'media', payload)).rejects.toMatchObject({ code: 'batch_history_contains_tools_or_media' });
    await Conversation.updateOne({ _id: conv._id }, { $set: { members: [other.name] } });
    await expect(service.get(actor, job._id)).rejects.toMatchObject({ code: 'source_access_revoked' });
  });
  test('late unexported claim outside a frozen manifest is repaired after coordinator restart', async () => {
    const job = await enqueue();
    await Run.create({ _id: 'old-closed', wire: { mode: 'automatic' }, manifest: [], state: 'closed', fence: 1 });
    await Job.updateOne({ _id: job._id }, { $set: { state: 'claimed', runId: 'old-closed' } });
    process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'false'; await tick();
    const repaired = await load(job._id); expect(repaired.state).toBe('queued'); expect(repaired.runId).toBeNull(); expect(repaired.attempts).toHaveLength(0);
  });
  test('manual empty queue drains without contacting an unhealthy Gateway', async () => {
    readiness.idle = false; await worker.manage(actor, 'start'); await tick();
    expect((await Control.findById('scheduler')).manualDeadline).toBeNull();
    expect((await Control.findById('scheduler')).reason).toBe('queue_drained'); expect(runs.size).toBe(0);
  });
  test('manual daytime start is bounded across cohorts, waits on readiness and stops on drain', async () => {
    clock = new Date('2026-10-16T03:00:00Z');
    await enqueue('manual-a'); await enqueue('manual-b', text('b'));
    await worker.manage(actor, 'start'); readiness.idle = false; await tick();
    const deadline = (await Control.findById('scheduler')).manualDeadline;
    expect(deadline.toISOString()).toBe('2026-10-16T08:00:00.000Z');
    readiness.idle = true; clock = new Date(+clock + 1800000); await tick();
    complete([...runs.values()][0]); await tick(); await tick();
    expect([...runs.values()][1].deadline).toBe(deadline.toISOString());
    complete([...runs.values()][1]); await tick(); await tick();
    expect((await Control.findById('scheduler')).manualDeadline).toBeNull();
  });
  test('safe retry retains logical identity and references the latest accepted attempt', async () => {
    const job = await enqueue(); await tick(); const run = [...runs.values()][0]; run.status = 'expired';
    Object.assign(run.operations[0], { status: 'interrupted', termination_proven: true, cleanup: 'verified' });
    await tick(); clock = new Date('2026-10-17T16:30:00Z'); await tick();
    const replacement = [...runs.values()][1].operations[0];
    expect(replacement.logical_job_id).toBe(job._id); expect(replacement.id).not.toBe(run.operations[0].id);
    expect(replacement.body.retry_of).toBe(run.operations[0].id);
  });
  test('terminal run label cannot turn an unresolved queued operation into a retry', async () => {
    const job = await enqueue(); await tick(); const run = [...runs.values()][0]; run.status = 'needs_review';
    await tick(); await tick(); expect((await load(job._id)).state).toBe('needs_review'); expect(runs.size).toBe(1);
    complete(run); await tick(); expect((await load(job._id)).published).toBe(true); expect(runs.size).toBe(1);
  });
  test('revoked machine owner token blocks export even after durable acceptance', async () => {
    const token = await service.issueToken(actor.ownerId, 'revoked');
    const machine = await service.authenticate(token.secret);
    const job = await service.submit(machine, 'revoked-job', text());
    await Job.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } });
    await Token.updateOne({ _id: token.id }, { $set: { revokedAt: new Date() } });
    await tick(); expect((await load(job._id)).state).toBe('needs_review');
    expect([...runs.values()].flatMap(r => r.operations)).toHaveLength(0);
  });
  test('missing remote evidence cannot starve later publication reconciliation', async () => {
    const jobs = [];
    for (let i = 0; i < 21; i += 1) {
      const job = await enqueue(`review-${i}`); jobs.push(job);
      await Job.updateOne({ _id: job._id }, { $set: { state: 'needs_review', attempts: [{ id: `operation-${i}`, runId: 'closed-run', body: { logical_job_id: job._id } }] } });
    }
    runs.set('closed-run', { status: 'needs_review', operations: [{ id: 'operation-20', logical_job_id: jobs[20]._id, status: 'succeeded', result: { done: true, message: { content: 'late result' } }, result_digest: 'late' }] });
    await tick(); expect((await load(jobs[20]._id)).published).toBe(false);
    await tick(); expect((await load(jobs[20]._id)).published).toBe(true);
  });
  test('HTTP machine identity, token revocation, browser CSRF and owner scope', async () => {
    const token = await service.issueToken(actor.ownerId, 'test');
    const api = express(); api.use('/api/local-ai/v1', createRouter({ service, worker }, { machine: true }));
    api.use((req, res, next) => { req.user = owner; req.isAuthenticated = () => true; req.session = { csrfToken: 'a'.repeat(43) }; next(); });
    api.use('/local-ai', createRouter({ service, worker }));
    const http = await listen(api); const base = `http://127.0.0.1:${http.address().port}`;
    try {
      let response = await fetch(`${base}/api/local-ai/v1/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token.secret}`, 'Idempotency-Key': 'http', 'Content-Type': 'application/json' }, body: JSON.stringify(text()) });
      expect(response.status).toBe(202); expect(response.headers.get('location')).toMatch(/^\/api\/local-ai\/v1\/jobs\//); const job = await response.json();
      expect(await Job.exists({ _id: job.id })).toBeTruthy();
      expect(job.result_url).toBe(`/api/local-ai/v1/jobs/${job.id}/result`);
      const pendingResult = await fetch(base + job.result_url, { headers: { Authorization: `Bearer ${token.secret}` } });
      expect(pendingResult.status).toBe(409);
      expect(pendingResult.headers.get('cache-control')).toBe('private, no-store');
      response = await fetch(`${base}/local-ai/api/v1/jobs/${job.id}/cancel`, { method: 'POST' }); expect(response.status).toBe(403);
      response = await fetch(`${base}/local-ai/api/v1/jobs/${job.id}/cancel`, { method: 'POST', headers: { 'X-CSRF-Token': 'a'.repeat(43), Origin: 'https://evil.invalid' } }); expect(response.status).toBe(403);
      await Token.updateOne({ _id: token.id }, { $set: { revokedAt: new Date() } });
      response = await fetch(`${base}/api/local-ai/v1/jobs`, { headers: { Authorization: `Bearer ${token.secret}` } }); expect(response.status).toBe(401);
      response = await fetch(`${base}/api/local-ai/v1/jobs?name=owner&api_key=legacy`); expect(response.status).toBe(401);
      await User.updateOne({ _id: owner._id }, { $set: { type_user: 'user' } });
      await expect(service.get(actor, job.id)).rejects.toMatchObject({ status: 403 });
    } finally { await new Promise(resolve => http.close(resolve)); }
  });
});
