jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn(), info: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const mongoose = require('mongoose');
require('../../database'); // Actual preconnection compilation, buffering disabled.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { LocalAiService } = require('../../services/localAi/service');
const { Gateway } = require('../../services/localAi/gateway');
const { Worker } = require('../../services/localAi/worker');
const { createRouter } = require('../../routes/localAi');
const db = require('../../models/local_ai');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const Conversation = require('../../models/conversation5');
const Message = require('../../models/chat5');
const Card = require('../../models/ai_model_card');
const { CAP, digest } = require('../../services/localAi/policy');
const storage = require('../../services/localAi/inputStorage');
const { RESERVATION, OVERHEAD } = require('../../services/localAi/inputs');
const fixture = require('../fixtures/local-ai/media-consumer-2975356.json');
const suite = process.env.LOCAL_AI_TEST_MONGO_URI ? describe : describe.skip;
const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
suite('Phase 1 immutable inputs with real standalone Mongo and bounded HTTP transport', () => {
  let root, gatewayServer, site, origin, service, actor, other, user, bytes, runs, inputs, fault, worker, model, bearer;
  const env = { ...process.env };
  const clock = new Date('2026-10-17T17:30:01.600Z');
  const newWorker = () => { const w = new Worker(service, { ready: () => true, now: () => clock, terminated: async () => true }); w.running = true; return w; };
  const capture = async (key = 'upload') => service.inputs.capture(actor, key, bytes, { kind: 'upload' });
  const ref = record => ({ artifact_id: record._id, sha256: record.descriptor.sha256 });
  const submit = async (record, key = 'job', messages) => {
    const job = await service.submit(actor, key, { type: 'llm.chat', request: { model: model.id, messages: messages || [{ role: 'user', content: '', images: [ref(record)] }], max_tokens: 128 } });
    await db.Job.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } }); return job;
  };
  beforeAll(async () => {
    const uri = process.env.LOCAL_AI_TEST_MONGO_URI;
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/local_ai_test(?:\?|$)/.test(uri)) throw new Error('Disposable test Mongo required');
    await new Promise(resolve => setImmediate(resolve));
    await mongoose.connect(uri, { bufferCommands: false });
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-phase1-'));
    process.env.LOCAL_AI_INPUT_DATA_DIR = root;
    process.env.BATCH_SERVER_TOKEN = 'synthetic-test-only-'.padEnd(40, 'x'); process.env.BATCH_CLIENT_ID = 'site-test';
    bytes = await sharp({ create: { width: 20, height: 15, channels: 3, background: 'red' } }).png().toBuffer();
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { res.set('Date', 'Sat, 17 Oct 2026 17:30:00 GMT');
      if (req.get('Authorization') !== `Bearer ${process.env.BATCH_SERVER_TOKEN}` || req.get('X-Batch-Client') !== 'site-test') return res.sendStatus(401); next(); });
    app.get('/llm/models', (_req, res) => res.json({ models: [model] }));
    app.get('/batch/capabilities', (_req, res) => res.json({ ...fixture.transport, enabled: true, constraints: { seal_required: true },
      operation_schema_versions: [1, 2], features: { immutable_inputs: true, ollama_image_refs: true, shared_library_import: true },
      schema2: { max_images: 3, max_image_bytes: 6000000, max_input_bytes: 33554432, max_pixels: 16000000, max_edge: 8192, supported_types: ['llm.chat'], run_manifest_required: true, operation_reservation_bytes: 35717120 } }));
    app.get('/batch/readiness', (_req, res) => res.json({ healthy: true, idle: true, idle_proven: true }));
    app.get('/batch/activities', (_req, res) => res.json({ activities: [] }));
    app.get('/batch/capacity', (_req, res) => res.json({ available_bytes: fault.capacity || 2147483648, remaining_records: 1000 }));
    app.get('/batch/inputs/:id', (req, res) => { const input = inputs.get(req.params.id); return input ? res.json(input.descriptor) : res.status(404).json({ detail: { code: 'not_found' } }); });
    app.get('/batch/inputs/:id/content', (req, res) => res.type('png').send(inputs.get(req.params.id).bytes));
    app.put('/batch/inputs/:id', multer().single('file'), async (req, res) => {
      expect(JSON.parse(req.body.manifest)).toEqual(fixture.upload_manifest);
      const info = await storage.validateRaster(req.file.buffer);
      const descriptor = { ...info, artifact_id: req.params.id, schema_version: 2, request_digest: digest({ kind: 'upload', manifest: fixture.upload_manifest }), url: '/ignored' };
      inputs.set(req.params.id, { bytes: req.file.buffer, descriptor }); fault.uploads++;
      if (fault.loseUpload) { fault.loseUpload = false; return req.socket.destroy(); }
      res.status(201).json(descriptor);
    });
    app.put('/batch/inputs/:id/import', async (req, res) => {
      const data = fault.library || bytes;
      expect(req.body.schema_version).toBe(2);
      if (storage.hash(data) !== req.body.expected_sha256) return res.status(409).json({ detail: { code: 'source_revision_mismatch' } });
      const descriptor = { ...await storage.validateRaster(data), artifact_id: req.params.id, schema_version: 2, request_digest: digest({ kind: 'comfy_shared_library', ...req.body }), url: 'http://foreign.invalid/no' };
      inputs.set(req.params.id, { bytes: data, descriptor }); fault.imports++;
      res.status(201).json(descriptor);
    });
    app.get('/batch/runs/:id', (req, res) => runs.has(req.params.id) ? res.json(runs.get(req.params.id)) : res.status(404).json({ detail: { code: 'not_found' } }));
    app.put('/batch/runs/:id', (req, res) => {
      expect(req.body.schema_version).toBe(2); expect(req.body.operation_ids.length).toBeGreaterThan(0);
      if (runs.has(req.params.id)) expect(req.body).toEqual(runs.get(req.params.id).wire);
      if (!runs.has(req.params.id)) runs.set(req.params.id, { ...req.body, id: req.params.id, wire: req.body, status: 'open', operations: [] });
      fault.reservations++;
      if (fault.loseRun) { fault.loseRun = false; return req.socket.destroy(); }
      res.json(runs.get(req.params.id));
    });
    app.put('/batch/runs/:run/operations/:id', (req, res) => {
      const run = runs.get(req.params.run); expect(run.operation_ids).toContain(req.params.id);
      expect(req.body.schema_version).toBe(2);
      for (const ref of req.body.request.messages.flatMap(m => m.images || [])) expect(inputs.get(ref.artifact_id).descriptor.sha256).toBe(ref.sha256);
      let op = run.operations.find(o => o.id === req.params.id);
      if (op) expect(op.request_digest).toBe(digest(req.body));
      else { op = { ...req.body, id: req.params.id, run_id: run.id, status: 'queued', request_digest: digest(req.body), termination_proven: true, cleanup: 'not_required' }; run.operations.push(op); }
      if (fault.badDigest) op.request_digest = 'a'.repeat(64);
      res.status(202).json(op);
    });
    app.post('/batch/runs/:id/start', (req, res) => {
      const run = runs.get(req.params.id);
      expect(req.body).toEqual({ operations: run.operation_ids.map(id => ({ operation_id: id, request_digest: run.operations.find(o => o.id === id).request_digest })) });
      run.status = 'running'; fault.seals++; res.json(run);
    });
    app.post('/batch/runs/:id/stop', (req, res) => { const run = runs.get(req.params.id); run.status = 'stopped'; fault.stops++; res.json(run); });
    gatewayServer = await listen(app); process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${gatewayServer.address().port}`;
    service = new LocalAiService({ gateway: new Gateway({ now: () => +clock, monotonic: () => +clock }) }); await service.initialize();
    const siteApp = express();
    siteApp.use((req, res, next) => { req.isAuthenticated = () => true; req.user = user; req.session = { csrfToken: 's'.repeat(43) }; next(); });
    siteApp.use('/local-ai', createRouter({ service, worker: {} }));
    siteApp.use('/api/local-ai/v1', createRouter({ service, worker: {} }, { machine: true }));
    site = await listen(siteApp); origin = `http://127.0.0.1:${site.address().port}`;
  });
  beforeEach(async () => {
    await Promise.all([...Object.values(db), User, Role, Conversation, Message, Card].map(m => m.deleteMany({})));
    user = await User.create({ name: 'owner', email: 'synthetic@example.test', type_user: 'admin', hash_password: 'unused' });
    other = await User.create({ name: 'other', email: 'other@example.test', type_user: 'admin', hash_password: 'unused' });
    actor = { ownerId: String(user._id) };
    process.env.LOCAL_AI_BATCH_ENABLED = 'true'; process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = 'true'; process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'true';
    delete process.env.LOCAL_AI_INPUT_QUOTA_BYTES; delete process.env.LOCAL_AI_INPUT_OWNER_QUOTA_BYTES;
    runs = new Map(); inputs = new Map(); fault = { uploads: 0, seals: 0, reservations: 0, imports: 0, stops: 0 };
    model = { id: 'gemma3:12b', provider: 'ollama', upstream_model: 'gemma3:12b', allow_images: true, keep_alive: '5m', limits: { max_output_tokens: 8192, max_context_tokens: 131072, max_prompt_chars: 100000, max_images: 3, max_image_bytes: 6000000 } };
    worker = newWorker(); bearer = await service.issueToken(actor.ownerId, 'test');
  });
  afterEach(() => { worker.stop(); jest.restoreAllMocks(); });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await Promise.all([site, gatewayServer].map(s => new Promise(resolve => s.close(resolve)))); await fs.rm(root, { recursive: true, force: true }); process.env = env; });
  test('upload HTTP authorizes before multipart consumption; CSRF, owner isolation, lookup and revoked token', async () => {
    const form = () => { const f = new FormData(); f.append('file', new Blob([bytes]), '../untrusted.png'); return f; };
    let r = await fetch(origin + '/local-ai/api/v1/inputs', { method: 'POST', body: form() }); expect(r.status).toBe(403);
    expect(await db.Input.countDocuments()).toBe(0);
    r = await fetch(origin + '/api/local-ai/v1/inputs', { method: 'POST', body: form(), headers: { Authorization: `Bearer ${bearer.secret}`, 'Idempotency-Key': 'api', 'X-Content-SHA256': storage.hash(bytes) } });
    expect(r.status).toBe(201); const d = await r.json(); expect(d.sha256).toBe(storage.hash(bytes));
    r = await fetch(origin + '/api/local-ai/v1/inputs/by-key/api', { headers: { Authorization: `Bearer ${bearer.secret}` } }); expect((await r.json()).artifact_id).toBe(d.artifact_id);
    await expect(service.inputs.lookup({ ownerId: String(other._id) }, d.artifact_id)).rejects.toMatchObject({ status: 404 });
    await db.Token.updateOne({ _id: bearer.id }, { $set: { revokedAt: new Date() } });
    r = await fetch(origin + '/api/local-ai/v1/inputs/' + d.artifact_id, { headers: { Authorization: `Bearer ${bearer.secret}` } }); expect(r.status).toBe(401);
  });
  test('immutable publication recovers lost DB ack, restart and exact replay; retained bytes survive job release', async () => {
    const record = await service.inputs.prepare(actor, 'lost', storage.hash(bytes));
    const original = db.Input.findOneAndUpdate.bind(db.Input);
    const spy = jest.spyOn(db.Input, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
      const query = original(filter, update, options);
      if (update.$set?.state !== 'ready') return query;
      return { lean: async () => { await query.lean(); throw new Error('lost DB ack'); } };
    });
    await expect(service.inputs.accept(actor, record, bytes)).rejects.toThrow('lost DB ack'); spy.mockRestore();
    const restarted = new LocalAiService({ gateway: service.gateway }); await restarted.initialize();
    const ready = await restarted.inputs.accept(actor, await restarted.inputs.lookup(actor, null, 'lost'), bytes);
    expect(await storage.read(ready._id, ready.descriptor)).toEqual(bytes);
    const job = await submit(ready); await service.cancel(actor, job._id); await service.reconcileCapacity();
    const quota = await db.InputQuota.findById('inputs').lean(); expect(quota.allocations).toEqual([{ id: ready._id, ownerId: actor.ownerId, bytes: bytes.length + OVERHEAD }]);
    await expect(service.inputs.prepare(actor, 'lost', 'a'.repeat(64))).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(await db.Input.find({}).lean())).not.toContain(bytes.toString('base64'));
  });
  test('quota reservations race atomically and retained actual bytes do not depend on job slots', async () => {
    process.env.LOCAL_AI_INPUT_OWNER_QUOTA_BYTES = String(RESERVATION);
    const results = await Promise.allSettled(['one', 'two', 'three'].map(k => service.inputs.prepare(actor, k, storage.hash(bytes))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 507)).toBe(true);
    const record = results.find(r => r.status === 'fulfilled').value; await service.inputs.accept(actor, record, bytes);
    await expect(service.inputs.prepare(actor, 'four', storage.hash(bytes))).rejects.toMatchObject({ status: 507 });
    const quota = await db.InputQuota.findById('inputs').lean(); expect(quota.allocations[0].bytes).toBe(bytes.length + OVERHEAD);
  });
  test('lost staging receipt prevents run admission, retry looks up original and exact-seals deduplicated cohort', async () => {
    const record = await capture(); await submit(record, 'one'); await submit(record, 'two'); fault.loseUpload = true;
    await worker.tick(); expect(fault.seals).toBe(0); expect(fault.reservations).toBe(0); expect(fault.uploads).toBe(1);
    await db.Control.updateOne({ _id: 'scheduler' }, { $set: { nextAttemptAt: new Date(0) } });
    await worker.tick(); expect(fault.uploads).toBe(1); expect(fault.seals).toBe(1);
    const run = await db.Run.findOne({}).lean(); expect(run.wire.operation_ids).toEqual(run.manifest.map(e => e.id));
    expect(run.manifest).toHaveLength(2); expect(run.manifest.every(e => e.body.schema_version === 2)).toBe(true);
    expect(inputs.get(record._id).bytes).toEqual(bytes);
  });
  test('whole-cohort size uses live capacity; lost reservation reply preserves manifest and seal', async () => {
    const record = await capture(); await submit(record, 'one'); await submit(record, 'two'); fault.capacity = 35717120 + 1048576; fault.loseRun = true;
    await worker.tick(); expect(fault.seals).toBe(0); const original = await db.Run.findOne({}).lean(); expect(original.manifest).toHaveLength(1);
    worker.stop(); worker = newWorker(); await db.Control.updateOne({ _id: 'scheduler' }, { $set: { leaseUntil: new Date(0) } }); await worker.tick();
    const recovered = await db.Run.findById(original._id).lean(); expect(recovered.wire).toEqual(original.wire); expect(recovered.manifest).toEqual(original.manifest); expect(fault.seals).toBe(1); expect(fault.reservations).toBe(1);
  });
  test('bad accepted digest never seals and policy changes block before export', async () => {
    const record = await capture(); const job = await submit(record); model.allow_images = false;
    await expect(service.validateFrozen(job)).rejects.toThrow('frozen_model_policy_changed'); await worker.tick(); expect(fault.seals).toBe(0); expect(fault.uploads).toBe(0);
    expect((await db.Job.findById(job._id)).state).toBe('needs_review');
    model.allow_images = true; await submit(record, 'new-policy-job'); fault.badDigest = true; await db.Control.updateOne({ _id: 'scheduler' }, { $set: { nextAttemptAt: new Date(0) } });
    await worker.tick(); expect(fault.seals).toBe(0); expect(fault.stops).toBe(1);
  });
  test('aggregate budgets, foreign refs and nonvision are rejected before accepted job', async () => {
    const record = await capture();
    await expect(submit(record, 'four', [{ role: 'user', content: '', images: [ref(record), ref(record), ref(record)] }, { role: 'user', content: '', images: [ref(record)] }])).rejects.toThrow('image_catalog_budget');
    model.limits.max_image_bytes = bytes.length - 1; await expect(submit(record)).rejects.toThrow('image_catalog_budget');
    model.limits.max_image_bytes = bytes.length; // Padding estimate may exceed exact bytes.
    if (bytes.length % 3) await expect(submit(record)).rejects.toThrow('image_catalog_budget');
    model.allow_images = false; await expect(submit(record)).rejects.toThrow('model_not_vision'); model.allow_images = true;
    await expect(service.inputs.resolve({ ownerId: String(other._id) }, ref(record))).rejects.toMatchObject({ status: 404 });
    expect(await db.Job.countDocuments()).toBe(0);
  });
  test('shared-library capability and typed revision are mandatory, replay never rereads mutable source', async () => {
    await User.updateOne({ _id: user._id }, { $set: { type_user: 'user' } });
    await Role.create({ name: user.name, type: 'user', permissions: [CAP.use] });
    const raw = { source: { filename: 'reference.png', subfolder: 'approved' }, expected_sha256: storage.hash(bytes) };
    await expect(service.inputs.importShared(actor, 'library', raw)).rejects.toMatchObject({ status: 403 });
    await Role.updateOne({ name: user.name }, { $addToSet: { permissions: CAP.importShared } });
    const record = await service.inputs.importShared(actor, 'library', raw); fault.library = Buffer.from('changed original');
    const replay = await service.inputs.importShared(actor, 'library', raw); expect(replay._id).toBe(record._id); expect(fault.imports).toBe(1);
    expect(await storage.read(record._id, record.descriptor)).toEqual(bytes);
    await expect(service.inputs.importShared({ ...actor, tokenId: bearer.id }, 'machine-library', raw)).rejects.toMatchObject({ status: 401 });
  });
  test('Chat5 provenance requires trusted author+conversation+filename; selected window and frozen replay ignore later filename edits', async () => {
    await Card.create({ api_model: model.id, model_name: 'Vision', provider: 'Local', model_type: 'chat', max_out_tokens: 128, context_type: 'system', batch_use: false, added_date: new Date(), max_tokens: 8192, input_1m_token_cost: 0, output_1m_token_cost: 0 });
    const message = await Message.create({ user_id: user.name, category: 'test', contentType: 'image', content: { image: 'reference.jpg' } });
    const conv = await Conversation.create({ title: 'test', category: 'test', members: [user.name], messages: [String(message._id)], metadata: { model: model.id, reasoning: 'none' } });
    const raw = { type: 'chat5.response', conversation_id: String(conv._id), prompt: '' };
    await expect(service.submit(actor, 'chat', raw)).rejects.toThrow('batch_image_source_requires_reupload');
    const record = await service.inputs.capture(actor, 'trusted', bytes, { kind: 'chat5-upload', conversationId: String(conv._id), messageId: String(message._id), author: user.name, filename: 'reference.jpg' });
    const job = await service.submit(actor, 'chat', raw); expect(job.request.messages.at(-1)).toEqual({ role: 'user', content: '', images: [ref(record)] });
    await Message.updateOne({ _id: message._id }, { $set: { 'content.image': '../secret' } });
    expect((await service.submit(actor, 'chat', raw)).request).toEqual(job.request); await service.validateFrozen(job);
    await expect(service.submit(actor, 'edited', raw)).rejects.toThrow('batch_image_source_requires_reupload');
    await Conversation.updateOne({ _id: conv._id }, { $set: { members: [other.name] } });
    await expect(service.validateFrozen(job)).rejects.toMatchObject({ status: 403 });
  });
  test('trusted Chat5 JPEG capture has deterministic new conversation/message recovery and uses frozen bytes', async () => {
    const chat = require('../../services/localAi/chatUpload');
    const key = 'new-chat-upload';
    const conversationId = await chat.startConversation({ service, actor, key });
    expect(await chat.startConversation({ service, actor, key })).toBe(conversationId);
    const normalized = await sharp(bytes).jpeg().toBuffer();
    let calls = 0;
    const normalize = async options => {
      calls++;
      const actual = options.frozenBytes || normalized;
      await options.beforePublish(actual);
    };
    const first = await chat.upload({ service, actor, key, conversationId, bytes, normalize });
    const replay = await chat.upload({ service, actor, key, conversationId, bytes, normalize: async options => {
      expect(options.frozenBytes).toEqual(normalized); await normalize(options);
    } });
    expect(replay.artifact).toEqual(first.artifact); expect(calls).toBe(2);
    expect((await Conversation.findById(conversationId)).messages).toEqual([String(first.userMessage._id)]);
    expect(await Message.countDocuments()).toBe(1);
    const record = await service.inputs.lookup(actor, first.artifact.artifact_id);
    expect(await storage.read(record._id, record.descriptor)).toEqual(normalized);
    await expect(chat.upload({ service, actor: { ownerId: String(other._id) }, key, conversationId, bytes, normalize })).rejects.toMatchObject({ status: 403 });
  });
  test('interrupted scratch and durable file before journal publication recover under dead-writer fence', async () => {
    const record = await service.inputs.prepare(actor, 'scratch', storage.hash(bytes));
    await fs.writeFile(path.join(root, `${record._id}.part`), 'partial');
    await db.Input.updateOne({ _id: record._id }, { $set: { writer: { holder: 'dead', ownerHost: os.hostname(), ownerPid: 2147483646 } } });
    const publish = storage.publish;
    const fail = jest.spyOn(storage, 'publish').mockImplementationOnce(async (...args) => { await publish(...args); throw new Error('crash after rename'); });
    await expect(service.inputs.accept(actor, record, bytes)).rejects.toThrow('crash after rename'); fail.mockRestore();
    expect((await db.Input.findById(record._id)).state).toBe('preparing');
    expect((await db.InputQuota.findById('inputs')).allocations[0].bytes).toBe(RESERVATION);
    const ready = await service.inputs.accept(actor, record, bytes);
    expect(await storage.read(ready._id, ready.descriptor)).toEqual(bytes);
    expect((await db.InputQuota.findById('inputs')).allocations[0].bytes).toBe(bytes.length + OVERHEAD);
  });
  test('a live preparation writer is never stolen and corruption blocks accepted job', async () => {
    const record = await service.inputs.prepare(actor, 'live', storage.hash(bytes));
    await db.Input.updateOne({ _id: record._id }, { $set: { writer: { holder: 'live', ...await require('../../services/localAi/coordinator').ownerIdentity() } } });
    await expect(service.inputs.accept(actor, record, bytes)).rejects.toThrow('input_preparation_busy');
    await db.Input.updateOne({ _id: record._id }, { $unset: { writer: 1 } });
    const ready = await service.inputs.accept(actor, record, bytes);
    await fs.writeFile(path.join(root, `${record._id}.blob`), 'corrupt');
    await expect(submit(ready)).rejects.toThrow('input_integrity_failed'); expect(await db.Job.countDocuments()).toBe(0);
  });

  test('lost writer acquisition acknowledgement recovers only its own persisted holder', async () => {
    const record = await service.inputs.prepare(actor, 'lock-ack', storage.hash(bytes));
    const original = db.Input.findOneAndUpdate.bind(db.Input);
    jest.spyOn(db.Input, 'findOneAndUpdate').mockImplementationOnce((...args) => ({ lean: async () => {
      await original(...args).lean(); throw new Error('lost lock reply');
    } }));
    const ready = await service.inputs.accept(actor, record, bytes);
    expect(ready.state).toBe('ready'); expect((await db.Input.findById(record._id)).writer).toBeUndefined();
  });

});
