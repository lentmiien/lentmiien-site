/* Opt-in: real Node HTTP + worker + disposable Mongo + real FastAPI/manager/
 * scheduler. Gateway's shared fixture fakes ONLY hardware/upstream computation. */
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const mongoose = require('mongoose');
const models = require('../../models/taric_tool');
const { createService } = require('../../services/taric/service');
const { createWorker } = require('../../services/taric/worker');
const { createTransport, boundedJson } = require('../../services/taric/transport');
const { createWarmSessions } = require('../../services/taric/warmSession');
const { TEST_ADAPTER } = require('../../utils/taricProtocol');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const uri = process.env.TARIC_TEST_MONGO_URL;
const helper = process.env.TARIC_GATEWAY_CONTRACT_HELPER;
const python = process.env.TARIC_GATEWAY_CONTRACT_PYTHON;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/taric_test_[a-z0-9_]+$/.test(uri || '') && helper && python ? describe : describe.skip;
const input = { descriptive_name: 'Synthetic object', full_item_name: 'Synthetic toy', specs: '', hs_code: '950300' };
async function startGateway(scenario) {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(python, [path.join(__dirname, '../helpers/taricGenerationGateway.py'), '--test-only', '--helper', helper, '--port', String(port), '--scenario', scenario], {
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', b => { output = (output + b).slice(-12000); }); child.stderr.on('data', b => { output = (output + b).slice(-12000); });
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } };
  const end = Date.now() + 10000;
  while (!output.includes('Application startup complete.') && child.exitCode === null && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
  if (!output.includes('Application startup complete.')) { await stop(); throw new Error('Test-only Gateway startup failed: ' + output); }
  const origin = `http://127.0.0.1:${port}`;
  return { stop, env: { TARIC_GATEWAY_ORIGIN: origin, TARIC_GATEWAY_ALLOWED_ORIGINS: origin },
    call: (route, opts) => boundedJson(new URL(origin + route), opts) };
}
run('real cross-stack generation', () => {
  let gateway; let worker; let service;
  beforeAll(async () => {
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 3000 });
    for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
  });
  beforeEach(async () => {
    for (const model of Object.values(models)) await model.deleteMany({});
    await models.Settings.create({ _id: 'tool', revision: 1, enabled: true, owner: 'synthetic-owner', maxTokens: 256,
      currentBenchmark: null, catalog: null, runtime: { adapters: [] }, testCatalog: { source: 'training-derived/non-authoritative', codes: ['0000000001'] } });
    for (const name of ['management', 'inference']) await models.Control.create({ _id: name, blocked: false, until: new Date(0), holder: '' });
  });
  afterEach(async () => { worker?.stop(); await gateway?.stop(); });
  afterAll(async () => { if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  async function setup(scenario) {
    gateway = await startGateway(scenario);
    const transport = createTransport({ env: gateway.env });
    service = createService({ models, transport, codeVersion: 'synthetic-cross-stack', authorizeAdmin: async () => true,
      evidence: { resolve: async () => ({ facts: { name: 'Synthetic toy', specifications: '' }, hash: 'synthetic' }) },
      warmSessions: createWarmSessions(transport.sessionAdapter) });
    worker = createWorker(service, { authorizeAdmin: async () => true }); worker.start();
  }
  test('67 valid named-adapter outputs: cold >5s, warm >5s, ONE session/start/stop, no normal release', async () => {
    await setup('warm-benchmark');
    const cases = Array.from({ length: 67 }, (_, i) => ({ input, target: '0000000001', inputHash: `synthetic-${i}`, sourceHash: 'synthetic', overlapHash: `synthetic-${i}` }));
    const benchmark = await models.Benchmark.create({ _id: 'a'.repeat(32), version: 0, state: 'draft', releaseEligible: false,
      contaminated: true, cases, policy: { version: 'exact-all-cases/1', minExact: 1, maxInvalid: 0, denominator: 67 } });
    const queued = await service.queueRun(benchmark.id, TEST_ADAPTER, 'synthetic-admin');
    const started = Date.now();
    for (let tick = 0; tick < 9; tick++) await worker.tick();
    const result = await models.Run.findById(queued.id).lean();
    const state = await gateway.call('/__test__/state');
    console.info('Cross-stack observed counts', { elapsedMs: Date.now() - started, recorded: result.actualCount, validOutputs: result.exact,
      coldMs: result.results[0]?.finishedAt - result.results[0]?.startedAt, warmMs: result.results[1]?.finishedAt - result.results[1]?.startedAt,
      sessions: state.session_ids.length, operations: state.operations, creates: state.creates, deletes: state.deletes, starts: state.starts, stops: state.stops });
    expect(state).toMatchObject({ creates: 1, deletes: 1, foreign_deletes: 0, starts: 1, stops: 1, operations: 67, terminal_operations: 67, upstream_calls: 67, reclaimed: true, reservation: false });
    expect(result).toMatchObject({ state: 'complete', requestedCount: 67, attemptedCount: 67, actualCount: 67, exact: 67,
      invalid: 0, errorCount: 0, successfulGenerations: 67, sessionCount: 1, sessionEndReasons: { finished: 1 } });
    expect(await models.Attempt.countDocuments({ run: queued.id })).toBe(67);
    expect(new Set(result.results.map(r => r.sessionId)).size).toBe(1);
    expect(new Set(result.results.map(r => r.correlationId)).size).toBe(67);
    expect(result.results.every(r => r.result?.taric_code === '0000000001' && r.error === null)).toBe(true);
    expect(result.results[0].errorStatus).toMatchObject({ deadlineMs: 60000, status: 200, phase: 'http' });
    expect(result.results[0].errorStatus).toMatchObject({ operationId: result.results[0].correlationId,
      sessionId: result.results[0].sessionId, sessionHardBudgetMs: 900000, requestTimeoutMs: 60000 });
    expect(result.results[0].errorStatus.sessionRemainingMs).toBeGreaterThan(850000);
    const logger = require('../../utils/logger');
    expect(logger.notice).toHaveBeenCalledWith('TARIC provider generation transport', expect.objectContaining({
      metadata: expect.objectContaining({ event: 'outbound_finished', transport: expect.objectContaining({
        operationId: result.results[0].correlationId, socketTimeoutMs: 60000, requestFinished: true,
      }) }),
    }));
    expect(result.results[0].errorStatus.durationMs).toBeGreaterThan(6500);
    expect(result.results[1].errorStatus.durationMs).toBeGreaterThan(5500);
    expect(new Set(state.adapters)).toEqual(new Set([TEST_ADAPTER]));
    expect(state.session_ids).toHaveLength(1);
    expect((await models.Control.findById('inference')).blocked).toBe(false);
    expect((await models.Benchmark.findById(benchmark.id)).releaseEligible).toBe(false);
    await expect(service.admission(false)).rejects.toThrow('RELEASE_CLOSED');
    console.info('REAL Node/Python/Mongo generation evidence', { elapsedMs: Date.now() - started,
      coldMs: result.results[0].errorStatus.durationMs, warmMs: result.results[1].errorStatus.durationMs,
      sessions: state.session_ids.length, operations: state.operations, validOutputs: result.exact,
      creates: state.creates, deletes: state.deletes, starts: state.starts, stops: state.stops });
  }, 30000);
  test('operator reservation rejects create with zero inference and no Site hold; fresh job succeeds after operator release', async () => {
    await setup('external-reservation');
    const principal = await service.authenticate(await service.rotate('synthetic-admin'));
    const request = { item_code: 'SYNTHETIC-1', descriptive_name: 'Synthetic', input_hs_code: '950300', test: true };
    await gateway.call('/__test__/operator', { method: 'POST', body: {} });
    const queued = await service.submit(principal, 'external-reservation-01', request); await worker.tick();
    expect(await service.retrieve(principal, queued.id)).toMatchObject({ state: 'failed', error: 'ADMISSION_BUSY', stage: 'session.create', inferenceDispatched: false, retryable: true });
    expect((await service.recoveryStatus()).control.blocked).toBe(false);
    expect((await service.recoveryStatus()).ownership.action).toBe('recovery_not_needed');
    expect(await gateway.call('/__test__/state')).toMatchObject({ creates: 0, deletes: 0, upstream_calls: 0, reservation: true });
    await gateway.call('/__test__/operator', { method: 'DELETE', body: {} });
    const fresh = await service.submit(principal, 'external-reservation-02', request); await worker.tick();
    expect(await service.retrieve(principal, fresh.id)).toMatchObject({ state: 'complete', result: { taric_code: '0000000001' } });
    expect(await gateway.call('/__test__/state')).toMatchObject({ creates: 1, deletes: 1, foreign_deletes: 0, upstream_calls: 1, reclaimed: true, reservation: false });
    expect((await models.Control.findById('inference')).blocked).toBe(false);
  }, 20000);
  test('HTTP disconnect leaves accepted generation running; exact operation becomes terminal before owned cleanup', async () => {
    await setup('disconnect'); worker.stop();
    const warm = service.warmSessions;
    const handle = await warm.open({ correlationId: 'a'.repeat(32) });
    const signal = new AbortController();
    const generated = warm.generate(handle, input, ['0000000001'], 256, { signal: signal.signal, correlationId: 'b'.repeat(32) });
    const error = generated.catch(e => e);
    const limit = Date.now() + 3000;
    while ((await gateway.call('/__test__/state')).upstream_calls === 0 && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 20));
    signal.abort(); expect((await error).code).toBe('INFERENCE_UNCERTAIN');
    let status;
    do { status = await warm.status(handle, 'b'.repeat(32)); if (!status.terminal) await new Promise(resolve => setTimeout(resolve, 50)); } while (!status.terminal && Date.now() < limit);
    expect(status).toMatchObject({ idle: true, terminal: true, correlated: true });
    expect(await warm.close(handle)).toEqual({ idle: true });
    expect(await gateway.call('/__test__/state')).toMatchObject({ creates: 1, deletes: 1, upstream_calls: 1, terminal_operations: 1, reclaimed: true });
  }, 12000);
});
