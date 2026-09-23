/* Synthetic records only. Dedicated disposable localhost DB; never reads .env. */
const mongoose = require('mongoose');
const express = require('express');
const models = require('../../models/taric_tool');
const { createHistory } = require('../../services/taric/history');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const { createService } = require('../../services/taric/service');
const { request, verified, actor, id } = require('../helpers/taricHistoryFixture');
const { sha } = require('../../utils/taricProtocol');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const baseUri = process.env.TARIC_TEST_MONGO_URL;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/taric_test_[a-z0-9_]+$/.test(baseUri || '') ? describe : describe.skip;
run('TARIC human history on standalone Mongo', () => {
  let history, service;
  beforeAll(async () => {
    await mongoose.connect(`${baseUri}_history`, { autoCreate: false, autoIndex: false });
    for (const m of Object.values(models)) { await m.createCollection(); await m.createIndexes(); }
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    for (const m of Object.values(models)) await m.deleteMany({});
    await models.Settings.create({ _id: 'tool', owner: 'synthetic-owner', enabled: false, testCatalog: { codes: ['0000000001'] } });
    service = createService({ models, transport: {}, evidence: {}, authorizeAdmin: async a => a === actor });
    history = createHistory({ models, adminPrincipal: service.adminPrincipal });
  });
  async function seed(n = 1, overrides = {}) {
    const raw = request(n, overrides); const { feedback, reviews, ...parent } = raw;
    await models.Request.create(parent);
    if (feedback?.length) await models.Feedback.create({ _id: feedback[0]._id, owner: parent.owner, principal: parent.principal, request: parent._id,
      key: `synthetic-feedback-${n}`, selected_code: feedback[0].selected_code, decision: feedback[0].decision, createdAt: feedback[0].createdAt });
    return parent._id;
  }
  async function body(requestId, extra = {}) {
    const row = await history.detail(actor, requestId);
    return { expectedRevision: row.revision, expectedSourceHash: row.sourceHash, status: 'verified', target: row.feedback?.code || row.suggestion?.code,
      confirmTarget: true, correction: false, note: 'Synthetic human-reviewed source', approvedDescription: null, ...extra };
  }
  async function verify(requestId, extra = {}) { return history.review(actor, requestId, await body(requestId, extra)); }
  test('bootstrap indexes are idempotent; owner joins and counts exclude foreign requests and benchmarks', async () => {
    for (const m of [models.Review, models.Export]) await m.createIndexes();
    expect((await models.Review.listIndexes()).some(i => i.name === 'review_owner_request' && i.unique)).toBe(true);
    await seed(); await seed(2, { owner: 'foreign-owner' });
    await models.Benchmark.create({ _id: id(900), version: 0, cases: Array.from({ length: 67 }, () => ({ input: 'synthetic' })) });
    const listed = await history.list(actor, {});
    expect(listed.stats).toMatchObject({ total: 1, feedback: 1, decisions: { changed: { count: 1, denominator: 1 } } });
    await expect(history.detail(actor, id(2))).rejects.toThrow('NOT_FOUND');
    await expect(history.review(actor, id(2), await body(id(1)))).rejects.toThrow('NOT_FOUND');
    await expect(history.list('b'.repeat(24), {})).rejects.toThrow('FORBIDDEN');
    expect((await history.preview(actor, {})).summary.available).toBe(1);
    await models.Feedback.updateOne({ request: id(1) }, { $set: { owner: 'foreign-owner' } });
    expect((await history.list(actor, {})).stats.feedback).toBe(0);
  });
  test('explicit corrected code outside test catalog, separate description and immutable feedback; CAS audit', async () => {
    const rid = await seed(); const feedbackBefore = await models.Feedback.findOne({ request: rid }).lean();
    const first = await body(rid, { target: '9999999999', correction: true });
    const race = await Promise.allSettled([history.review(actor, rid, first), history.review(actor, rid, first)]);
    expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.find(r => r.status === 'rejected').reason.code).toBe('STALE');
    let row = await history.detail(actor, rid);
    expect(row).toMatchObject({ revision: 1, eligible: true, targetInTestCatalog: false, review: { actor, target: '9999999999', approvedDescription: null } });
    expect(row.audit).toHaveLength(1);
    await expect(history.review(actor, rid, { ...first, actor: 'spoofed' })).rejects.toThrow('INVALID_REQUEST');
    await verify(rid, { status: 'excluded', note: 'Synthetic exclusion reason' });
    row = await history.detail(actor, rid);
    expect(row.audit).toHaveLength(2); expect(row.audit[0].at).toBeDefined(); expect(row.eligible).toBe(false);
    expect(await models.Feedback.findOne({ request: rid }).lean()).toEqual(feedbackBefore);
    await verify(rid, { status: 'unreviewed', note: 'Synthetic withdrawal' });
    expect((await history.detail(actor, rid)).audit).toHaveLength(3);
  });
  test('no feedback requires accepted suggestion and explicit confirmation; no target or rejected diagnostic cannot verify', async () => {
    const rid = await seed(1, { feedback: [] });
    await expect(verify(rid, { confirmTarget: false })).rejects.toThrow('INVALID_REQUEST');
    await verify(rid);
    await models.Feedback.create({ _id: id(900), owner: 'synthetic-owner', principal: 'integration', key: 'late-feedback', request: rid, selected_code: '0000000001', decision: 'accepted' });
    expect(await history.detail(actor, rid)).toMatchObject({ stale: true, eligible: false, reviewStatus: 'needs_review' });
    await verify(rid);
    expect((await history.detail(actor, rid)).stale).toBe(false);
    const rejected = await seed(2, { feedback: [], result: null, diagnostics: { proposal: { taric_code: '9999999999' } }, error: 'CATALOG_REJECTED' });
    await expect(verify(rejected, { target: '9999999999', correction: true })).rejects.toThrow('INVALID_REQUEST');
    const incomplete = await seed(3, { result: null, evidence: null, error: 'EVIDENCE_NOT_FOUND' });
    await verify(incomplete); expect(await history.detail(actor, incomplete)).toMatchObject({ reviewStatus: 'verified', eligible: false, reasons: ['missing_full_item_name'] });
  });
  test('source CAS rejects changed facts; a change during download revalidation creates no manifest', async () => {
    const rid = await seed(); const staleBody = await body(rid);
    await models.Request.updateOne({ _id: rid }, { $set: { 'evidence.facts.name': 'Synthetic changed evidence' } });
    await expect(history.review(actor, rid, staleBody)).rejects.toThrow('STALE');
    await verify(rid);
    const preview = await history.preview(actor, {});
    const principal = service.adminPrincipal; let calls = 0;
    const racing = createHistory({ models, adminPrincipal: async who => {
      if (++calls === 2) await verify(rid, { note: 'Synthetic change between export scans' });
      return principal(who);
    } });
    await expect(racing.download(actor, { expectedSnapshotHash: preview.snapshotHash })).rejects.toThrow('STALE');
    expect(await models.Export.countDocuments()).toBe(0);
    await expect(verify(rid, { note: 'x'.repeat(2001) })).rejects.toThrow('INVALID_REQUEST');
    await expect(verify(rid, { expectedRevision: 100 })).rejects.toThrow('INVALID_REQUEST');
    await expect(verify(rid, { target: 0 })).rejects.toThrow('INVALID_REQUEST');
  });
  test('stable createdAt and ID cursor pagination and UTC filter statistics', async () => {
    const docs = Array.from({ length: 55 }, (_, n) => { const { feedback, ...r } = request(n + 1); return r; });
    await models.Request.insertMany(docs);
    const first = await history.list(actor, { from: '2026-09-20', to: '2026-09-20' });
    expect(first.rows).toHaveLength(50); expect(first.stats.total).toBe(55); expect(first.rows[0].id).toBe(id(55));
    const second = await history.list(actor, { cursor: first.next });
    expect(second.rows.map(r => r.id)).toEqual([5, 4, 3, 2, 1].map(id)); expect(second.next).toBeNull(); expect(second.stats.total).toBe(55);
    expect((await history.list(actor, { from: '2026-09-21' })).stats.total).toBe(0);
  });
  test('preview/download freezes exact Unicode JSONL, SHA and manifest; later edits return 409 and never rewrite exports', async () => {
    const rid = await seed(); await verify(rid, { approvedDescription: 'Explicit synthetic 日本語\ndescription' });
    const input = { filters: {}, options: { mode: 'balanced', limit: 10, perCode: 2 } };
    const preview = await history.preview(actor, input);
    expect(preview.summary.selected).toBe(1);
    const download = await history.download(actor, { ...input, expectedSnapshotHash: preview.snapshotHash });
    const lines = download.jsonl.trimEnd().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ type: 'candidate', targetCode: '0000000002', approvedDescription: 'Explicit synthetic 日本語\ndescription', facts: { name: 'Synthetic 商品 1' } });
    expect(lines[0].rowsSha256).toBe(sha(JSON.stringify(lines[1]) + '\n'));
    const stored = await models.Export.findById(download.id).lean(); expect(stored.sha256).toBe(sha(download.jsonl));
    expect(stored.jsonl).toBe(download.jsonl);
    await expect(models.Export.updateOne({ _id: download.id }, { $set: { jsonl: 'replacement' } })).rejects.toThrow('append-only');
    expect(download.jsonl).not.toMatch(/synthetic-key|proposal|sessionId|reasoning|headers|private_data/);
    await verify(rid, { note: 'Synthetic changed review note' });
    await expect(history.download(actor, { ...input, expectedSnapshotHash: preview.snapshotHash })).rejects.toThrow('STALE');
    expect(await models.Export.countDocuments()).toBe(1);
    expect((await models.Export.findById(download.id).lean()).jsonl).toBe(stored.jsonl);
    await expect(history.preview(actor, { filters: { owner: 'foreign' } })).rejects.toThrow('INVALID_REQUEST');
    await expect(history.download(actor, { ...input, ids: [id(2)], expectedSnapshotHash: preview.snapshotHash })).rejects.toThrow('INVALID_REQUEST');
  });
  test('conflict scan cannot be bypassed by filters; locked independent identities excluded, v0 ignored', async () => {
    const rid = await seed(); await verify(rid);
    const other = await seed(2, { input: { ...request(2).input, jan: request().input.jan } }); await verify(other, { target: '9999999999', correction: true });
    const preview = await history.preview(actor, { filters: { code: '0000000002' } });
    expect(preview.summary.selected).toBe(0); expect(preview.skipped.every(r => r.reasons.includes('conflicting_verified_targets'))).toBe(true);
    await verify(other, { status: 'excluded' });
    expect((await history.preview(actor, {})).summary.selected).toBe(1);
    const row = await history.detail(actor, rid);
    await models.Benchmark.create({ _id: id(990), version: 0, state: 'draft', contaminated: true, cases: [{ overlapHash: row.overlapHash }] });
    expect((await history.preview(actor, {})).summary.selected).toBe(1);
    await models.Benchmark.create({ _id: id(991), version: 1, state: 'published', releaseEligible: true, contaminated: false,
      review: { independent: true, trainingExcluded: true }, cases: [{ overlapHash: row.overlapHash }] });
    expect((await history.preview(actor, {})).summary.selected).toBe(0);
  });
  test('bounded scan rejects oversized population and malformed filters before reads', async () => {
    const docs = Array.from({ length: 2001 }, (_, n) => ({ _id: id(n + 1), owner: 'synthetic-owner', principal: 'integration', key: String(n), input: {}, state: 'failed' }));
    await models.Request.insertMany(docs);
    await expect(history.list(actor, {})).rejects.toMatchObject({ historyStatus: 413 });
    await expect(history.list(actor, { search: { $ne: 'x' } })).rejects.toThrow('INVALID_REQUEST');
    await expect(history.preview(actor, { options: { limit: 201 } })).rejects.toThrow('INVALID_REQUEST');
  });
  test('export byte cap refuses oversized valid source candidates without writing a manifest', async () => {
    const requests = []; const feedback = []; const reviews = [];
    for (let n = 1; n <= 150; n++) {
      const evidence = { facts: { name: `Synthetic large item ${n}`, specifications: 'x'.repeat(12000), details: 'x'.repeat(12000), remarks: 'x'.repeat(12000), brand: 'x'.repeat(12000), seriesTitle: 'x'.repeat(12000) } };
      const raw = request(n, { evidence }); const { feedback: f, ...parent } = raw;
      requests.push(parent);
      feedback.push({ _id: f[0]._id, request: parent._id, owner: parent.owner, principal: parent.principal, key: `synthetic-large-${n}`, selected_code: f[0].selected_code, decision: f[0].decision, createdAt: f[0].createdAt });
      const row = verified(n, n % 2 ? '0000000001' : '0000000002', { evidence });
      const latest = { ...row.review, correction: n % 2 === 1 };
      reviews.push({ _id: parent._id, request: parent._id, owner: parent.owner, revision: 1, latest, history: [latest] });
    }
    await models.Request.insertMany(requests); await models.Feedback.insertMany(feedback); await models.Review.insertMany(reviews);
    const input = { options: { limit: 200, perCode: 100 } };
    const preview = await history.preview(actor, input); expect(preview.summary.selected).toBe(150);
    await expect(history.download(actor, { ...input, expectedSnapshotHash: preview.snapshotHash })).rejects.toMatchObject({ historyStatus: 413 });
    expect(await models.Export.countDocuments()).toBe(0);
  });
  test('HTTP session, capability and CSRF deny machine key; trusted actor, private headers, foreign IDs and storage failure', async () => {
    const rid = await seed(); let role = 'user'; let authenticated = true;
    const csrf = 'x'.repeat(43); const app = express();
    app.set('views', require('path').join(__dirname, '../../views')); app.set('view engine', 'pug');
    app.use((req, _res, next) => { req.user = { _id: actor, name: 'synthetic', type_user: role }; req.session = { csrfToken: csrf }; req.isAuthenticated = () => authenticated; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/admin/taric/history`;
    const post = (path, value, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(value) });
    try {
      expect((await fetch(url + '/data')).status).toBe(403); role = 'family'; expect((await fetch(url)).status).toBe(403);
      role = 'admin'; authenticated = false;
      expect((await post(`/${rid}/review`, {}, { Authorization: `Bearer ttk_${'s'.repeat(43)}` })).status).toBe(401);
      authenticated = true;
      const page = await fetch(url); expect(page.headers.get('cache-control')).toContain('no-store');
      expect(await page.text()).toContain(`name="csrf-token" content="${csrf}"`);
      const list = await fetch(url + '/data?mode=test'); expect(list.status).toBe(200); expect((await list.json()).stats.total).toBe(1);
      expect((await fetch(url + '/data?owner=foreign')).status).toBe(400);
      expect((await fetch(url + '/data?search[$ne]=x')).status).toBe(400);
      expect((await post(`/${rid}/review`, await body(rid), { 'X-CSRF-Token': '' })).status).toBe(403);
      expect((await post(`/${rid}/review`, await body(rid), { Origin: 'https://evil.test' })).status).toBe(403);
      expect((await post(`/${rid}/review`, await body(rid))).status).toBe(200);
      await seed(2, { owner: 'foreign-owner' }); expect((await fetch(url + '/' + id(2))).status).toBe(404);
      const preview = await (await post('/preview', {})).json();
      const download = await post('/download', { expectedSnapshotHash: preview.snapshotHash });
      expect(download.status).toBe(200); expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="taric-candidates-[a-f0-9]{32}\.jsonl"$/);
      expect(download.headers.get('cache-control')).toContain('no-store');
      expect((await fetch(url + '/' + rid + '/review')).status).toBe(404);
      const spy = jest.spyOn(models.Request, 'aggregate').mockImplementationOnce(() => { throw new Error('synthetic storage failure SECRET'); });
      const failure = await fetch(url + '/data'); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('SECRET'); spy.mockRestore();
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
