/* Disposable localhost Mongo only; synthetic records, no app startup or .env. */
const mongoose = require('mongoose');
const express = require('express');
const models = require('../../models/taric_tool');
const { createService } = require('../../services/taric/service');
const { createHistory } = require('../../services/taric/history');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const { request, actor } = require('../helpers/taricHistoryFixture');
const { hash } = require('../../utils/taricProtocol');
const logger = require('../../utils/logger');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const uri = process.env.TARIC_TEST_MONGO_URL;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/taric_test_[a-z0-9_]+$/.test(uri || '') ? describe : describe.skip;
run('approved-code registry integration', () => {
  let service, registry;
  beforeAll(async () => {
    await mongoose.connect(`${uri}_codes`, { autoCreate: false, autoIndex: false });
    for (const m of Object.values(models)) { await m.createCollection(); await m.createIndexes(); }
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    for (const m of Object.values(models)) await m.deleteMany({});
    await models.Settings.create({ _id: 'tool', owner: 'synthetic-owner' });
    service = createService({ models, transport: {}, evidence: {}, authorizeAdmin: async a => a === actor,
      warmSessions: { generate: async () => ({ taric_code: '0000000002', description: 'Model wording' }) } });
    registry = service.approvedCodes;
    jest.clearAllMocks();
  });
  async function seed() {
    const buffer = Buffer.from('taricCode\n0000000002\n0000000002\n0000000003');
    const preview = await registry.importCsv(actor, buffer);
    expect(preview).toMatchObject({ unique: 2, duplicates: 1, additions: 2 });
    expect(await models.ApprovedCode.countDocuments()).toBe(0);
    await registry.importCsv(actor, buffer, preview.sha256);
    return buffer;
  }
  async function edit(extra = {}) {
    return registry.edit(actor, '0000000002', { expectedRevision: 1, headings: 'Heading', goods_summary: 'Goods', description_summary: 'Stable summary', approved: true, ...extra });
  }
  test('preview, insert, repeat import, revocation, stale edit and permission bounds', async () => {
    const buffer = await seed();
    expect(await edit({ approved: false })).toMatchObject({ revision: 2, approved: false });
    await registry.importCsv(actor, buffer, (await registry.importCsv(actor, buffer)).sha256);
    expect(await models.ApprovedCode.findById('0000000002').lean()).toMatchObject({ revision: 2, approved: false, description_summary: 'Stable summary' });
    await expect(edit()).rejects.toMatchObject({ code: 'STALE' });
    await expect(edit({ owner: 'other' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(registry.list('b'.repeat(24))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(registry.list(actor, { prefix: { $ne: '' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(registry.importCsv(actor, buffer, 'a'.repeat(64))).rejects.toMatchObject({ code: 'STALE' });
    expect((await registry.list(actor, { prefix: '0000000003' })).rows).toHaveLength(1);
  });
  test('registry snapshots supply stable training descriptions and edits invalidate previews', async () => {
    await seed(); await edit();
    const raw = request(1); const { feedback, reviews, ...parent } = raw;
    await models.Request.create(parent);
    const history = createHistory({ models, adminPrincipal: service.adminPrincipal });
    const row = await history.detail(actor, parent._id);
    await history.review(actor, parent._id, { expectedRevision: 0, expectedSourceHash: row.sourceHash, status: 'verified',
      target: '0000000002', confirmTarget: true, correction: true, note: 'Synthetic source', approvedDescription: 'Variable old wording' });
    const options = { descriptionSource: 'registry' };
    const preview = await history.preview(actor, { options });
    expect(preview.candidates[0]).toMatchObject({ approvedDescription: 'Stable summary', review: { approvedDescription: 'Variable old wording' }, approvedCode: { revision: 2 } });
    const exported = await history.download(actor, { options, expectedSnapshotHash: preview.snapshotHash });
    expect(exported.jsonl).toContain('Stable summary');
    await edit({ expectedRevision: 2, description_summary: 'New stable summary' });
    await expect(history.download(actor, { options, expectedSnapshotHash: preview.snapshotHash })).rejects.toMatchObject({ code: 'STALE' });
    await edit({ expectedRevision: 3, description_summary: '' });
    expect((await history.preview(actor, { options })).skipped[0].reason).toBe('missing_registry_description');
    await edit({ expectedRevision: 4, approved: false });
    expect((await history.preview(actor, { options })).skipped[0].reason).toBe('unapproved_registry_code');
    expect(await models.Export.findById(exported.id).lean()).toMatchObject({ jsonl: exported.jsonl });
    expect(hash(preview.candidates[0].approvedCode)).toBe(preview.candidates[0].approvedCodeHash);
  });
  test('generation warns on unknown/revoked codes and never rewrites model descriptions', async () => {
    const generated = () => service.warmSessions.generate({}, {}, [], 200, {});
    expect(await generated()).toMatchObject({ warnings: ['unapproved_taric_code'], approved_code: { status: 'unapproved' }, description: 'Model wording' });
    expect(logger.warning).toHaveBeenCalled();
    await seed();
    expect(await generated()).toMatchObject({ approved_code: { status: 'approved' } });
    await edit({ approved: false });
    expect(await generated()).toMatchObject({ warnings: ['unapproved_taric_code'] });
  });
  test('HTTP guards reject anonymous, capability, CSRF, forged scope and unsafe uploads', async () => {
    let role = 'user'; let authenticated = true;
    const csrf = 'x'.repeat(43); const app = express();
    app.set('view engine', 'pug'); app.set('views', require('path').join(__dirname, '../../views'));
    app.use((req, _res, next) => { req.user = { _id: actor, name: 'synthetic', type_user: role }; req.session = { csrfToken: csrf }; req.isAuthenticated = () => authenticated; next(); });
    app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/admin/taric/codes`;
    const upload = (csv, headers = {}) => { const body = new FormData(); body.append('file', new Blob([csv]), 'codes.csv'); return fetch(base + '/imports', { method: 'POST', headers: { Accept: 'application/json', ...headers }, body }); };
    try {
      expect((await fetch(base + '/data')).status).toBe(403);
      role = 'family'; expect((await fetch(base)).status).toBe(403);
      role = 'admin'; authenticated = false; expect((await fetch(base)).status).toBe(401);
      authenticated = true;
      const page = await fetch(base); expect(page.headers.get('cache-control')).toContain('no-store'); expect(await page.text()).toContain('taricCode');
      expect((await upload('taricCode\n0000000002')).status).toBe(403);
      expect((await upload('taricCode\n0000000002', { 'X-CSRF-Token': csrf, Origin: 'https://evil.test' })).status).toBe(403);
      expect((await upload('taricCode\ninvalid', { 'X-CSRF-Token': csrf })).status).toBe(400);
      expect((await upload('x'.repeat(2 * 1024 * 1024 + 1), { 'X-CSRF-Token': csrf })).status).toBe(413);
      const preview = await upload('taricCode\n0000000002', { 'X-CSRF-Token': csrf }); expect(preview.status).toBe(200);
      const manifest = await preview.json();
      expect((await upload('taricCode\n0000000002', { 'X-CSRF-Token': csrf, 'X-Import-Sha': manifest.sha256 })).status).toBe(200);
      expect((await fetch(base + '/data?owner=other')).status).toBe(400);
      expect(await models.ApprovedCode.countDocuments()).toBe(1);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
