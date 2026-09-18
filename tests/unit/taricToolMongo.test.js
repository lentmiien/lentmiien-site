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
  let service, transport, evidence, principal, secret, worker, warmSessions;
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
    warmSessions = { ready: () => true, open: jest.fn().mockResolvedValue({ id: 'synthetic-session' }),
      renew: jest.fn().mockImplementation(async () => ({ expiresAt: Date.now() + 120000, hardExpiresAt: Date.now() + 900000 })), close: jest.fn().mockResolvedValue({ idle: true }),
      status: jest.fn().mockResolvedValue({ idle: true, terminal: true, correlated: true }),
      probe: jest.fn().mockResolvedValue({ idle: true }),
      generate: jest.fn((session, input, codes, tokens, options) => transport.generate(input, TEST_ADAPTER, codes, tokens, null, options)) };
    service = createService({ warmSessions, models, transport, evidence, codeVersion: 'synthetic-code', authorizeAdmin: async actor => actor === 'a'.repeat(24) });
    secret = await service.rotate('synthetic-admin'); principal = await service.authenticate(secret);
    worker = createWorker(service, { authorizeAdmin: async () => true, batchCases: 1 }); worker.start();
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
  test('rejected visible output and resolved evidence survive holds, disablement and provider failure without bypassing scope', async () => {
    const { output } = require('../../utils/taricProtocol');
    const text = JSON.stringify({ taric_code: '9999999999', description: '<script>unsafe()</script>' });
    const r = await service.submit(principal, 'diagnostic-test-001', requestInput);
    transport.generate.mockImplementationOnce(async (...args) => output({ content: text, reasoning: 'hidden', tools: 'hidden' }, ['0000000001'], args[5].onDiagnostics));
    await worker.tick();
    await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true } });
    await models.Settings.updateOne({ _id: 'tool' }, { $set: { enabled: false } });
    transport.configured.mockImplementation(() => { throw new Error('provider unavailable'); });
    const result = await service.retrieve(principal, r.id);
    expect(result).toMatchObject({ state: 'failed', result: null, error: 'CATALOG_REJECTED',
      diagnostics: { label: 'REJECTED', visibleText: text, recognizedCode: false, applicable: false, training_approved: false }, evidence: { hash: 'synthetic' } });
    expect(result.help).toContain('does not establish');
    expect(JSON.stringify(result)).not.toContain('hidden');
    await expect(service.retrieve({ ...principal, owner: 'foreign' }, r.id)).rejects.toThrow('FORBIDDEN');
    await service.revoke(); await expect(service.retrieve(principal, r.id)).rejects.toThrow('FORBIDDEN');
  });
  test.each(['EVIDENCE_NOT_FOUND', 'JAN_AMBIGUOUS'])('JAN %s resolves no fabricated evidence and performs no inference', async code => {
    const { TaricError } = require('../../utils/taricContracts');
    const r = await service.submit(principal, 'missing-jan-00001', { jan: '1234567890123', descriptive_name: 'Synthetic', input_hs_code: '950300', test: true });
    evidence.resolve.mockRejectedValueOnce(new TaricError(code)); await worker.tick();
    const result = await service.retrieve(principal, r.id);
    expect(result).toMatchObject({ error: code, evidence: null, diagnostics: null, diagnosticsStatus: 'not_captured' });
    expect(result.help).toContain('item code'); expect(transport.generate).not.toHaveBeenCalled();
  });
  test('synthetic 67-case run records uncertain case twelve, correlates terminal idle and continues case thirteen without retry', async () => {
    worker.stop(); worker = createWorker(service, { authorizeAdmin: async () => true, batchCases: 8 }); worker.start();
    const b = await benchmark();
    await models.Benchmark.updateOne({ _id: b._id }, { $set: { cases: Array.from({ length: 67 }, (_, i) => ({ ...row, inputHash: `synthetic-${i}` })), policy: { ...policy, denominator: 67 } } });
    let calls = 0;
    transport.generate.mockImplementation(async () => {
      calls++;
      if (calls === 12) throw new (require('../../utils/taricContracts').TaricError)('INFERENCE_UNCERTAIN');
      return { taric_code: '0000000001', description: 'Synthetic' };
    });
    const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    for (let i = 0; i < 9; i++) await worker.tick();
    const result = await models.Run.findById(run.id).lean();
    expect(result).toMatchObject({ state: 'complete', attemptedCount: 67, actualCount: 67, requestedCount: 67, exact: 66, invalid: 1, passed: false });
    expect(result.results).toHaveLength(67); expect(result.results[11]).toMatchObject({ index: 11, error: 'INFERENCE_UNCERTAIN', exact: false });
    expect(await models.Attempt.countDocuments({ run: run.id })).toBe(67);
    expect(transport.generate).toHaveBeenCalledTimes(67); expect(warmSessions.status).toHaveBeenCalledTimes(67);
    expect(warmSessions.close).toHaveBeenCalledTimes(9);
    await expect(models.Attempt.create({ _id: 'duplicate', run: run.id, index: 11 })).rejects.toMatchObject({ code: 11000 });
  });
  test('cross-contract real HTTP + Mongo: 67 durable results, case12 disconnect remote200 failed, cases13–67 complete', async () => {
    const { gatewayFixture } = require('../helpers/taricGateway');
    const fixture = await gatewayFixture(); fixture.dropAt = 12;
    worker.stop();
    try {
      const actualTransport = require('../../services/taric/transport').createTransport({ env: fixture.env });
      const actualSessions = require('../../services/taric/warmSession').createWarmSessions(actualTransport.sessionAdapter);
      service = createService({ models, transport: actualTransport, evidence, warmSessions: actualSessions, codeVersion: 'synthetic-contract', authorizeAdmin: async () => true });
      worker = createWorker(service, { authorizeAdmin: async () => true }); worker.start();
      const b = await benchmark();
      await models.Benchmark.updateOne({ _id: b._id }, { $set: { cases: Array.from({ length: 67 }, (_, i) => ({ ...row, inputHash: `contract-${i}` })), policy: { ...policy, denominator: 67 } } });
      const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
      for (let i = 0; i < 9; i++) await worker.tick();
      const result = await models.Run.findById(run.id).lean();
      expect(result).toMatchObject({ state: 'complete', actualCount: 67, attemptedCount: 67, exact: 66, invalid: 1, errorCount: 1, passed: false });
      expect(result.results).toHaveLength(67);
      expect(result.results[11]).toMatchObject({ result: null, error: 'INFERENCE_UNCERTAIN', index: 11 });
      expect(result.results[12].result.taric_code).toBe('0000000001');
      expect(await models.Attempt.countDocuments({ run: run.id })).toBe(67);
      expect(new Set(result.results.map(a => a.correlationId)).size).toBe(67);
      expect(result.results.every(a => a.sessionId)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('synthetic-owner-capability');
      expect(JSON.stringify(await models.Control.find({}).lean())).not.toContain('synthetic-owner-capability');
      expect(fixture.generateCount).toBe(67); expect(fixture.sessions).toHaveLength(9);
      expect(fixture.sessions.every(s => s.reclaim_verified)).toBe(true);
      expect((await models.Benchmark.findById(b._id)).releaseEligible).toBe(false);
    } finally { worker.stop(); await fixture.close(); }
  });
  test('real HTTP + Mongo ordinary TEST uses one owned session without benchmark identity; revocation still denies terminal reads', async () => {
    const { gatewayFixture } = require('../helpers/taricGateway'); const fixture = await gatewayFixture(); worker.stop();
    let server;
    try {
      const actualTransport = require('../../services/taric/transport').createTransport({ env: fixture.env });
      service = createService({ models, transport: actualTransport, evidence,
        warmSessions: require('../../services/taric/warmSession').createWarmSessions(actualTransport.sessionAdapter), codeVersion: 'synthetic', authorizeAdmin: async () => true });
      worker = createWorker(service, { authorizeAdmin: async () => true }); worker.start();
      const app = express(); app.use('/api/taric/v1', createTaricRouter(service));
      server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'contract-test-once01' };
      const accepted = await fetch(base + '/api/taric/v1/requests', { method: 'POST', headers, body: JSON.stringify(requestInput) });
      expect(accepted.status).toBe(202); const job = await accepted.json(); await worker.tick();
      const finished = await (await fetch(base + job.poll_url, { headers })).json();
      expect(finished).toMatchObject({ state: 'complete', test: true, adapter: TEST_ADAPTER, result: { taric_code: '0000000001' } });
      const saved = await models.Request.findById(job.id).lean(); expect(saved.sessionId).toBe('session-1'); expect(saved.correlationId).toMatch(/^[a-f0-9]{32}$/);
      expect(JSON.stringify(saved)).not.toContain('synthetic-owner-capability'); expect(fixture.generateCount).toBe(1);
      expect(fixture.sessions[0].reclaim_verified).toBe(true);
      expect((await models.Control.findById('inference')).sessionId).toBeNull();
      await service.revoke(); expect((await fetch(base + job.poll_url, { headers })).status).toBe(401);
    } finally { worker.stop(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await fixture.close(); }
  });
  test('reclaimed remote session rotates after a lost result without retrying that case', async () => {
    const { gatewayFixture } = require('../helpers/taricGateway'); const fixture = await gatewayFixture(); worker.stop();
    try {
      fixture.dropAt = 1;
      fixture.onGenerate = async session => { if (fixture.generateCount === 1) { session.state = 'expired'; session.reclaim_verified = true; session.idle_proven = false; } };
      const actualTransport = require('../../services/taric/transport').createTransport({ env: fixture.env });
      service = createService({ models, transport: actualTransport, evidence,
        warmSessions: require('../../services/taric/warmSession').createWarmSessions(actualTransport.sessionAdapter), codeVersion: 'synthetic', authorizeAdmin: async () => true });
      worker = createWorker(service, { authorizeAdmin: async () => true }); worker.start();
      const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
      await worker.tick(); await worker.tick();
      const result = await models.Run.findById(run.id).lean(); expect(result).toMatchObject({ state: 'complete', actualCount: 2, errorCount: 1, passed: false });
      expect(result.results[0].sessionId).not.toBe(result.results[1].sessionId); expect(fixture.generateCount).toBe(2);
    } finally { worker.stop(); await fixture.close(); }
  });
  test('exclusive recovery is held during Mongo CAS and cleanup; busy admission preserves old hold', async () => {
    const { gatewayFixture } = require('../helpers/taricGateway'); const fixture = await gatewayFixture(); worker.stop();
    try {
      const actualTransport = require('../../services/taric/transport').createTransport({ env: fixture.env });
      const actualSessions = require('../../services/taric/warmSession').createWarmSessions(actualTransport.sessionAdapter);
      service = createService({ models, transport: actualTransport, evidence, warmSessions: actualSessions, codeVersion: 'synthetic', authorizeAdmin: async () => true });
      await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true, reason: 'INFERENCE_UNCERTAIN', epoch: 7 } });
      fixture.busy = true;
      await expect(service.resumeInference(7)).rejects.toThrow('PROVIDER_FAILED');
      expect(fixture.sessions).toHaveLength(0);
      expect((await models.Control.findById('inference')).epoch).toBe(7);
      fixture.busy = false;
      let observed = false;
      fixture.onClose = async session => {
        const control = await models.Control.findById('inference').lean();
        expect(session.reclaim_verified).toBe(false);
        expect(control).toMatchObject({ blocked: true, epoch: 8, sessionId: session.session_id, recoveryPhase: 'owned_cleanup' });
        expect(control.until.getTime()).toBeGreaterThan(Date.now()); observed = true;
      };
      await service.resumeInference(7); expect(observed).toBe(true); expect(fixture.generateCount).toBe(0);
      expect((await models.Control.findById('inference')).blocked).toBe(false);
      expect(fixture.sessions[0].reclaim_verified).toBe(true);
    } finally { await fixture.close(); }
  });
  test('explicit fenced cancellation preserves failed history and durable in-flight attempt; never starts legacy pending work', async () => {
    const b = await benchmark(); const queued = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    await models.Run.updateOne({ _id: queued.id }, { $unset: { dispatchContract: 1 } });
    const r = await service.submit(principal, 'blocked-queued-01', requestInput);
    await models.Run.create({ _id: 'e'.repeat(32), state: 'failed', active: false, results: [{ error: 'OLD_FAILURE' }], actualCount: 1 });
    const old = await models.Run.findById('e'.repeat(32)).lean();
    await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true, epoch: 2 } });
    await expect(service.resumeInference(2)).rejects.toThrow('RECOVERY_REQUIRED');
    await service.cancelPending(2); await worker.tick();
    expect((await models.Run.findById(queued.id)).state).toBe('cancelled');
    expect((await models.Request.findById(r.id)).state).toBe('interrupted');
    expect(await models.Run.findById(old._id).lean()).toEqual(old);
    await service.resumeInference(3); await worker.tick();
    expect(transport.generate).not.toHaveBeenCalled();
  });
  test('actual bootstrap source dry-run and execute twice preserve existing config/key and add indexes idempotently', async () => {
    const { execFileSync } = require('child_process');
    const script = require('path').join(__dirname, '../../scripts/taric-tool.js');
    const preview = JSON.parse(execFileSync(process.execPath, [script, '--bootstrap'], { env: { ...process.env, MONGOOSE_URL: '' } }));
    expect(preview.dryRun).toBe(true); expect(preview.collections).toHaveLength(8);
    const key = await models.Credential.findById('integration').select('+digest').lean();
    const config = await service.settings();
    for (let i = 0; i < 2; i++) {
      const result = JSON.parse(execFileSync(process.execPath, [script, '--bootstrap', '--execute', '--allow-database-write'],
        { env: { ...process.env, MONGOOSE_URL: uri } }));
      expect(result.dryRun).toBe(false);
    }
    expect(await service.settings()).toMatchObject({ revision: config.revision, enabled: config.enabled, owner: config.owner, testCatalog: config.testCatalog });
    expect(await models.Credential.findById('integration').select('+digest').lean()).toEqual(key);
    expect((await models.Attempt.collection.indexes()).map(i => i.name)).toContain('one_attempt_per_case');
    expect((await models.Benchmark.collection.indexes()).map(i => i.name)).toContain('benchmark_chronology');
  });
  test('crash after terminal request before owned cleanup cannot silently dispatch the next queued request', async () => {
    const r = await service.submit(principal, 'crash-after-result01', requestInput);
    await models.Control.updateOne({ _id: 'inference' }, { $set: { sessionId: 'lost-capability', recoveryPhase: 'owned' } });
    await worker.tick();
    expect((await models.Control.findById('inference')).blocked).toBe(true);
    expect((await models.Request.findById(r.id)).state).toBe('queued'); expect(transport.generate).not.toHaveBeenCalled();
  });
  test('production revision3 empty runtime settings normalize without losing v0 or key, and passive probe cannot clear', async () => {
    await models.Settings.updateOne({ _id: 'tool' }, { $set: { revision: 3, runtime: {} } });
    const key = await models.Credential.findById('integration').select('+digest').lean();
    const before = await service.settings();
    await service.saveConfig({ enabled: true, maxTokens: 256, catalog: null, runtime: {} });
    expect(await service.settings()).toMatchObject({ revision: 4, runtime: { adapters: [] }, testCatalog: before.testCatalog });
    expect(await models.Credential.findById('integration').select('+digest').lean()).toEqual(key);
    await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true } });
    await service.recoveryStatus(); expect((await models.Control.findById('inference')).blocked).toBe(true);
    expect(warmSessions.open).not.toHaveBeenCalled();
  });
  test('uncorrelated/in-flight recovery pauses with an attempted result, never hands off or passes', async () => {
    worker.stop(); worker = createWorker(service, { authorizeAdmin: async () => true, recoveryMs: 0 }); worker.start();
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    transport.generate.mockRejectedValueOnce(new (require('../../utils/taricContracts').TaricError)('INFERENCE_UNCERTAIN'));
    warmSessions.status.mockResolvedValue({ idle: false, terminal: false, correlated: false });
    warmSessions.close.mockResolvedValue({ idle: false });
    await worker.tick(); await worker.tick();
    expect((await models.Run.findById(run.id)).toObject()).toMatchObject({ state: 'recovery_required', actualCount: 1, passed: false, active: false });
    expect(transport.generate).toHaveBeenCalledTimes(1);
    await expect(service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin')).rejects.toThrow('RECOVERY_REQUIRED');
    const epoch = (await models.Control.findById('inference')).epoch;
    warmSessions.open.mockRejectedValueOnce(new (require('../../utils/taricContracts').TaricError)('RECOVERY_REQUIRED'));
    await expect(service.resumeInference(epoch)).rejects.toThrow('RECOVERY_REQUIRED');
    warmSessions.close.mockResolvedValue({ idle: true }); await service.resumeInference(epoch);
    warmSessions.status.mockResolvedValue({ idle: true, terminal: true, correlated: true });
    expect((await models.Run.findById(run.id)).state).toBe('recovery_required');
    await service.resumeRun(run.id); await worker.tick();
    expect((await models.Run.findById(run.id)).actualCount).toBe(2);
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });
  test('legacy pending work requires explicit cancellation before epoch-fenced remote-idle recovery', async () => {
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    await models.Run.updateOne({ _id: run.id }, { $unset: { warmSessionRequired: 1 } });
    await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true, epoch: 3 } });
    await worker.tick(); expect(transport.generate).not.toHaveBeenCalled();
    await expect(service.resumeInference(3)).rejects.toThrow('RECOVERY_REQUIRED');
    await service.cancelRun(run.id);
    await expect(service.resumeInference(2)).rejects.toThrow('STALE');
    const attempts = await Promise.allSettled([service.resumeInference(3), service.resumeInference(3)]);
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    await worker.tick(); expect(transport.generate).not.toHaveBeenCalled();
    expect((await models.Run.findById(run.id)).state).toBe('cancelled');
  });
  test('lease heartbeats protect long generation and lost ownership aborts locally and preserves an unavailable attempt', async () => {
    worker.stop(); worker = createWorker(service, { authorizeAdmin: async () => true, leaseMs: 150 }); worker.start();
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    transport.generate.mockImplementationOnce(async (...args) => {
      const first = await models.Control.findById('inference').lean();
      await new Promise(resolve => setTimeout(resolve, 220));
      const current = await models.Control.findById('inference').lean();
      expect(current.holder).toBe(first.holder); expect(current.until.getTime()).toBeGreaterThan(first.until.getTime());
      await models.Control.updateOne({ _id: 'inference' }, { $set: { holder: 'lost', until: new Date(0) } });
      await new Promise(resolve => setTimeout(resolve, 70));
      expect(args[5].signal.aborted).toBe(true);
      throw new (require('../../utils/taricContracts').TaricError)('INFERENCE_UNCERTAIN');
    });
    await worker.tick(); await worker.tick();
    expect(transport.generate).toHaveBeenCalledTimes(1);
    expect(await models.Attempt.countDocuments({ run: run.id })).toBe(1);
    expect((await models.Run.findById(run.id)).toObject()).toMatchObject({ passed: false, actualCount: 1, state: 'recovery_required' });
  });
  test('benchmark pages are chronological with stable ties, bounded pagination and no random-ID ordering', async () => {
    const time = new Date('2026-01-01');
    for (let i = 0; i < 28; i++) await models.Benchmark.create({ _id: (100 - i).toString(16).padStart(32, '0'), version: i,
      createdAt: i < 2 ? time : new Date(time.getTime() + i * 1000), state: 'draft', cases: [row], manifest: { accepted: 1 } });
    const first = await service.inspect('benchmarks'); const second = await service.inspect('benchmarks', first.at(-1)._id);
    expect(first).toHaveLength(25); expect(second).toHaveLength(3); expect(first[0].version).toBe(27);
    expect(second.map(r => r.version)).toEqual([2, 0, 1]);
    expect(new Set([...first, ...second].map(r => r._id)).size).toBe(28);
  });
  test('recovery HTTP mutations require management capability, CSRF and a fresh epoch; GET status is read-only', async () => {
    const app = express(); let role = 'user'; const csrf = 'x'.repeat(43);
    app.set('views', require('path').join(__dirname, '../../views')); app.set('view engine', 'pug');
    app.use((req, _res, next) => { req.user = { _id: 'a'.repeat(24), name: 'synthetic', type_user: role }; req.isAuthenticated = () => true; req.session = { csrfToken: csrf }; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/admin/taric`;
    const post = (body, token = csrf) => fetch(base + '/inference/resume', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
    try {
      await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true, epoch: 4 } });
      expect((await post({ confirmIdle: true, epoch: 4 })).status).toBe(403); role = 'admin';
      expect((await post({ confirmIdle: true, epoch: 4 }, '')).status).toBe(403);
      expect((await fetch(base + '/inference/cancel-pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, epoch: 4 }) })).status).toBe(403);
      expect((await fetch(base + '/inference/cancel-pending')).status).toBe(404);
      expect((await fetch(base + '/inference/status')).status).toBe(200);
      expect((await models.Control.findById('inference')).blocked).toBe(true); expect(warmSessions.open).not.toHaveBeenCalled();
      expect((await post({ confirmIdle: true, epoch: 3 })).status).toBe(409);
      expect((await post({ confirmIdle: true, epoch: 4 })).status).toBe(200);
      expect((await post({ confirmIdle: true, epoch: 4 })).status).toBe(409);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  test('normal API omits diagnostic fields and test mode cannot be selected by a polling query', async () => {
    await normalReady(); const r = await service.submit(principal, 'normal-fields-0001', { ...requestInput, test: false }); await worker.tick();
    const result = await service.retrieve(principal, r.id);
    expect(result).not.toHaveProperty('diagnostics'); expect(result).not.toHaveProperty('evidence');
    const app = express(); app.use('/api/taric/v1', createTaricRouter(service));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/taric/v1/requests/${r.id}?test=true`, { headers: { Authorization: `Bearer ${secret}` } });
      expect(response.status).toBe(400);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
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
    const second = createWorker(service, { authorizeAdmin: async () => true, batchCases: 1 }); second.start();
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
  test('uncertain generation with unverified owned cleanup holds future work until exclusive recovery', async () => {
    const { TaricError } = require('../../utils/taricContracts');
    const r = await service.submit(principal, 'uncertain-0000001', requestInput);
    warmSessions.close.mockResolvedValueOnce({ idle: false });
    transport.generate.mockRejectedValueOnce(new TaricError('INFERENCE_UNCERTAIN'));
    await worker.tick();
    expect((await models.Request.findById(r.id)).error).toBe('INFERENCE_UNCERTAIN');
    expect((await models.Control.findById('inference')).blocked).toBe(true);
    await expect(service.submit(principal, 'uncertain-0000002', requestInput)).rejects.toThrow('INFERENCE_UNCERTAIN');
    await service.resumeInference((await models.Control.findById('inference')).epoch);
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
      for (const duplicate of ['{"test":true,"test":false}', '{"test":false,"test":true}', '{"test":false,"t\\u0065st":true}']) {
        expect((await send(duplicate, headers)).status).toBe(400);
      }
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
  test('management test HTTP polling and final feedback use session scope, CSRF and current authority', async () => {
    const app = express(); let actor = 'a'.repeat(24); const csrf = 'x'.repeat(43);
    app.set('views', require('path').join(__dirname, '../../views')); app.set('view engine', 'pug');
    app.use((req, _res, next) => { req.user = { _id: actor, name: 'synthetic', type_user: 'admin' }; req.isAuthenticated = () => true; req.session = { csrfToken: csrf }; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    app.use('/api/taric/v1', createTaricRouter(service));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': 'admin-http-test-0001', ...headers }, body: JSON.stringify(body) });
    try {
      const page = await fetch(base + '/admin/taric');
      expect(await page.text()).toContain(`name="csrf-token" content="${csrf}"`);
      const response = await post('/admin/taric/test', requestInput); const job = await response.json();
      expect(response.status).toBe(202); expect(response.headers.get('location')).toBe(job.poll_url);
      expect(job.poll_url).toBe(`/admin/taric/test/${job.id}`);
      expect(job.feedback_url).toBe(`/admin/taric/test/${job.id}/feedback`);
      expect((await fetch(base + job.poll_url)).status).toBe(202);
      await worker.tick();
      const complete = await fetch(base + job.poll_url); expect(complete.status).toBe(200);
      expect((await complete.json()).state).toBe('complete');
      expect((await fetch(`${base}/api/taric/v1/requests/${job.id}`, { headers: { Authorization: `Bearer ${secret}` } })).status).toBe(404);
      expect((await post(job.feedback_url, { selected_code: '0000000001' }, { 'X-CSRF-Token': '' })).status).toBe(403);
      expect((await post(job.feedback_url, { selected_code: '0000000001', verification: 'verified' })).status).toBe(400);
      const feedback = await post(job.feedback_url, { selected_code: '0000000001' });
      expect(await feedback.json()).toMatchObject({ decision: 'accepted', verification: 'unverified', training_approved: false });
      actor = 'b'.repeat(24);
      expect((await fetch(base + job.poll_url)).status).toBe(403);
      expect((await post(job.feedback_url, { selected_code: '0000000001' })).status).toBe(403);
      const foreign = await models.Request.findById(job.id).lean();
      await models.Request.updateOne({ _id: job.id }, { $set: { owner: 'foreign-owner', principal: principal.id } });
      await expect(service.retrieve(principal, foreign._id)).rejects.toThrow('NOT_FOUND');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  test('benchmark manager revocation retains attempted history and prevents future cases', async () => {
    worker.stop(); let allowed = true;
    worker = createWorker(service, { authorizeAdmin: async () => allowed }); worker.start();
    const b = await benchmark(); const run = await service.queueRun(b._id, TEST_ADAPTER, 'synthetic-admin');
    transport.generate.mockImplementationOnce(async () => { allowed = false; return { taric_code: '0000000001', description: 'Synthetic' }; });
    await worker.tick(); await worker.tick();
    expect((await models.Run.findById(run.id)).toObject()).toMatchObject({ state: 'failed', passed: false, actualCount: 1, error: 'FORBIDDEN' });
    expect(transport.generate).toHaveBeenCalledTimes(1);
  });
  test('real multipart file plus metadata previews/imports, rejects extra parts, and requires reviewed hash', async () => {
    const app = express(); const csrf = 'x'.repeat(43);
    app.use((req, _res, next) => { req.user = { _id: 'a'.repeat(24), name: 'synthetic', type_user: 'admin' }; req.isAuthenticated = () => true; req.session = { csrfToken: csrf }; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/admin/taric/imports`;
    const csv = 'descriptive_name,full_item_name,specs,hs_code,taric_code\nSynthetic independent,Synthetic new title,,0000.01,0000000001\n';
    const review = { targetsReviewed: true, independent: true, trainingExcluded: true, provenance: 'Synthetic fixture', reviewer: 'test', sourceLineage: [], minExact: 1, maxInvalid: 0 };
    const upload = (metadata, extra) => {
      const form = new FormData(); form.append('file', new Blob([csv]), 'synthetic.csv'); form.append('metadata', JSON.stringify(metadata));
      if (extra === 'file') form.append('file', new Blob([csv]), 'extra.csv');
      if (extra === 'field') form.append('extra', 'denied');
      return fetch(base, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: form });
    };
    try {
      await benchmark();
      const preview = await upload({ action: 'preview' }); expect(preview.status).toBe(200);
      const manifest = await preview.json(); expect(manifest).toMatchObject({ rows: 1, accepted: 1, distinctCodes: 1 });
      const metadata = { action: 'import', version: 1, review, expectedSha: manifest.sha256 };
      expect((await upload({ ...metadata, expectedSha: 'wrong' })).status).toBe(400);
      const imported = await upload(metadata); expect(imported.status).toBe(200);
      const record = await imported.json(); expect(record.contaminated).toBe(false);
      expect((await models.Benchmark.findById(record.id)).state).toBe('draft');
      expect((await service.settings()).currentBenchmark).toBeNull();
      expect((await upload(metadata, 'file')).status).toBe(400);
      expect((await upload(metadata, 'field')).status).toBe(400);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
