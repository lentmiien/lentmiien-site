jest.mock('../../models/my_life_log_entry', () => ({ create: jest.fn(async payload => ({ _id: '333333333333333333333333', ...payload })) }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createAccountDashboard } = require('../../routes/accountDashboard');
const { DEFAULT_JOBS } = require('../../services/accountPreferencesService');
const owner = '111111111111111111111111';
const token = 'a'.repeat(43);
let server; let base; let principal; let authenticated; let grants; let data; let userModel; let lifeLogLabels;
beforeEach(async () => {
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = owner;
  principal = { _id: owner, name: 'private@example.invalid', type_user: 'user' };
  authenticated = true; grants = [];
  data = { load: jest.fn(async () => ({ rows: [], state: 'empty' })), read: jest.fn(async () => []) };
  lifeLogLabels = jest.fn(async () => ['Synthetic label']);
  userModel = { updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
  const app = express(); app.set('views', 'views'); app.set('view engine', 'pug'); app.locals.formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
  app.use((req, res, next) => { req.user = principal; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; res.locals.loggedIn = authenticated; res.locals.bookmarks = []; res.locals.htmlPaths = []; next(); });
  app.use('/mypage', createAccountDashboard({ data, userModel, lifeLogLabels, roleModel: { findOne: async q => q.type === 'user' ? { permissions: grants } : null } }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; await new Promise(resolve => server.close(resolve)); });
const save = (body, headers = {}, path = '/api/settings') => fetch(`${base}/mypage${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token, ...headers }, body: JSON.stringify(body) });
const valid = () => ({ version: 1, sectionOrder: ['jobs'], hiddenSections: [], collapsedSections: [], jobs: { ...DEFAULT_JOBS } });
test('fast shell performs no data/provider queries, escapes text and omits private identifiers', async () => {
  principal.dashboard_settings = { hiddenSections: ['jobs'] };
  const response = await fetch(`${base}/mypage`); const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(html).not.toContain(principal.name); expect(html).not.toContain(owner);
  expect(html).not.toContain('googletagmanager'); expect(data.load).not.toHaveBeenCalled(); expect(data.read).not.toHaveBeenCalled();
  expect(html).toContain('data-section="jobs" hidden');
});
test.each(['accounting', 'life', 'minute', 'embedding'])('another admin cannot request %s or cause any data calls', async id => {
  principal.type_user = 'admin'; principal._id = '222222222222222222222222'; grants = ['accounting', 'embedding'];
  expect((await fetch(`${base}/mypage/api/cards/${id}`)).status).toBe(403);
  expect(data.load).not.toHaveBeenCalled();
});
test.each(['/api/life-panel', '/api/life/entries', '/api/life/labels'])('personal endpoint %s denies another admin before reads', async path => {
  principal.type_user = 'admin'; principal._id = '222222222222222222222222';
  expect((await fetch(`${base}/mypage${path}`)).status).toBe(403); expect(data.read).not.toHaveBeenCalled(); expect(data.load).not.toHaveBeenCalled();
});
test('anonymous and unknown roles receive JSON denial', async () => {
  authenticated = false;
  expect((await fetch(`${base}/mypage/api/settings`)).status).toBe(401);
  authenticated = true; principal.type_user = 'unknown';
  expect((await fetch(`${base}/mypage/api/settings`)).status).toBe(403);
});
test.each([{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'b'.repeat(43) }, { Origin: 'https://foreign.invalid' }])('preferences require CSRF and trusted Origin %#', async headers => {
  expect((await save(valid(), headers)).status).toBe(403); expect(userModel.updateOne).not.toHaveBeenCalled();
});
test('save writes validated principal id only and returns effective choices', async () => {
  const response = await save(valid(), { Origin: base }); expect(response.status).toBe(200);
  expect(userModel.updateOne.mock.calls[0][0]).toEqual({ _id: owner });
  expect((await response.json()).settings.sectionOrder).toEqual(['jobs']);
});
test('client owner field, unknown choices, oversized body fail before writes', async () => {
  expect((await save({ ...valid(), userId: 'foreign' })).status).toBe(400);
  expect((await save({ ...valid(), hiddenSections: ['unknown'] })).status).toBe(400);
  expect((await save({ ...valid(), data: 'x'.repeat(50000) })).status).toBe(413);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});
test('GET never migrates/writes and inaccessible preferences never leak in response', async () => {
  principal.dashboard_settings = { hiddenSections: ['accounting'], collapsedSections: ['life'] };
  const response = await fetch(`${base}/mypage/api/settings`);
  const result = await response.json();
  expect(result.settings.hiddenSections).toEqual([]); expect(result.settings.collapsedSections).toEqual([]);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});
test('navbar writes preserve rollback preferences and omit inaccessible response IDs', async () => {
  principal.mypage_icon_settings = { order: ['accounting', 'gpt_image'], hidden: ['accounting'] };
  const response = await save({ order: ['gpt_image'], hidden: [] }, {}, '/icon-settings');
  expect(response.status).toBe(200);
  expect(userModel.updateOne.mock.calls[0][1].$set.navbar_settings.hidden).toContain('accounting');
  expect(userModel.updateOne.mock.calls[0][1].$set.mypage_icon_settings).toBeUndefined();
  expect((await response.json()).settings.hidden).not.toContain('accounting');
});
test('a failed card returns a generic error and the next card still works', async () => {
  data.load.mockRejectedValueOnce(new Error('provider secret'));
  const failed = await fetch(`${base}/mypage/api/cards/jobs`);
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('provider secret');
  expect((await fetch(`${base}/mypage/api/cards/jobs`)).status).toBe(200);
});
test('authorized partial accounting response stays uncached and distinct from a failed card', async () => {
  principal.type_user = 'admin'; grants = ['accounting'];
  data.load.mockResolvedValueOnce({ state: 'partial', rows: [
    { title: 'Spending summary unavailable', detail: 'Review expense types in Accounting.', href: '/accounting' },
    { title: 'Synthetic account', detail: 'USD 125 · current', href: '/accounting' },
  ] });
  const response = await fetch(`${base}/mypage/api/cards/accounting`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toMatchObject({ ok: true, state: 'partial', rows: expect.arrayContaining([{ title: 'Synthetic account', detail: 'USD 125 · current', href: '/accounting' }]) });
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('Life Log mutation checks owner and CSRF before loading a record model', async () => {
  principal.type_user = 'admin'; principal._id = '222222222222222222222222';
  expect((await save({ type: 'basic', label: 'Synthetic', value: '1' }, {}, '/api/life/entry')).status).toBe(403);
  principal._id = owner;
  expect((await save({ type: 'basic', label: 'Synthetic', value: '1' }, { 'X-CSRF-Token': '' }, '/api/life/entry')).status).toBe(403);
  expect((await save({ type: 'basic', label: 'Synthetic', value: '1', owner: 'foreign' }, {}, '/api/life/entry')).status).toBe(400);
});

test('owner Life Log save keeps only fields belonging to the entry type', async () => {
  principal.type_user = 'admin';
  const response = await save({ type: 'basic', label: 'Synthetic', value: '1', text: 'not a diary entry' }, {}, '/api/life/entry');
  expect(response.status).toBe(200);
  const { create } = require('../../models/my_life_log_entry');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'basic', label: 'Synthetic', value: '1', text: '', v_log_data: '' }));
  expect(await response.json()).toMatchObject({ entry: { type: 'basic' } });
});

test('owner label search returns only labels, no-store and bounded rate headers', async () => {
  principal.type_user = 'admin';
  const response = await fetch(`${base}/mypage/api/life/labels?q=synthetic`);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ labels: ['Synthetic label'] });
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('ratelimit')).toBeTruthy();
  expect(lifeLogLabels).toHaveBeenCalledWith(expect.objectContaining({ isOwner: true }), { q: 'synthetic' });
  expect(data.read).not.toHaveBeenCalled(); expect(data.load).not.toHaveBeenCalled();
});
test.each(['?q=x&q=y', '?q=' + 'x'.repeat(161), '?owner=foreign', '?limit=100', '?q[$ne]=', '?q=%00'])('label query %s fails before search', async query => {
  principal.type_user = 'admin';
  expect((await fetch(`${base}/mypage/api/life/labels${query}`)).status).toBe(400);
  expect(lifeLogLabels).not.toHaveBeenCalled();
});
test.each(['foreign-admin', 'user', 'anonymous', 'owner-unset'])('label search denies %s before search', async scenario => {
  principal.type_user = 'admin';
  if (scenario === 'foreign-admin') principal._id = '222222222222222222222222';
  if (scenario === 'user') principal.type_user = 'user';
  if (scenario === 'anonymous') authenticated = false;
  if (scenario === 'owner-unset') delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID;
  expect((await fetch(`${base}/mypage/api/life/labels`)).status).toBe(scenario === 'anonymous' ? 401 : 403);
  expect(lifeLogLabels).not.toHaveBeenCalled();
});
test('label failure is generic and logged without query or exception data', async () => {
  principal.type_user = 'admin';
  lifeLogLabels.mockRejectedValue(new Error('Private synthetic diagnostic'));
  const response = await fetch(`${base}/mypage/api/life/labels?q=private`);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('diagnostic');
  expect(require('../../utils/logger').warning).toHaveBeenCalledWith('Dashboard life log label search failed', { category: 'account_dashboard' });
});
test('label search rate limit bounds queries independently of dashboard request limit', async () => {
  principal.type_user = 'admin';
  for (let i = 0; i < 60; i++) expect((await fetch(`${base}/mypage/api/life/labels`)).status).toBe(200);
  expect((await fetch(`${base}/mypage/api/life/labels`)).status).toBe(429);
  expect(lifeLogLabels).toHaveBeenCalledTimes(60);
});
