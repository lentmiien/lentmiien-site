/* Synthetic records only. Dedicated disposable localhost DB; never reads .env. */
const mongoose = require('mongoose');
const express = require('express');
const models = require('../../models/taric_tool');
const { createHistory } = require('../../services/taric/history');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const { createService } = require('../../services/taric/service');
const { request, verified, actor, id } = require('../helpers/taricHistoryFixture');
const { sha, hash } = require('../../utils/taricProtocol');
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
  const bulkFilters = { feedback: 'present', review: 'unreviewed', missing: 'no' };
  async function bulkBody(filters = bulkFilters) {
    return { filters, expectedSnapshotHash: (await history.list(actor, filters)).snapshot, confirm: true };
  }
  test('bulk approves all 120 filtered cases across pages, preserves feedback and sources, and cannot repeat approvals', async () => {
    for (let n = 1; n <= 120; n++) await seed(n);
    await seed(121, { feedback: [] }); await seed(122, { evidence: null }); await seed(123, { owner: 'foreign-owner' });
    for (const [n, status] of [[124, 'verified'], [125, 'needs_review'], [126, 'excluded']]) {
      await seed(n); await verify(id(n), { status });
    }
    await seed(127, { input: { ...request(127).input, test: false } });
    const filters = { ...bulkFilters, mode: 'test' };
    const page = await history.list(actor, filters);
    expect(page.rows).toHaveLength(50); expect(page.stats.total).toBe(120);
    const second = await history.list(actor, { ...filters, cursor: page.next, snapshot: page.snapshot });
    const input = { filters, expectedSnapshotHash: second.snapshot, confirm: true };
    const feedback = await models.Feedback.find({}).sort({ _id: 1 }).lean();
    const requests = await models.Request.find({}).sort({ _id: 1 }).lean();
    expect(await history.approveBulk(actor, input)).toEqual({ matched: 120, approved: 120, skipped: [], remaining: 0, error: null });
    expect(await models.Feedback.find({}).sort({ _id: 1 }).lean()).toEqual(feedback);
    expect(await models.Request.find({}).sort({ _id: 1 }).lean()).toEqual(requests);
    const row = await history.detail(actor, id(1));
    expect(row).toMatchObject({ revision: 1, reviewStatus: 'verified', review: { target: '0000000002', correction: true, actor,
      approvedDescription: null, sourceHash: row.sourceHash, feedbackId: row.feedback.id, feedbackHash: hash(row.feedback) } });
    expect(row.audit).toHaveLength(1); expect(row.review.note).toContain('prior human verification');
    expect(row.review.source).toEqual(row.source);
    expect(await models.Review.countDocuments()).toBe(123);
    expect((await history.list(actor, filters)).stats.total).toBe(0);
    await expect(history.approveBulk(actor, input)).rejects.toThrow('STALE');
    expect(await history.approveBulk(actor, await bulkBody(filters))).toMatchObject({ approved: 0, matched: 0 });
  });
  test('bulk rejects unsafe filters, actor/target injection, missing confirmation and stale populations before writes', async () => {
    await seed(); const input = await bulkBody();
    for (const filters of [{}, { ...bulkFilters, review: 'verified' }, { ...bulkFilters, feedback: 'absent' },
      { ...bulkFilters, missing: 'yes' }, { ...bulkFilters, search: { $ne: '' } }, { ...bulkFilters, owner: 'foreign-owner' },
      { ...bulkFilters, snapshot: input.expectedSnapshotHash }]) {
      await expect(history.approveBulk(actor, { ...input, filters })).rejects.toThrow('INVALID_REQUEST');
    }
    for (const extra of [{ confirm: false }, { confirm: 'true' }, { actor }, { target: '9999999999' }, { expectedSnapshotHash: 'bad' }]) {
      await expect(history.approveBulk(actor, { ...input, ...extra })).rejects.toThrow('INVALID_REQUEST');
    }
    await expect(history.approveBulk('b'.repeat(24), input)).rejects.toThrow('FORBIDDEN');
    await seed(2);
    await expect(history.approveBulk(actor, input)).rejects.toThrow('STALE');
    expect(await models.Review.countDocuments()).toBe(0);
  });
  test('bulk skips invalid final codes and busy cases and includes bound archived local sources', async () => {
    for (let n = 1; n <= 6; n++) await seed(n, n === 4 ? { state: 'running' } : {});
    // Legacy corrupt data is deliberately inserted below model validation.
    for (const [n, code] of [[1, '123456789'], [2, '12345678901'], [3, '1234567890\n']]) {
      await models.Feedback.collection.updateOne({ request: id(n) }, { $set: { selected_code: code } });
    }
    const source = (await history.detail(actor, id(6))).source;
    await models.Review.create({ _id: id(5), owner: 'synthetic-owner', request: id(5), revision: 0, localRevision: 0, localClaim: id(999) });
    await models.Review.create({ _id: id(6), owner: 'synthetic-owner', request: id(6), revision: 0, localRevision: 1,
      originalSource: source, localSource: source });
    await models.Request.deleteOne({ _id: id(6) }); await models.Feedback.deleteOne({ request: id(6) });
    const result = await history.approveBulk(actor, await bulkBody());
    expect(result).toMatchObject({ matched: 6, approved: 1, remaining: 0, error: null });
    expect(result.skipped.filter(r => r.reason === 'invalid_final_code')).toHaveLength(3);
    expect(result.skipped.filter(r => r.reason === 'request_busy')).toHaveLength(2);
    expect(await history.detail(actor, id(6))).toMatchObject({ reviewStatus: 'verified', sourceStorage: 'archived_review', stale: false });
  });
  test('bulk skips concurrent reviews and source changes without overwriting them', async () => {
    await seed(1); await seed(2); await seed(3); const input = await bulkBody();
    let calls = 0;
    const racing = createHistory({ models, adminPrincipal: async who => {
      if (++calls === 2) {
        await verify(id(3), { status: 'excluded', note: 'Concurrent review' });
        await models.Request.collection.updateOne({ _id: id(2) }, { $set: { 'evidence.facts.name': 'Changed source' } });
      }
      return service.adminPrincipal(who);
    } });
    const result = await racing.approveBulk(actor, input);
    expect(result).toMatchObject({ approved: 1, remaining: 0 });
    expect(result.skipped).toEqual([3, 2].map(n => ({ id: id(n), reason: 'source_or_review_changed' })));
    expect(await history.detail(actor, id(3))).toMatchObject({ revision: 1, reviewStatus: 'excluded', review: { note: 'Concurrent review' } });
    expect(await models.Review.findById(id(2))).toBeNull();
  });
  test('bulk storage failure reports partial progress, logs safe metadata and supports retrying remaining entries', async () => {
    await seed(1); await seed(2); const input = await bulkBody();
    const update = models.Review.updateOne.bind(models.Review); let calls = 0;
    const spy = jest.spyOn(models.Review, 'updateOne').mockImplementation((...args) => {
      if (++calls === 2) throw new Error('Synthetic private failure SECRET');
      return update(...args);
    });
    try {
      const result = await history.approveBulk(actor, input);
      expect(result).toEqual({ matched: 2, approved: 1, skipped: [], remaining: 1, error: 'STORAGE_FAILED' });
      expect(require('../../utils/logger').error).toHaveBeenCalledWith(expect.stringContaining('bulk approval interrupted'),
        { category: 'taric', metadata: { reason: 'STORAGE_FAILED', approved: 1, matched: 2 } });
    } finally { spy.mockRestore(); }
    expect(await history.approveBulk(actor, await bulkBody())).toMatchObject({ matched: 1, approved: 1, remaining: 0 });
    expect(await models.Review.countDocuments({ revision: 1 })).toBe(2);
  });
  test('verified final source survives raw deletion, reproduces both hashes, and revocation preserves frozen exports', async () => {
    const rid = await seed(); await verify(rid, { approvedDescription: 'Independently approved synthetic description' });
    const before = await history.detail(actor, rid);
    const livePreview = await history.preview(actor, {});
    await models.Request.deleteOne({ _id: rid }); await models.Feedback.deleteOne({ request: rid });
    const after = await history.detail(actor, rid);
    expect(after).toMatchObject({ sourceStorage: 'archived_review', revision: 1, stale: false, eligible: true,
      sourceHash: before.sourceHash, source: before.source, review: before.review, canonical: before.canonical });
    expect((await history.list(actor, {})).stats).toMatchObject({ total: 1, live: 0, archived: 1, verified: 1 });
    await expect(history.download(actor, { expectedSnapshotHash: livePreview.snapshotHash })).rejects.toThrow('STALE');
    const preview = await history.preview(actor, {});
    const downloaded = await history.download(actor, { expectedSnapshotHash: preview.snapshotHash });
    const candidate = JSON.parse(downloaded.jsonl.trimEnd().split('\n')[1]);
    expect(candidate.targetCode).toBe('0000000002');
    expect(hash(candidate.source)).toBe(candidate.sourceHash);
    expect(hash(candidate.review)).toBe(candidate.reviewHash);
    expect(candidate.review.feedbackHash).toBe(hash(candidate.source.feedback));
    await verify(rid, { status: 'unreviewed', target: null });
    expect((await history.preview(actor, {})).summary.selected).toBe(0);
    await verify(rid, { status: 'excluded', target: null });
    expect((await history.preview(actor, {})).summary.selected).toBe(0);
    expect((await history.detail(actor, rid)).audit[0]).toEqual(before.audit[0]);
    expect((await models.Export.findOne({ owner: 'synthetic-owner', requests: rid }).lean()).jsonl).toBe(downloaded.jsonl);
    await expect(models.Review.updateOne({ _id: rid }, { $set: { 'history.0.source.facts.name': 'overwrite' } })).rejects.toThrow('append-only CAS');
  });
  test.each([false, true])('proposal verification never regains freshness after late feedback and deletion (observed=%s)', async observed => {
    const rid = await seed(1, { feedback: [] }); await verify(rid);
    await models.Feedback.create({ _id: id(900), owner: 'synthetic-owner', principal: 'integration', key: 'late-conflict',
      request: rid, selected_code: '9999999999', decision: 'changed' });
    if (observed) expect((await history.detail(actor, rid)).stale).toBe(true);
    await models.Request.deleteOne({ _id: rid }); await models.Feedback.deleteOne({ request: rid });
    expect(await history.detail(actor, rid)).toMatchObject({ revision: 1, stale: true, eligible: false, reviewStatus: 'needs_review' });
    expect((await history.preview(actor, {})).summary.selected).toBe(0);
    await expect(verify(rid)).rejects.toThrow('STALE');
    await verify(rid, { status: 'excluded' });
    expect((await history.preview(actor, {})).summary.selected).toBe(0);
  });
  test('explicit re-review of final feedback survives deletion; incomplete and foreign archives never enter candidates', async () => {
    const rid = await seed(1, { feedback: [] }); await verify(rid);
    await models.Feedback.create({ _id: id(900), owner: 'synthetic-owner', principal: 'integration', key: 'late-final',
      request: rid, selected_code: '9999999999', decision: 'changed' });
    await verify(rid);
    const incomplete = await seed(2, { evidence: null }); await verify(incomplete);
    const foreign = await seed(3, { owner: 'foreign-owner' });
    const foreignHistory = createHistory({ models, adminPrincipal: async () => ({ id: `admin_${actor}`, owner: 'foreign-owner' }) });
    const row = await foreignHistory.detail(actor, foreign);
    await foreignHistory.review(actor, foreign, { ...await body(rid), expectedRevision: 0, expectedSourceHash: row.sourceHash, target: row.feedback.code });
    await models.Request.deleteMany({}); await models.Feedback.deleteMany({});
    const list = await history.list(actor, {});
    expect(list.stats).toMatchObject({ total: 2, live: 0, archived: 2, eligible: 1 });
    expect(await history.detail(actor, rid)).toMatchObject({ revision: 2, stale: false, review: { target: '9999999999' } });
    expect(await history.detail(actor, incomplete)).toMatchObject({ eligible: false, facts: { name: null }, reasons: ['missing_full_item_name'] });
    await expect(history.detail(actor, foreign)).rejects.toThrow('NOT_FOUND');
    await expect(history.review(actor, foreign, await body(rid))).rejects.toThrow('NOT_FOUND');
    expect((await history.preview(actor, {})).candidates.map(r => r.requestId)).toEqual([rid]);
  });
  test('indexed base filters narrow 2001 unrelated requests; archives count once and out-of-filter conflicts still block', async () => {
    const docs = Array.from({ length: 2001 }, (_, n) => ({ _id: id(n + 100), owner: 'synthetic-owner', principal: 'integration',
      key: `unrelated-${n}`, input: { test: false, jan: '99999999' }, state: 'failed', createdAt: new Date('2026-01-01') }));
    await models.Request.insertMany(docs);
    const rid = await seed(); await verify(rid);
    await expect(history.list(actor, {})).rejects.toMatchObject({ historyStatus: 413 });
    const filters = [{ from: '2026-09-20', to: '2026-09-20' }, { jan: request().input.jan }, { mode: 'test' }, { state: 'complete' }];
    for (const filter of filters) {
      const spy = jest.spyOn(models.Request, 'aggregate');
      expect((await history.list(actor, filter)).stats).toMatchObject({ total: 1, live: 1, archived: 0 });
      const pipeline = spy.mock.calls[0][0]; spy.mockRestore();
      const plan = await models.Request.aggregate(pipeline.slice(0, 3)).explain('executionStats');
      expect(JSON.stringify(plan)).toMatch(/request_(inspection|filter_)/);
      expect(plan.executionStats?.totalDocsExamined ?? plan.stages?.[0]?.$cursor?.executionStats?.totalDocsExamined).toBeLessThanOrEqual(1);
      expect((await history.preview(actor, { filters: filter })).summary.selected).toBe(1);
    }
    await models.Request.deleteOne({ _id: rid }); await models.Feedback.deleteOne({ request: rid });
    for (const filter of filters) {
      expect((await history.list(actor, filter)).stats).toMatchObject({ total: 1, live: 0, archived: 1 });
      expect((await history.preview(actor, { filters: filter })).summary.selected).toBe(1);
    }
    const other = await seed(2, { input: { ...request(2).input, jan: request().input.jan }, createdAt: new Date('2026-09-21') });
    await verify(other, { target: '9999999999', correction: true });
    const preview = await history.preview(actor, { filters: filters[0] });
    expect(preview.summary.available).toBe(1); expect(preview.summary.selected).toBe(0);
    expect(preview.skipped[0].reasons).toContain('conflicting_verified_targets');
    await verify(other, { status: 'excluded' });
    expect((await history.preview(actor, { filters: filters[0] })).summary.selected).toBe(1);
  });
  test('pagination rejects population changes and snapshot source byte bound fails explicitly', async () => {
    const docs = Array.from({ length: 51 }, (_, n) => { const { feedback, ...r } = request(n + 1); return r; });
    await models.Request.insertMany(docs);
    const first = await history.list(actor, {});
    await models.Request.deleteOne({ _id: id(1) });
    await expect(history.list(actor, { cursor: first.next, snapshot: first.snapshot })).rejects.toThrow('STALE');
    const huge = await seed(60, { evidence: { facts: Object.fromEntries(require('../../utils/taricContracts').FACT_FIELDS.map(k => [k, '界'.repeat(12000)])) } });
    await expect(verify(huge)).rejects.toMatchObject({ historyCode: expect.stringContaining('REVIEW_SOURCE_TOO_LARGE') });
    expect(await models.Review.countDocuments()).toBe(0);
  });
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
    await expect(verify(rid, { expectedRevision: 100 })).rejects.toMatchObject({ historyStatus: 413, historyCode: expect.stringContaining('REVIEW_REVISION_LIMIT') });
    await expect(verify(rid, { target: 0 })).rejects.toThrow('INVALID_REQUEST');
  });
  test('stable createdAt and ID cursor pagination and UTC filter statistics', async () => {
    const docs = Array.from({ length: 55 }, (_, n) => { const { feedback, ...r } = request(n + 1); return r; });
    await models.Request.insertMany(docs);
    const first = await history.list(actor, { from: '2026-09-20', to: '2026-09-20' });
    expect(first.rows).toHaveLength(50); expect(first.stats.total).toBe(55); expect(first.rows[0].id).toBe(id(55));
    const second = await history.list(actor, { cursor: first.next, snapshot: first.snapshot });
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
    expect(download.jsonl).not.toMatch(/synthetic-key|sessionId|reasoning|headers|private_data/);
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
      const bulkInput = await bulkBody();
      expect((await post('/approve-bulk', bulkInput)).status).toBe(403);
      role = 'family'; expect((await post('/approve-bulk', bulkInput)).status).toBe(403);
      role = 'admin'; authenticated = false;
      expect((await post('/approve-bulk', bulkInput)).status).toBe(401);
      authenticated = true;
      expect((await post('/approve-bulk', bulkInput, { 'X-CSRF-Token': '' })).status).toBe(403);
      expect((await post('/approve-bulk', bulkInput, { 'X-CSRF-Token': 'invalid' })).status).toBe(403);
      expect((await post('/approve-bulk', bulkInput, { Origin: 'https://evil.test' })).status).toBe(403);
      expect((await fetch(url + '/approve-bulk')).status).toBe(404);
      expect((await post('/approve-bulk', { ...bulkInput, actor })).status).toBe(400);
      expect((await post('/approve-bulk', { ...bulkInput, padding: 'x'.repeat(4096) })).status).toBe(413);
      expect(await models.Review.countDocuments()).toBe(0);
      role = 'user';
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
      await seed(3);
      const bulkResponse = await post('/approve-bulk', await bulkBody());
      expect(bulkResponse.status).toBe(200); expect(bulkResponse.headers.get('cache-control')).toContain('no-store');
      expect(await bulkResponse.json()).toMatchObject({ matched: 1, approved: 1 });
      expect(await models.Review.findById(id(2))).toBeNull();
      const spy = jest.spyOn(models.Request, 'aggregate').mockImplementationOnce(() => { throw new Error('synthetic storage failure SECRET'); });
      const failure = await fetch(url + '/data'); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('SECRET'); spy.mockRestore();
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
