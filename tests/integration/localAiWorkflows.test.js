jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn(), info: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const mongoose = require('mongoose');
require('../../database');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');
const { LocalAiService } = require('../../services/localAi/service');
const { Worker } = require('../../services/localAi/worker');
const { createRouter } = require('../../routes/localAi');
const { digest } = require('../../services/localAi/policy');
const db = require('../../models/local_ai');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const policies = require('../fixtures/local-ai/workflows-8105a1b.json');
const mapper = require('../../public/js/local-ai-workflows');
const suite = process.env.LOCAL_AI_TEST_MONGO_URI && process.env.LOCAL_AI_GATEWAY_SOURCE && process.env.LOCAL_AI_PROTOCOL_PYTHON ? describe : describe.skip;
suite('registered workflow durability and private HTTP with real Mongo and exact CPU Gateway output fixtures', () => {
  let sessionFixture;
  const env = { ...process.env };
  let root, fixtures, service, gateway, worker, actor, user, other, server, origin, runs, fault, calls;
  const clock = new Date('2026-10-17T17:30:00Z');
  const choose = name => policies.find(p => p.workflow_id === name);
  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/local_ai_test(?:\?|$)/.test(process.env.LOCAL_AI_TEST_MONGO_URI)) throw new Error('Disposable Mongo required');
    await new Promise(resolve => setImmediate(resolve)); await mongoose.connect(process.env.LOCAL_AI_TEST_MONGO_URI, { bufferCommands: false });
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-phase2-mongo-'));
    const cases = ['Z-Anime-Workflow-v1', 'video_minimax_h3_t2v'].map(name => ({ schema_version: 2, logical_job_id: 'job_site', type: 'comfy.workflow', request: mapper.map(choose(name), choose(name).graph, {}) }));
    const r = spawnSync(process.env.LOCAL_AI_PROTOCOL_PYTHON, ['tests/helpers/localAiPinnedWorkflows.py', process.env.LOCAL_AI_GATEWAY_SOURCE], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 ** 2 });
    if (r.status !== 0) throw new Error(r.stderr); fixtures = JSON.parse(r.stdout);
    gateway = {
      configured: () => true, monotonic: () => 100,
      capabilities: async () => ({ enabled: true, protocol: 'durable-local-ai', version: 1, constraints: { seal_required: true }, operation_schema_versions: [1, 2],
        features: { immutable_inputs: true, registered_comfy_workflows: true, artifact_manifests: true }, schema2: { supported_types: ['comfy.workflow'], run_manifest_required: true, operation_reservation_bytes: 35717120 } }),
      admissionClock: async () => ({ capabilities: await gateway.capabilities(), clock: { offsetMinMs: 0, offsetMaxMs: 0, sampledAtMonotonicMs: 100, sampledAtMs: +clock, lowerOffsetMs: 0, upperOffsetMs: 0 } }),
      readiness: async () => ({ healthy: true, idle: true, idle_proven: true }),
      capacity: async () => ({ available_bytes: 2 * 1024 ** 3, remaining_records: 1000 }),
      workflow: async id => choose(id),
      request: async (_method, url) => url === '/batch/activities' ? { activities: [] } : [...runs.values()].flatMap(r => r.operations).find(o => url.endsWith(o.id)),
      run: async id => { if (!runs.has(id)) throw Object.assign(new Error(), { status: 404 }); return structuredClone(runs.get(id)); },
      putRun: async (id, wire) => {
        calls.runs++; if (!runs.has(id)) runs.set(id, { ...wire, id, operations: [], status: 'open' });
        if (fault.run) { fault.run = false; throw Object.assign(new Error('lost reply'), { status: 502 }); }
        return gateway.run(id);
      },
      putOperation: async (run, id, body) => {
        if (fault.operation) throw Object.assign(new Error('backpressure'), { status: 507, code: 'storage_quota' });
        calls.operations++;
        if (!runs.get(run).operations.some(o => o.id === id)) runs.get(run).operations.push({ id, logical_job_id: body.logical_job_id, type: body.type, ...(body.schema_version === 2 ? { schema_version: 2 } : {}), request_digest: digest(body), status: 'queued', cleanup: 'not_required', termination_proven: true });
        return runs.get(run).operations.find(o => o.id === id);
      },
      start: async (id, seal) => { if (runs.get(id).schema_version === 2) expect(seal.operations).toEqual(runs.get(id).operations.map(o => ({ operation_id: o.id, request_digest: o.request_digest }))); calls.seals++; runs.get(id).status = 'ready'; },
      stop: async () => { calls.stops++; throw new Error('No stop expected'); },
      ack: async () => { calls.acks++; },
      artifact: async (_id, artifact) => {
        calls.downloads++;
        const item = fixtures.flatMap(f => f.operation.result.artifacts.map((a, i) => ({ a, download: f.downloads[i] }))).find(item => item.a.artifact_id === artifact);
        if (fault.download && item.a.slot === 1) throw Object.assign(new Error('lost'), { status: 502 });
        let bytes = Buffer.from(item.download.bytes, 'base64');
        if (fault.truncate) bytes = bytes.subarray(0, bytes.length - 5);
        if (fault.corrupt) bytes[bytes.length - 1] ^= 1;
        return { status: 200, headers: { ...item.download.headers, ...(fault.metadata ? { 'content-type': 'text/plain' } : {}) }, data: Readable.from([bytes]) };
      },
    };
    // Real clock evidence shape; no production clock/Gateway queried.
    gateway.admissionClock = async () => ({ capabilities: await gateway.capabilities(), clock: require('../../services/localAi/clock').clockEvidence({ date: clock.toUTCString() }, +clock, +clock, 0, 100) });
    sessionFixture = require('../helpers/localAiSessionGateway').installObject(gateway, () => clock);
    service = new LocalAiService({ gateway }); await service.initialize();
    const app = express(); app.set('view engine', 'pug'); app.set('views', path.resolve(__dirname, '../../views')); app.use((req, res, next) => { req.isAuthenticated = () => true; req.user = user; req.session = { csrfToken: 's'.repeat(43) }; next(); });
    app.use('/local-ai', createRouter({ service, worker: {} })); app.use('/api/local-ai/v1', createRouter({ service, worker: {} }, { machine: true }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); origin = `http://127.0.0.1:${server.address().port}`;
  }, 90000);
  beforeEach(async () => {
    sessionFixture.reset();
    await Promise.all([...Object.values(db), User, Role].map(m => m.deleteMany({})));
    await fs.rm(path.join(root, 'outputs'), { recursive: true, force: true });
    process.env.LOCAL_AI_OUTPUT_DATA_DIR = path.join(root, 'outputs'); process.env.LOCAL_AI_INPUT_DATA_DIR = path.join(root, 'inputs');
    process.env.LOCAL_AI_BATCH_ENABLED = 'true'; process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'true'; process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = 'true';
    user = await User.create({ name: 'owner', type_user: 'admin', email: 'owner@example.test', hash_password: 'unused' });
    other = await User.create({ name: 'foreign', type_user: 'admin', email: 'foreign@example.test', hash_password: 'unused' }); actor = { ownerId: String(user._id) };
    runs = new Map(); fault = {}; calls = { runs: 0, operations: 0, seals: 0, stops: 0, downloads: 0, acks: 0 };
    worker = new Worker(service, { ready: () => true, now: () => clock, terminated: async () => true }); worker.running = true;
  });
  afterEach(() => worker?.stop());
  afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await fs.rm(root, { recursive: true, force: true }); process.env = env; });
  async function submit(name, key) {
    const p = choose(name); const job = await service.submit(actor, key, { type: 'comfy.workflow', request: mapper.map(p, p.graph, {}) });
    await db.Job.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } }); return job;
  }
  async function success(job, index) {
    const current = await db.Job.findById(job._id).lean(); const remote = runs.get(current.runId); const op = remote.operations.find(o => o.logical_job_id === job._id);
    const fixture = fixtures[index]; op.status = 'succeeded'; op.result = structuredClone(fixture.operation.result);
    for (const a of op.result.artifacts) a.url = `/batch/operations/${op.id}/outputs/${a.artifact_id}`;
    op.result_digest = digest(op.result); remote.status = 'drained'; return op;
  }
  test('disabling media leaves queued schema-2 work blocked while v1 image jobs continue', async () => {
    const media = await submit('video_minimax_h3_t2v', 'pending-media');
    process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = 'false';
    const legacy = await service.submit(actor, 'legacy', { type: 'comfy.image', request: { prompt: require('../fixtures/local-ai/qwen.json') } });
    await db.Job.updateOne({ _id: legacy._id }, { $set: { nextAttemptAt: new Date(0) } });
    await worker.tick(); expect(calls.seals).toBe(1);
    const run = await db.Run.findOne({}).lean(); expect(run.wire.schema_version).toBeUndefined(); expect(run.manifest.map(e => e.body.type)).toEqual(['comfy.image']);
    const blocked = await db.Job.findById(media._id).lean(); expect(blocked.runId).toBeNull(); expect(blocked.state).toBe('queued');
    expect(require('../../services/localAi/service').publicJob(blocked).reason).toBe('batch_media_disabled');
  });
  test('lost run reply and storage rejection retain exact cohort; restart seals all eight-video selection as two', async () => {
    for (let i = 0; i < 8; i++) await submit('video_minimax_h3_t2v', 'video-' + i);
    fault.run = true; await worker.tick(); let run = await db.Run.findOne({}).lean(); expect(run.manifest).toHaveLength(2); expect(run.wire.operation_budgets).toHaveLength(2);
    const wire = structuredClone(run.wire); fault.operation = true;
    worker.stop(); worker = new Worker(service, { ready: () => true, now: () => clock, terminated: async () => true }); worker.running = true;
    await db.Control.updateOne({ _id: 'scheduler' }, { $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } }); await worker.tick();
    expect(calls.seals).toBe(0); expect(calls.stops).toBe(0); expect((await db.Run.findById(run._id)).wire).toEqual(wire);
    fault.operation = false; await db.Control.updateOne({ _id: 'scheduler' }, { $set: { nextAttemptAt: new Date(0) } }); await worker.tick();
    run = await db.Run.findById(run._id).lean(); expect(run.wire).toEqual(wire); expect(run.seal.operations).toHaveLength(2); expect(calls.seals).toBe(1); expect(calls.runs).toBe(1);
  });
  test('second PNG transfer failure keeps collecting without publish/ACK; flags OFF recovery publishes full gallery and byte ranges', async () => {
    const job = await submit('Z-Anime-Workflow-v1', 'two-png'); await worker.tick(); expect(calls.seals).toBe(1);
    await success(job, 0); fault.download = true; await worker.tick();
    let current = await db.Job.findById(job._id).lean(); expect(current.state).toBe('collecting'); expect(current.published).toBe(false); expect(calls.acks).toBe(0);
    const operations = calls.operations; process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = 'false'; process.env.LOCAL_AI_BATCH_ENABLED = 'false'; fault.download = false;
    await worker.tick(); current = await db.Job.findById(job._id).lean(); expect(current.result.artifacts).toHaveLength(2); expect(current.published).toBe(true); expect(current.acknowledged).toBe(true); expect(calls.acks).toBe(1); expect(calls.operations).toBe(operations);
    const page = await fetch(origin + `/local-ai/queue/${job._id}`); expect((await page.text()).match(/<img /g)).toHaveLength(2);
    const url = origin + `/local-ai/api/v1/jobs/${job._id}/outputs/1`;
    const get = await fetch(url, { headers: { Range: 'bytes=0-7' } }); expect(get.status).toBe(206); expect((await get.arrayBuffer()).byteLength).toBe(8); expect(get.headers.get('cache-control')).toBe('private, no-store'); expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=-5' } }); expect(head.status).toBe(206); expect(head.headers.get('content-length')).toBe('5'); expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(url, { headers: { Range: 'bytes=0-1,3-4' } })).status).toBe(416);
    expect((await fetch(url, { headers: { Range: 'bytes=0-7', 'If-Range': 'wrong' } })).status).toBe(200);
    user = other; expect((await fetch(url)).status).toBe(404);
    expect((await db.OutputQuota.findById('outputs')).allocations).toHaveLength(1);
  });
  test('MP4 audio bytes and metadata stay intact; owner machine token revocation prevents output access', async () => {
    const token = await service.issueToken(actor.ownerId, 'fixture'); const job = await submit('video_minimax_h3_t2v', 'video'); await worker.tick(); await success(job, 1); await worker.tick();
    const current = await db.Job.findById(job._id).lean(); expect(current.result.artifacts[0]).toMatchObject({ audio: true, media_type: 'video/mp4' });
    const url = origin + `/api/local-ai/v1/jobs/${job._id}/outputs/0`, headers = { Authorization: `Bearer ${token.secret}` };
    const response = await fetch(url, { headers }); expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(fixtures[1].downloads[0].bytes, 'base64'));
    const page = await fetch(origin + `/local-ai/queue/${job._id}`); expect(await page.text()).toContain('<video');
    await db.Token.updateOne({ _id: token.id }, { $set: { revokedAt: new Date() } }); expect((await fetch(url, { headers })).status).toBe(401);
  });
  test.each(['truncate', 'metadata', 'corrupt'])('MP4 %s failure never publishes/ACKs partial bytes or starts a replacement', async failure => {
    const job = await submit('video_minimax_h3_t2v', 'video-failure'); await worker.tick(); await success(job, 1); fault[failure] = true; await worker.tick();
    let current = await db.Job.findById(job._id).lean(); expect(current.published).toBe(false); expect(calls.acks).toBe(0); expect(calls.operations).toBe(1);
    expect(current.state).toBe(failure === 'corrupt' ? 'needs_review' : 'collecting');
    if (failure !== 'corrupt') {
      fault[failure] = false; await worker.tick(); current = await db.Job.findById(job._id).lean();
      expect(current.published).toBe(true); expect(calls.acks).toBe(1); expect(calls.operations).toBe(1);
    }
  });
  test('malformed successful manifest is needs_review, no regeneration or ACK; unknown digest and foreign source reject before acceptance', async () => {
    const job = await submit('Z-Anime-Workflow-v1', 'malformed'); await worker.tick(); const op = await success(job, 0); op.result.artifacts.pop(); await worker.tick();
    expect((await db.Job.findById(job._id)).state).toBe('needs_review'); expect(calls.acks).toBe(0); expect(calls.operations).toBe(1);
    const p = choose('image_qwen_image_2_1_image_edit_3ref');
    const input = await service.inputs.capture({ ownerId: String(other._id) }, 'foreign', Buffer.from(fixtures[0].downloads[0].bytes, 'base64'), { kind: 'upload' });
    const request = mapper.map(p, p.graph, Object.fromEntries(Object.keys(p.bindings).map(k => [k, { artifact_id: input._id, sha256: input.descriptor.sha256 }])));
    await expect(service.submit(actor, 'foreign-job', { type: 'comfy.workflow', request })).rejects.toMatchObject({ status: 404 });
    await expect(service.submit(actor, 'bad-version', { type: 'comfy.workflow', request: { ...request, template_sha256: 'a'.repeat(64) } })).rejects.toMatchObject({ status: 503 });
    expect(await db.Job.countDocuments()).toBe(1);
  });
});
