/* Synthetic records and disposable loopback Mongo only. */
const mongoose = require('mongoose');
const models = require('../../models/taric_tool');
const Item = require('../../models/amiami_item');
const { createService } = require('../../services/taric/service');
const { createWorker } = require('../../services/taric/worker');
const { createHistory } = require('../../services/taric/history');
const { createTaricEvidenceService } = require('../../services/taricEvidenceService');
const { createTransport } = require('../../services/taric/transport');
const { createWarmSessions } = require('../../services/taric/warmSession');
const { gatewayFixture } = require('../helpers/taricGateway');
const { request, actor, id } = require('../helpers/taricHistoryFixture');
const { hash } = require('../../utils/taricProtocol');
const { spawnSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const uri = process.env.TARIC_TEST_MONGO_URL;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/taric_test_[a-z0-9_]+$/.test(uri || '') ? describe : describe.skip;
run('filtered JAN export and local immutable enrichment', () => {
  let history, service, worker, gateway, fetchFactual, authorized;
  beforeAll(async () => {
    await mongoose.connect(`${uri}_reprocess`, { autoCreate: false, autoIndex: false });
    for (const m of [...Object.values(models), Item]) { await m.createCollection(); await m.createIndexes(); }
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    for (const m of [...Object.values(models), Item]) await m.deleteMany({});
    await models.Settings.create({ _id: 'tool', revision: 1, owner: 'synthetic-owner', enabled: true, maxTokens: 256, testCatalog: { codes: ['0000000001'] } });
    for (const name of ['management', 'inference']) await models.Control.create({ _id: name, until: new Date(0), blocked: false });
    authorized = true; gateway = await gatewayFixture(); fetchFactual = jest.fn(() => { throw new Error('NO NETWORK LOOKUP'); });
    const transport = createTransport({ env: gateway.env });
    service = createService({ models, transport, codeVersion: 'synthetic-redo', evidence: createTaricEvidenceService({ itemModel: Item, fetchFactual }),
      warmSessions: createWarmSessions(transport.sessionAdapter), authorizeAdmin: async a => authorized && a === actor });
    history = createHistory({ models, adminPrincipal: service.adminPrincipal });
    worker = createWorker(service, { authorizeAdmin: async a => authorized && a === actor });
  });
  afterEach(async () => { worker.stop(); await gateway.close(); });
  async function seed(n = 1, overrides = {}) {
    const raw = request(n, { evidence: null, result: null, state: 'failed', error: 'EVIDENCE_NOT_FOUND', ...overrides });
    const { feedback, ...parent } = raw; await models.Request.create(parent);
    if (feedback?.length) await models.Feedback.create({ _id: feedback[0]._id, owner: parent.owner, principal: 'integration', request: parent._id,
      key: `feedback-${n}`, selected_code: feedback[0].selected_code, decision: feedback[0].decision, createdAt: feedback[0].createdAt });
    return parent._id;
  }
  async function item(n = 1, extra = {}) {
    const gcode = `SYNTHETIC-${n}`;
    return Item.create({ gcode, sourceUrl: 'https://www.amiami.com/', firstSeenAt: new Date(), lastSeenAt: new Date(), listingChangedAt: new Date(), url: `https://www.amiami.com/eng/detail?gcode=${gcode}`, listing: { gcode, url: 'https://www.amiami.com/', itemName: `Synthetic item ${n}` },
      details: { gcode, janCode: request(n).input.jan, itemName: `Synthetic item ${n}`, specifications: null }, detailStatus: 'fetched', ...extra });
  }
  async function review(rid, extra = {}) {
    const r = await history.detail(actor, rid);
    return history.review(actor, rid, { expectedRevision: r.revision, expectedSourceHash: r.sourceHash, status: 'verified', target: r.feedback.code,
      confirmTarget: true, correction: false, note: 'Synthetic explicit human review', approvedDescription: 'Approved independently', ...extra });
  }
  async function start(filters = {}, token = id(900)) {
    const p = await service.reprocess.preview(actor, { filters });
    return service.reprocess.start(actor, { filters, expectedSnapshotHash: p.snapshotHash, token, confirm: true });
  }
  async function tick() { worker.start(); await worker.tick(); }
  test('JAN export covers all pages, strings/zeros/dedup/invalid/scope and snapshot guards, no GPU', async () => {
    for (let n = 1; n <= 67; n++) await seed(n);
    await seed(68, { input: { ...request().input, jan: '00000001' } });
    await seed(69, { input: { ...request().input, jan: '00000001' } });
    await seed(70, { input: { ...request().input, jan: '=1+1' } });
    await seed(71, { input: { ...request().input, jan: null } });
    await seed(72, { owner: 'foreign' });
    const filters = { feedback: 'present', missing: 'yes', from: '2026-09-20', to: '2026-09-20' };
    const p = await history.janPreview(actor, { filters });
    expect(p.counts).toEqual({ filteredRows: 71, distinctExported: 68, duplicates: 1, missingInvalid: 2 });
    expect((await history.list(actor, filters)).rows).toHaveLength(50);
    const csv = (await history.janDownload(actor, { filters, expectedSnapshotHash: p.snapshotHash })).csv;
    expect(csv.split('\n')).toHaveLength(70); expect(csv.startsWith('jan\n00000001\n')).toBe(true);
    expect(csv).toContain(request(67).input.jan); expect(csv).not.toContain('=1+1');
    await seed(73);
    await expect(history.janDownload(actor, { filters, expectedSnapshotHash: p.snapshotHash })).rejects.toThrow('STALE');
    expect(gateway.requests).toHaveLength(0); expect(fetchFactual).not.toHaveBeenCalled();
  });
  test('47 logical cases: zero before import, 43 afterwards, human feedback byte-identical and verified four protected', async () => {
    for (let n = 1; n <= 47; n++) { await seed(n, n > 43 ? { evidence: request(n).evidence, result: request(n).result, state: 'complete', error: null } : {}); if (n > 43) await review(id(n)); }
    const beforeFeedback = await models.Feedback.find({}).sort({ _id: 1 }).lean();
    const p0 = await service.reprocess.preview(actor, {});
    expect(p0.summary).toMatchObject({ eligible: 0, reasons: { no_local_item_yet: 43, verified_protected: 4 } });
    expect(gateway.requests).toHaveLength(0);
    for (let n = 1; n <= 43; n++) await item(n);
    const filters = { missing: 'yes', review: 'unreviewed' };
    const p = await service.reprocess.preview(actor, { filters });
    expect(p.summary.eligible).toBe(43);
    const input = { filters, token: id(999), expectedSnapshotHash: p.snapshotHash, confirm: true };
    const job = await service.reprocess.start(actor, input);
    expect(await service.reprocess.start(actor, input)).toMatchObject({ id: job.id });
    expect(gateway.requests).toHaveLength(0);
    await tick();
    const status = await service.reprocess.status(actor, job.id);
    expect(status).toMatchObject({ state: 'complete', tried: 43, validPredictions: 43, sessionCount: 1, counts: { enriched: 43 } });
    expect(gateway.generateCount).toBe(43); expect(gateway.sessions).toHaveLength(1);
    expect(gateway.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    expect(await models.Feedback.find({}).sort({ _id: 1 }).lean()).toEqual(beforeFeedback);
    const r = await history.detail(actor, id(1));
    expect(r).toMatchObject({ state: 'failed', error: 'EVIDENCE_NOT_FOUND', facts: { name: 'Synthetic item 1' }, suggestion: { code: '0000000001' },
      feedback: { code: '0000000002' }, reviewStatus: 'unreviewed', revision: 0, localRevision: 1, localReprocess: { state: 'enriched' } });
    expect(r.review).toBeNull(); expect(r.original.facts.name).toBeNull(); expect(r.audit).toHaveLength(0); expect(r.localHistory).toHaveLength(1);
    expect((await history.list(actor, {})).stats).toMatchObject({ total: 47, verified: 4 });
    expect((await history.list(actor, { batch: job.id })).stats.total).toBe(43);
    expect((await models.Request.findById(id(1))).result).toBeNull();
    expect(fetchFactual).not.toHaveBeenCalled();
  }, 30000);
  test('ambiguous JAN skipped unless exact original resolved identity agrees; no final feedback, JAN and verified protected', async () => {
    await seed(); await item(); await item(2, { details: { gcode: 'SYNTHETIC-2', janCode: request(1).input.jan, itemName: 'Other product' } });
    await seed(3, { feedback: [] }); await seed(4, { input: { ...request(4).input, jan: null } });
    await seed(5); await review(id(5));
    expect((await service.reprocess.preview(actor, {})).summary.reasons).toEqual({ ambiguous_jan: 1, no_final_feedback: 1, missing_invalid_jan: 1, verified_protected: 1 });
    await models.Request.updateOne({ _id: id(1) }, { $set: { evidence: { gcode: 'SYNTHETIC-1' } } });
    expect((await service.reprocess.preview(actor, {})).summary.eligible).toBe(1);
    expect(gateway.requests).toHaveLength(0);
  });
  test('local facts/source/review change invalidates preview; concurrent review prevents dispatch and CAS overwrites', async () => {
    await seed(); await item();
    const p = await service.reprocess.preview(actor, {});
    await Item.updateOne({ gcode: 'SYNTHETIC-1' }, { $set: { 'details.itemName': 'New facts' } });
    await expect(service.reprocess.start(actor, { expectedSnapshotHash: p.snapshotHash, token: id(900), confirm: true })).rejects.toThrow('STALE');
    const job = await start(); await review(id(1)); await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ counts: { stale: 1 }, tried: 0 });
    expect(gateway.generateCount).toBe(0); expect(gateway.sessions).toHaveLength(0);
  });
  test('unknown operation output retained once without rerun; facts survive failed generation and cancel stops future cases', async () => {
    for (let n = 1; n <= 15; n++) { await seed(n); await item(n); }
    gateway.dropAt = 12;
    const job = await start();
    gateway.onGenerate = async () => { if (gateway.generateCount === 13) await service.reprocess.cancel(actor, job.id, { confirm: true }); };
    await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'cancelled', tried: 13, validPredictions: 12, counts: { enriched: 12, model_failed: 1, cancelled: 2 } });
    const lost = await history.detail(actor, id(4)); // descending stable request order: case 12 = id(4)
    expect(lost).toMatchObject({ facts: { name: 'Synthetic item 4' }, feedback: { code: '0000000002' }, reviewStatus: 'unreviewed', localReprocess: { error: 'INFERENCE_UNCERTAIN' } });
    expect(gateway.generateCount).toBe(13);
    expect((await models.Control.findById('inference')).blocked).toBe(false);
  }, 15000);
  test('busy reservation retains facts without inference or a false hold, and a fresh explicit batch can retry', async () => {
    await seed(); await item(); gateway.busy = true;
    const first = await start(); await tick();
    expect(await service.reprocess.status(actor, first.id)).toMatchObject({ state: 'failed', error: 'ADMISSION_BUSY', tried: 0, counts: { model_failed: 1 } });
    expect((await models.Control.findById('inference')).blocked).toBe(false);
    expect(await history.detail(actor, id(1))).toMatchObject({ facts: { name: 'Synthetic item 1' }, feedback: { code: '0000000002' }, localRevision: 1 });
    expect(gateway.generateCount).toBe(0); expect(gateway.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    gateway.busy = false; const second = await start({}, id(901)); await worker.tick();
    expect(await service.reprocess.status(actor, second.id)).toMatchObject({ state: 'complete', tried: 1 });
    expect((await history.detail(actor, id(1))).localRevision).toBe(2);
    expect(await models.Feedback.countDocuments()).toBe(1);
  });
  test('rejected model keeps fresh facts and explicit independent human review remains possible', async () => {
    await seed(); await item(); await models.Settings.updateOne({ _id: 'tool' }, { $set: { testCatalog: { codes: ['0000000009'] } } });
    const job = await start(); await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'complete', tried: 1, validPredictions: 0, counts: { model_failed: 1 } });
    const row = await history.detail(actor, id(1));
    expect(row).toMatchObject({ facts: { name: 'Synthetic item 1' }, suggestion: null, diagnostic: { code: '0000000001' }, localReprocess: { error: 'CATALOG_REJECTED' }, reviewStatus: 'unreviewed' });
    expect(row.localHistory[0].diagnostics.visibleText).toContain('Synthetic description');
    await review(id(1)); expect((await history.preview(actor, {})).candidates[0].targetCode).toBe('0000000002');
  });
  test('restart records unknown active operation once, retains facts, and requires existing ownership-lost recovery', async () => {
    await seed(); await item(); const job = await start();
    const stored = await models.Reprocess.findById(job.id).lean(); const c = stored.cases[0];
    await service.reprocess.claim(stored, c);
    await models.Reprocess.updateOne({ _id: job.id }, { $set: { state: 'running', fence: 'dead-worker', 'cases.0.state': 'running', 'cases.0.dispatched': true, 'cases.0.correlationId': id(999) } });
    await models.Control.updateOne({ _id: 'inference' }, { $set: { sessionId: 'lost-private-owner' } });
    await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'recovery_required', tried: 1, counts: { model_failed: 1 } });
    expect(await history.detail(actor, id(1))).toMatchObject({ facts: { name: 'Synthetic item 1' }, localClaim: null, localReprocess: { error: 'INFERENCE_UNCERTAIN' } });
    expect((await service.recoveryStatus()).ownership).toMatchObject({ available: false, state: 'OWNERSHIP_LOST' });
    expect(gateway.generateCount).toBe(0); await worker.tick(); expect(gateway.sessions).toHaveLength(0);
  });
  test('recovery cancel finalizes interrupted claims and blocks recovery while a local job is pending', async () => {
    await seed(); await item(); const job = await start();
    const stored = await models.Reprocess.findById(job.id).lean(); await service.reprocess.claim(stored, stored.cases[0]);
    await models.Reprocess.updateOne({ _id: job.id }, { $set: { state: 'running', fence: 'dead-worker', 'cases.0.state': 'claiming' } });
    await models.Control.updateOne({ _id: 'inference' }, { $set: { blocked: true } });
    await expect(service.resumeInference(0, id(902), actor)).rejects.toThrow('RECOVERY_REQUIRED');
    await service.cancelPending(0);
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'cancelled', active: false, tried: 0, counts: { model_failed: 1 } });
    expect((await history.detail(actor, id(1))).localClaim).toBeNull();
    expect((await models.Control.findById('inference')).blocked).toBe(true); expect(gateway.sessions).toHaveLength(0);
  });
  test('queued cancellation/revoked authorization/stale configuration perform no inference', async () => {
    await seed(); await item(); const job = await start(); await service.reprocess.cancel(actor, job.id, { confirm: true }); await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'cancelled', counts: { cancelled: 1 }, tried: 0 });
    const next = await start({}, id(901)); await models.Settings.updateOne({ _id: 'tool' }, { $inc: { revision: 1 } }); await worker.tick();
    expect(await service.reprocess.status(actor, next.id)).toMatchObject({ state: 'failed', error: 'STALE', tried: 0 });
    expect(gateway.sessions).toHaveLength(0);
  });
  test('new review cannot be overwritten, old correction/audit stay intact, and re-do starts stale', async () => {
    await seed(); await item(); await review(id(1), { target: '9999999999', correction: true });
    const before = (await history.detail(actor, id(1))).audit;
    expect((await service.reprocess.preview(actor, {})).summary.eligible).toBe(0);
    await review(id(1), { status: 'needs_review', target: '9999999999', correction: true });
    const job = await start(); await tick();
    const row = await history.detail(actor, id(1));
    expect(row).toMatchObject({ reviewStatus: 'needs_review', stale: true, feedback: { code: '0000000002' }, review: { target: '9999999999' } });
    expect(row.audit[0]).toEqual(before[0]); expect((await history.preview(actor, {})).summary.selected).toBe(0);
    await expect(models.Review.updateOne({ _id: id(1), request: id(1), owner: 'synthetic-owner', revision: 2, localRevision: 1, localClaim: null }, { $set: { originalSource: null } })).rejects.toThrow('append-only CAS');
    expect((await service.reprocess.status(actor, job.id)).state).toBe('complete');
    await models.Request.deleteMany({}); await models.Feedback.deleteMany({});
    expect((await history.detail(actor, id(1))).stale).toBe(true);
    await review(id(1));
    expect(await history.detail(actor, id(1))).toMatchObject({ stale: false, eligible: true, review: { target: '0000000002' } });
  });
  test('HTTP actions deny missing capability, CSRF, keys, foreign scope, and arbitrary IDs/settings', async () => {
    const express = require('express'); const { createTaricAdminRouter } = require('../../routes/taricAdmin');
    await seed(); await item(); let role = 'admin'; let authenticated = true;
    const csrf = 'x'.repeat(43); const app = express();
    app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
    app.use((req, _res, next) => { req.user = { _id: actor, name: 'synthetic', type_user: role }; req.session = { csrfToken: csrf }; req.isAuthenticated = () => authenticated; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/admin/taric/history`;
    const post = (route, body = {}, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(body) });
    try {
      for (const route of ['/jan/preview', '/jan/download', '/reprocess/preview', '/reprocess/start', `/reprocess/${id(1)}/cancel`]) {
        authenticated = false; expect((await post(route, {}, { Authorization: `Bearer ttk_${'s'.repeat(43)}` })).status).toBe(401);
        authenticated = true; role = 'family'; expect((await post(route)).status).toBe(403); role = 'user'; expect((await post(route)).status).toBe(403);
        role = 'admin'; expect((await post(route, {}, { 'X-CSRF-Token': '' })).status).toBe(403);
        expect((await post(route, {}, { Origin: 'https://evil.test' })).status).toBe(403);
      }
      expect((await fetch(url + '/reprocess/start')).status).toBe(404);
      expect((await post('/jan/preview', { filters: { owner: 'foreign' } })).status).toBe(400);
      expect((await post('/reprocess/preview', { filters: { jan: { $ne: '' } } })).status).toBe(400);
      const p = await (await post('/jan/preview')).json();
      const csv = await post('/jan/download', { expectedSnapshotHash: p.snapshotHash });
      expect(csv.status).toBe(200); expect(csv.headers.get('cache-control')).toContain('private, no-store'); expect(csv.headers.get('content-type')).toContain('text/csv');
      expect(csv.headers.get('content-disposition')).toBe('attachment; filename="taric-filtered-jans.csv"');
      const rp = await (await post('/reprocess/preview')).json(); const body = { expectedSnapshotHash: rp.snapshotHash, token: id(911), confirm: true };
      for (const field of ['ids', 'owner', 'actor', 'selected_code', 'adapter', 'test', 'revisionId']) expect((await post('/reprocess/start', { ...body, [field]: id(999) })).status).toBe(400);
      const jobResponse = await post('/reprocess/start', body); expect(jobResponse.status).toBe(202); const job = await jobResponse.json();
      await models.Reprocess.updateOne({ _id: job.id }, { $set: { owner: 'foreign' } }); // immutable schema strips this mutation
      const foreign = await models.Reprocess.create({ _id: id(950), owner: 'foreign', actor, token: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), active: true, state: 'queued', cases: [] });
      expect((await fetch(url + '/reprocess/' + foreign.id)).status).toBe(404);
      expect((await post(`/reprocess/${foreign.id}/cancel`, { confirm: true })).status).toBe(404);
      expect(gateway.sessions).toHaveLength(0);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  test('capability revocation during generation retains attempted facts and stops the next case', async () => {
    await seed(); await item(); await seed(2); await item(2); const job = await start();
    gateway.onGenerate = async () => { authorized = false; };
    await tick(); await expect(service.reprocess.status(actor, job.id)).rejects.toThrow('FORBIDDEN'); authorized = true;
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'failed', error: 'FORBIDDEN', tried: 1, counts: { enriched: 1, not_attempted: 1 } });
    expect(await history.detail(actor, id(2))).toMatchObject({ facts: { name: 'Synthetic item 2' }, feedback: { code: '0000000002' } });
    expect(gateway.generateCount).toBe(1);
  });
  test('external request replay is unchanged and Mongo heartbeat fences a second worker', async () => {
    await seed(1, { principal: `admin_${actor}`, generation: 0 }); await item();
    const principal = await service.adminPrincipal(actor); const before = await service.retrieve(principal, id(1));
    const job = await start();
    worker = createWorker(service, { authorizeAdmin: async () => true, leaseMs: 150 });
    const second = createWorker(service, { authorizeAdmin: async () => true, leaseMs: 150 });
    gateway.onGenerate = async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
      const control = await models.Control.findById('inference').lean(); expect(control.until.getTime()).toBeGreaterThan(Date.now());
      second.start(); await second.tick(); second.stop();
    };
    await tick();
    expect(await service.retrieve(principal, id(1))).toEqual(before);
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'complete', tried: 1, sessionCount: 1 });
    expect(gateway.generateCount).toBe(1); expect(gateway.sessions).toHaveLength(1);
  });
  test.each(['interactive_priority', 'hard_lifetime'])('warm slice rotates only at safe %s boundary', async reason => {
    for (let n = 1; n <= 3; n++) { await seed(n); await item(n); }
    const realNow = service.now; const job = await start();
    gateway.onGenerate = async () => {
      if (gateway.generateCount !== 1) return;
      if (reason === 'interactive_priority') {
        const { feedback, ...queued } = request(90, { state: 'queued', active: true, slot: 0 });
        await models.Request.create(queued);
      } else {
        service.now = () => realNow() + 650000;
        await models.Control.updateOne({ _id: 'inference' }, { $set: { until: new Date(service.now() + 180000) } });
      }
    };
    await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'running', tried: 1, sessionCount: 1, sessionEndReasons: { [reason]: 1 } });
    expect(gateway.sessions[0].reclaim_verified).toBe(true);
    service.now = realNow;
    if (reason === 'interactive_priority') await models.Request.updateOne({ _id: id(90) }, { $set: { active: false, state: 'cancelled' } });
    await worker.tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'complete', tried: 3, sessionCount: 2 });
    expect(gateway.generateCount).toBe(3); expect((await models.Control.findById('inference')).blocked).toBe(false);
  });
  test('unverified cleanup holds global admission and retains the private handle and completed facts', async () => {
    await seed(); await item(); gateway.cleanup = false;
    const job = await start(); await tick();
    expect(await service.reprocess.status(actor, job.id)).toMatchObject({ state: 'recovery_required', counts: { enriched: 1 }, tried: 1 });
    const control = await models.Control.findById('inference').lean(); expect(control.blocked).toBe(true);
    expect(service.warmSessions.lookup(control.sessionId)).toBeTruthy();
    const row = await history.detail(actor, id(1)); expect(row.facts.name).toBe('Synthetic item 1');
    expect(JSON.stringify(row)).not.toMatch(/synthetic-owner-capability|synthetic-admin|synthetic-proxy/);
    await worker.tick(); expect(gateway.generateCount).toBe(1);
  });
  test('JAN export refuses over-limit population without silent truncation; batch start enforces frozen IDs and bounded work', async () => {
    const docs = Array.from({ length: 2001 }, (_, n) => { const { feedback, ...r } = request(n + 1, { evidence: null, result: null, state: 'failed' }); return r; });
    await models.Request.insertMany(docs);
    await expect(history.janPreview(actor, {})).rejects.toMatchObject({ historyStatus: 413 });
    expect(gateway.requests).toHaveLength(0);
    expect((await history.janPreview(actor, { filters: { jan: request().input.jan } })).counts.filteredRows).toBe(1);
  });
  test('review lock, explicit verification, raw expiry and JS export to actual Python preserve HUMAN code and approved description', async () => {
    await seed(); await item(); const job = await start();
    let locked = false;
    gateway.onGenerate = async () => { await expect(review(id(1))).rejects.toThrow('STALE'); locked = true; };
    await tick(); expect(locked).toBe(true);
    await models.Request.deleteMany({}); await models.Feedback.deleteMany({});
    const r = await history.detail(actor, id(1));
    expect(r).toMatchObject({ sourceStorage: 'archived_review', reviewStatus: 'unreviewed', facts: { name: 'Synthetic item 1' }, feedback: { code: '0000000002' } });
    await review(id(1));
    const filters = { batch: job.id, reprocess: 'enriched' };
    const p = await history.preview(actor, { filters }); expect(p.summary.selected).toBe(1);
    const downloaded = await history.download(actor, { filters, expectedSnapshotHash: p.snapshotHash });
    const candidate = JSON.parse(downloaded.jsonl.trim().split('\n')[1]);
    expect(candidate.targetCode).toBe('0000000002'); expect(hash(candidate.source)).toBe(candidate.sourceHash);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taric-redo-converter-'));
    try {
      const filename = path.join(dir, 'source.jsonl'); fs.writeFileSync(filename, downloaded.jsonl, { mode: 0o600 });
      const conversion = spawnSync('python3', ['scripts/taric_dataset_converter.py', '--input', filename, '--output-dir', path.join(dir, 'converted'), '--profile', 'newest-verified'], { encoding: 'utf8' });
      expect(conversion.status).toBe(0);
      const cleaned = fs.readFileSync(path.join(dir, 'converted', 'cleaned.csv'), 'utf8');
      expect(cleaned).toContain('0000000002'); expect(cleaned).toContain('Approved independently');
      const response = spawnSync('python3', ['-c', 'import csv,json,sys; print(next(csv.DictReader(open(sys.argv[1]))) ["response"])', path.join(dir, 'converted', 'prompt-response.csv')], { encoding: 'utf8' });
      expect(JSON.parse(response.stdout)).toEqual({ taric_code: '0000000002', description: 'Approved independently' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    expect((await history.list(actor, { batch: job.id })).stats).toMatchObject({ total: 1, verified: 1 });
  });
});
