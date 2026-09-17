/* Opt-in disposable DB only. Never uses MONGOOSE_URL or dotenv. */
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const models = require('../../models/taric_tool');
const AmiAmiItem = require('../../models/amiami_item');
const { createTaricEvidenceService } = require('../../services/taricEvidenceService');
const { createService } = require('../../services/taric/service');
const { createWorker } = require('../../services/taric/worker');
const { createTaricRouter } = require('../../routes/taric');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const { configuration } = require('../../services/taric/gate');
const { TEST_ADAPTER, hash } = require('../../utils/taricProtocol');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const uri = process.env.TARIC_TEST_MONGO_URL;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/taric_test_[a-z0-9_]+$/.test(uri || '') ? describe : describe.skip;
const requestInput = { item_code: 'SYNTHETIC-1', descriptive_name: 'Synthetic object', input_hs_code: '9503.00', test: true };
const row = { input: { descriptive_name: 'Synthetic object', full_item_name: 'Synthetic toy', specs: '', hs_code: '950300' }, target: '0000000001', summary: 'Synthetic description', inputHash: 'synthetic', overlapHash: 'synthetic', sourceHash: 'synthetic' };
const policy = { version: 'exact-all-cases/1', minExact: 1, maxInvalid: 0, denominator: 2 };
run('TARIC durable pipeline with real Mongo indexes', () => {
  let service, transport, evidence, principal, secret, worker;
  beforeAll(async () => {
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 3000 });
    for (const model of [...Object.values(models), AmiAmiItem]) { await model.createCollection(); await model.createIndexes(); }
  });
  afterAll(async () => { if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    for (const model of [...Object.values(models), AmiAmiItem]) await model.deleteMany({});
    await models.Settings.create({ _id: 'tool', revision: 1, enabled: true, owner: 'synthetic-owner', maxTokens: 256,
      currentBenchmark: null, catalog: null, runtime: { adapters: [] }, testCatalog: { source: 'training-derived/non-authoritative', codes: ['0000000001'] } });
    for (const name of ['management', 'inference']) await models.Control.create({ _id: name, until: new Date(0), holder: '' });
    transport = { configured: jest.fn(), adapters: jest.fn().mockResolvedValue([{ name: TEST_ADAPTER }]), verifyIdentity: jest.fn().mockResolvedValue(undefined),
      generate: jest.fn().mockResolvedValue({ taric_code: '0000000001', description: 'Synthetic description', verification: 'unverified', training_approved: false }) };
    evidence = { resolve: jest.fn().mockResolvedValue({ facts: { name: 'Synthetic toy', specifications: '' }, hash: 'synthetic' }) };
    service = createService({ models, transport, evidence, codeVersion: 'synthetic-code', authorizeAdmin: async actor => actor === 'a'.repeat(24) });
    secret = await service.rotate('synthetic-admin'); principal = await service.authenticate(secret);
    worker = createWorker(service, { authorizeAdmin: async () => true }); worker.start();
  });
  afterEach(() => worker?.stop());
  async function benchmark(version = 0) {
    const b = await models.Benchmark.create({ _id: String(version + 1).padStart(32, '0'), version,
      state: version ? 'published' : 'draft', releaseEligible: Boolean(version), contaminated: !version,
      sourceLineage: version ? ['independent'] : ['v0'], review: { independent: Boolean(version), targetsReviewed: true, trainingExcluded: true },
      manifest: { sha256: 'synthetic' }, cases: [row, { ...row, inputHash: 'synthetic2' }], policy });
    return b.toObject();
  }
  async function normalReady() {
    const b = await benchmark(1);
    const s = await service.settings();
    s.catalog = { approved: true, codes: ['0000000001'] };
    s.currentBenchmark = b._id;
    s.runtime = { adapters: [{ name: TEST_ADAPTER, identity: 'immutable-test', verified: true, trustSource: 'Synthetic gateway', deploymentRevision: 'd',
      baseRevision: 'b', tokenizerRevision: 't', adapterSha256: 'a'.repeat(64), validUntil: '2099-01-01' }] };
    await models.Settings.updateOne({ _id: 'tool' }, { $set: { catalog: s.catalog, currentBenchmark: s.currentBenchmark, runtime: s.runtime } });
    const config = configuration(s, TEST_ADAPTER, 'synthetic-code');
    await models.Run.create({ _id: 'b'.repeat(32), benchmark: b._id, adapter: TEST_ADAPTER, identity: 'immutable-test', fingerprint: hash(config),
      configuration: config, policy, state: 'complete', active: false, requestedCount: 2, actualCount: 2, exact: 2, invalid: 0,
      results: [{}, {}], score: 1, passed: true, cancelRequested: false });
    return b;
  }
  test('real AmiAmi aggregate projections, unique upsert race, JAN ambiguity and successful reuse', async () => {
    const fetchFactual = jest.fn(async code => ({ gcode: code, scode: 'independent-source', itemName: 'Synthetic database item', janCode: '00123456', specifications: null }));
    const a = createTaricEvidenceService({ itemModel: AmiAmiItem, fetchFactual });
    const b = createTaricEvidenceService({ itemModel: AmiAmiItem, fetchFactual });
    const { test, ...request } = { ...requestInput, input_hs_code: '950300' };
    const values = await Promise.all([a.resolve(request), b.resolve(request)]);
    expect(await AmiAmiItem.countDocuments({ gcode: request.item_code })).toBe(1);
    expect(values.every(v => v.gcode === request.item_code && v.provenance.scode === 'independent-source')).toBe(true);
    const before = fetchFactual.mock.calls.length; await a.resolve(request); expect(fetchFactual).toHaveBeenCalledTimes(before);
    await a.resolve({ ...request, item_code: 'SYNTHETIC-2' });
    const { item_code, ...janRequest } = request;
    await expect(a.resolve({ ...janRequest, jan: '00123456' })).rejects.toThrow('JAN_AMBIGUOUS');
    await expect(a.resolve({ ...request, jan: '87654321' })).rejects.toThrow('IDENTITY_MISMATCH');
  });
  test('normal closed before any evidence or provider work; input failures do not persist', async () => {
    await expect(service.submit(principal, 'normal-key-0000001', { ...requestInput, test: false })).rejects.toThrow('RELEASE_CLOSED');
    await expect(service.submit(principal, 'bad-key-000000001', { ...requestInput, test: 'true' })).rejects.toThrow('INVALID_REQUEST');
    expect(await models.Request.countDocuments()).toBe(0); expect(evidence.resolve).not.toHaveBeenCalled(); expect(transport.generate).not.toHaveBeenCalled();
  });
  test('hashed credentials, rotation, no secret in persistence/logs and generation conflicts', async () => {
    const result = await service.submit(principal, 'repeat-key-0000001', requestInput);
    const rotated = await service.rotate('synthetic-admin');
    await expect(service.authenticate(secret)).rejects.toThrow('UNAUTHORIZED');
    const next = await service.authenticate(rotated);
    await expect(service.submit(next, 'repeat-key-0000001', requestInput)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await worker.tick();
    expect((await models.Request.findById(result.id)).state).toBe('failed');
    const stored = JSON.stringify(await models.Credential.findById('integration').select('+digest').lean());
    expect(stored.includes(rotated)).toBe(false); expect(stored.includes(secret)).toBe(false);
    const logs = JSON.stringify(require('../../utils/logger').notice.mock.calls); expect(logs.includes(secret)).toBe(false);
    await service.revoke(); await expect(service.authenticate(rotated)).rejects.toThrow('UNAUTHORIZED');
  });
  test('expired credentials and removed scopes fail before request persistence', async () => {
    await models.Credential.updateOne({ _id: 'integration' }, { $set: { scopes: [] } });
    await expect(service.submit(principal, 'scope-denied-0001', requestInput)).rejects.toThrow('FORBIDDEN');
    await models.Credential.updateOne({ _id: 'integration' }, { $set: { expiresAt: new Date(0) } });
    await expect(service.authenticate(secret)).rejects.toThrow('UNAUTHORIZED');
    expect(await models.Request.countDocuments()).toBe(0);
  });
  test('shared credential rate counter admits only 120 concurrent calls per window', async () => {
    worker.stop();
    const results = await Promise.allSettled(Array.from({ length: 125 }, () => service.rate(principal)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(120);
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'RATE_LIMITED')).toBe(true);
  });
  test('atomic idempotency claim generates once across concurrent requests and workers', async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => service.submit(principal, 'concurrent-key-01', requestInput)));
    expect(new Set(rows.map(r => r.id)).size).toBe(1); expect(await models.Request.countDocuments()).toBe(1);
    const second = createWorker(service, { authorizeAdmin: async () => true }); second.start();
    try { await Promise.all([worker.tick(), second.tick()]); } finally { second.stop(); }
    expect(transport.generate).toHaveBeenCalledTimes(1);
    expect(transport.generate.mock.calls[0][1]).toBe(TEST_ADAPTER);
    const final = await service.retrieve(principal, rows[0].id);
    expect(final).toMatchObject({ state: 'complete', manual_confirmation_required: true, baseline: 'untested' });
    const replay = await service.submit(principal, 'concurrent-key-01', requestInput); expect(replay.id).toBe(rows[0].id);
    await expect(service.submit(principal, 'concurrent-key-01', { ...requestInput, test: false })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  test('twenty durable slots bound admission across races', async () => {
    worker.stop();
    const attempts = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => service.submit(principal, `bounded-key-${String(i).padStart(8, '0')}`, requestInput)));
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(20);
    expect(await models.Request.countDocuments({ active: true })).toBe(20);
  });
  test('in-flight revocation discards result; manual feedback can still be added after rotation', async () => {
    const r = await service.submit(principal, 'revoked-key-00001', requestInput);
    transport.generate.mockImplementationOnce(async () => { await service.revoke(); return { taric_code: '0000000001', description: 'Synthetic' }; });
    await worker.tick(); const stored = await models.Request.findById(r.id).lean();
    expect(stored).toMatchObject({ state: 'failed', result: null, error: 'FORBIDDEN' });
    const fresh = await service.authenticate(await service.rotate('synthetic-admin'));
    const f = await service.feedback(fresh, 'manual-key-0000001', r.id, { selected_code: '9999999999' });
    expect(f).toMatchObject({ decision: 'manual', catalog_status: 'unknown', verification: 'unverified', training_approved: false });
  });
  test('feedback derives decisions, is final/idempotent, enforces owner and preserves result', async () => {
    const r = await service.submit(principal, 'feedback-req-00001', requestInput); await worker.tick();
    const f = await service.feedback(principal, 'feedback-key-00001', r.id, { selected_code: '0000000001' });
    expect(f.decision).toBe('accepted');
    expect((await service.feedback(principal, 'feedback-key-00001', r.id, { selected_code: '0000000001' }))._id).toBe(f._id);
    await expect(service.feedback(principal, 'feedback-key-00002', r.id, { selected_code: '0000000002' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(service.feedback({ ...principal, owner: 'foreign' }, 'feedback-key-00003', r.id, { selected_code: '0000000001' })).rejects.toThrow('FORBIDDEN');
    expect((await service.retrieve(principal, r.id)).result.taric_code).toBe('0000000001');
  });
  test('orphan provider calls are interrupted, never silently retried', async () => {
    const r = await service.submit(principal, 'orphaned-key-00001', requestInput);
    await models.Request.updateOne({ _id: r.id }, { $set: { state: 'running', fence: 'dead-process' } });
    await worker.tick(); expect(transport.generate).not.toHaveBeenCalled();
    expect((await models.Request.findById(r.id)).state).toBe('interrupted');
  });
  test('lost lease fences completion and subsequent recovery never repeats provider call', async () => {
    const r = await service.submit(principal, 'fence-test-000001', requestInput);
    transport.generate.mockImplementationOnce(async () => {
      await models.Control.updateOne({ _id: 'inference' }, { $set: { holder: 'other', until: new Date(0) } });
      return { taric_code: '0000000001', description: 'Synthetic' };
    });
    await worker.tick(); await worker.tick();
    expect((await models.Request.findById(r.id)).state).toBe('interrupted'); expect(transport.generate).toHaveBeenCalledTimes(1);
  });
  test('all benchmark cases denominator includes invalids, interactive jobs get priority', async () => {
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    const r = await service.submit(principal, 'priority-key-00001', requestInput);
    await worker.tick(); expect((await models.Request.findById(r.id)).state).toBe('complete');
    expect((await models.Run.findById(run.id)).actualCount).toBe(0);
    transport.generate.mockRejectedValueOnce(new Error('synthetic failure'));
    await worker.tick(); await worker.tick();
    const result = await models.Run.findById(run.id).lean();
    expect(result).toMatchObject({ state: 'complete', actualCount: 2, requestedCount: 2, exact: 1, invalid: 1, score: .5, passed: false });
    expect(result.results).toHaveLength(2); await expect(service.admission(false)).rejects.toThrow('RELEASE_CLOSED');
  });
  test('cancelled benchmark stops future cases, never promotes', async () => {
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    await worker.tick(); await service.cancelRun(run.id); await worker.tick();
    expect(transport.generate).toHaveBeenCalledTimes(1);
    expect((await models.Run.findById(run.id)).state).toBe('cancelled');
  });
  test('runtime/config change during a normal call suppresses completion', async () => {
    await normalReady(); const r = await service.submit(principal, 'normal-race-00001', { ...requestInput, test: false });
    transport.generate.mockImplementationOnce(async () => {
      await models.Settings.updateOne({ _id: 'tool' }, { $inc: { revision: 1 } }); return { taric_code: '0000000001', description: 'Synthetic' };
    });
    await worker.tick(); expect((await models.Request.findById(r.id)).result).toBeNull();
    await expect(service.retrieve(principal, r.id)).rejects.toThrow('RELEASE_CLOSED');
  });
  test('uncertain generation holds all future work until explicit operator idle acknowledgement', async () => {
    const { TaricError } = require('../../utils/taricContracts');
    const r = await service.submit(principal, 'uncertain-0000001', requestInput);
    transport.generate.mockRejectedValueOnce(new TaricError('INFERENCE_UNCERTAIN'));
    await worker.tick();
    expect((await models.Request.findById(r.id)).error).toBe('INFERENCE_UNCERTAIN');
    expect((await models.Control.findById('inference')).blocked).toBe(true);
    await expect(service.submit(principal, 'uncertain-0000002', requestInput)).rejects.toThrow('INFERENCE_UNCERTAIN');
    await service.resumeInference();
    await service.submit(principal, 'uncertain-0000002', requestInput); await worker.tick();
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });
  test('independent imports are inert until explicit reviewed publication; cloned v0 cannot publish', async () => {
    const { preview, draft } = require('../../services/taric/importer');
    const review = { targetsReviewed: true, independent: true, trainingExcluded: true, provenance: 'Synthetic independent source', reviewer: 'test', sourceLineage: [], minExact: 1, maxInvalid: 0 };
    const header = 'descriptive_name,full_item_name,specs,hs_code,taric_code\n';
    const trainingCsv = Buffer.from(header + 'Synthetic toy,Synthetic old source,,9503.00,0000000001\n');
    await models.Benchmark.create({ _id: 'd'.repeat(32), ...draft(await preview(trainingCsv), 0, review, null) });
    const clone = await service.importBenchmark(trainingCsv, 1, review, 'test');
    await expect(service.publish(clone.id, 'test')).rejects.toThrow('OVERLAP');
    const independent = await service.importBenchmark(Buffer.from(header + 'Synthetic new category,Synthetic independent source,,0000.01,0000000001\n'), 2, review, 'test');
    expect((await service.settings()).currentBenchmark).toBeNull();
    await service.publish(independent.id, 'test');
    expect((await service.settings()).currentBenchmark).toBe(independent.id);
    expect((await models.Benchmark.findById(independent.id)).releaseEligible).toBe(true);
    await expect(service.admission(false)).rejects.toThrow('RELEASE_CLOSED');
  });
  test('kill switch saves even when verified Gateway metadata is unavailable', async () => {
    await normalReady(); const s = await service.settings();
    transport.verifyIdentity.mockRejectedValue(new Error('synthetic unavailable'));
    await service.saveConfig({ enabled: false, maxTokens: 256, catalog: null, runtime: s.runtime });
    expect((await service.settings()).enabled).toBe(false);
    expect(transport.verifyIdentity).not.toHaveBeenCalled();
  });
  test('current new publication holds prior normal retrieval/replay; draft is inert; replacement run closes gate', async () => {
    await normalReady(); const r = await service.submit(principal, 'normal-replay-001', { ...requestInput, test: false }); await worker.tick();
    await models.Benchmark.create({ _id: 'c'.repeat(32), version: 2, state: 'draft', cases: [row], policy });
    expect((await service.retrieve(principal, r.id)).state).toBe('complete');
    await service.queueRun('0'.repeat(31) + '2', TEST_ADAPTER, 'synthetic-admin');
    await expect(service.retrieve(principal, r.id)).rejects.toThrow('RELEASE_CLOSED');
    await models.Settings.updateOne({ _id: 'tool' }, { $set: { currentBenchmark: 'c'.repeat(32) } });
    await expect(service.submit(principal, 'normal-replay-001', { ...requestInput, test: false })).rejects.toThrow('RELEASE_CLOSED');
  });
  test('admin tests derive actual principal; machine principal cannot select admin jobs', async () => {
    const admin = await service.adminPrincipal('a'.repeat(24));
    const r = await service.submit(admin, 'admin-test-000001', requestInput); await worker.tick();
    expect((await service.retrieve(admin, r.id)).state).toBe('complete');
    await expect(service.retrieve(principal, r.id)).rejects.toThrow('NOT_FOUND');
  });
  test('machine router rejects session/global key, duplicate JSON and compressed/oversized bodies before work', async () => {
    const app = express(); app.use((req, _res, next) => { req.user = { type_user: 'admin' }; req.isAuthenticated = () => true; next(); });
    app.use('/api/taric/v1', createTaricRouter(service));
    app.use(express.json({ limit: '5mb' })); app.use('/api', (_req, res) => res.json({ legacy: true }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const send = (body, headers = {}) => fetch(`${base}/api/taric/v1/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
      expect((await send('{}', { Authorization: 'Bearer global-api-key' })).status).toBe(401);
      expect((await send('x'.repeat(10000))).status).toBe(401);
      const headers = { Authorization: `Bearer ${secret}`, 'Idempotency-Key': 'router-test-00001' };
      expect((await send('x'.repeat(5000), headers)).status).toBe(413);
      expect((await send('{"test":true,"test":false}', headers)).status).toBe(400);
      expect((await send('{}', { ...headers, 'Content-Encoding': 'gzip' })).status).toBe(400);
      const result = await send(JSON.stringify(requestInput), headers); expect(result.status).toBe(202);
      expect(result.headers.get('cache-control')).toContain('no-store');
      expect((await fetch(`${base}/api/taric/v1/unknown`, { headers })).status).toBe(404);
      const rawStatus = await new Promise(resolve => {
        const req = http.request(`${base}/api/taric/v1/requests`, { method: 'POST', headers: ['Host', `127.0.0.1:${server.address().port}`, 'Authorization', `Bearer ${secret}`, 'Authorization', `Bearer ${secret}`, 'Content-Type', 'application/json'] }, res => { res.resume(); resolve(res.statusCode); }); req.end('{}');
      }); expect(rawStatus).toBe(401);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  test('admin semantic capability, CSRF before upload and bounded inspection', async () => {
    const app = express(); let role = 'user'; const csrf = 'x'.repeat(43);
    app.set('views', require('path').join(__dirname, '../../views')); app.set('view engine', 'pug');
    app.use((req, _res, next) => { req.user = { _id: 'a'.repeat(24), name: 'synthetic', type_user: role }; req.isAuthenticated = () => true; req.session = { csrfToken: csrf }; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}/admin/taric`;
    try {
      expect((await fetch(`${base}/state`)).status).toBe(403); role = 'admin';
      expect((await fetch(`${base}/credential/revoke`, { method: 'POST' })).status).toBe(403);
      expect((await fetch(`${base}/imports`, { method: 'POST', body: 'x'.repeat(10000) })).status).toBe(403);
      const res = await fetch(`${base}/credential/revoke`, { method: 'POST', headers: { 'X-CSRF-Token': csrf, Origin: 'https://evil.test' } }); expect(res.status).toBe(403);
      expect((await fetch(`${base}/credential/revoke`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } })).status).toBe(200);
      expect((await fetch(`${base}/inspect/runs/bad?offset=-1`)).status).toBe(404);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
