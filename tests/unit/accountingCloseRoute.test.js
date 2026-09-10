jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createAccountingClose } = require('../../routes/accountingClose');
const body = require('../../middleware/accountSurfaceBody');
const owner = '111111111111111111111111';
const token = 'a'.repeat(43); const reviewToken = 'b'.repeat(64);
let principal; let authenticated; let grants; let service; let server; let base;
beforeEach(async () => {
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = owner;
  principal = { _id: owner, name: 'synthetic', type_user: 'admin' }; authenticated = true; grants = ['accounting'];
  service = { preview: jest.fn(async () => ({ dates: { todayLabel: '2026-09-10', closeDate: 20260831 }, accounts: [
    { id: owner, name: '<script>inert</script>', currency: 'USD', baseline: '100', baselineDate: 20220101,
      current: '110', closing: '90', currentMonth: '20', token: reviewToken },
  ] })), close: jest.fn(async () => {}) };
  const app = express(); app.set('views', 'views'); app.set('view engine', 'pug'); app.locals.formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
  app.use(body);
  app.use((req, res, next) => { req.user = principal; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; res.locals.loggedIn = authenticated; res.locals.bookmarks = []; res.locals.htmlPaths = []; next(); });
  app.use(['/accounting/close-month', '/budget/close-month'], createAccountingClose({ service, roleModel: { findOne: async q => q.type === 'user' ? { permissions: grants } : null } }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/accounting/close-month/`;
});
afterEach(async () => { delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; await new Promise(resolve => server.close(resolve)); });
const valid = () => ({ _csrf: token, accountId: owner, token: reviewToken, transactionsComplete: 'yes', balancesMatch: 'yes' });
const post = (data = valid(), headers = {}) => fetch(base, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }, body: new URLSearchParams(data) });
test('safe review is read-only, escaped, uncached and both boxes are unchecked', async () => {
  const response = await fetch(base); const html = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(html).toContain('&lt;script&gt;inert&lt;/script&gt;'); expect(html).not.toContain('googletagmanager');
  expect(html).toContain('name="transactionsComplete"'); expect(html).toContain('name="balancesMatch"');
  expect(html).not.toMatch(/checked(?:=|>)/); expect(html).toContain('action="/accounting/close-month/"');
  expect(service.close).not.toHaveBeenCalled();
});
test.each(['anonymous', 'foreign-admin', 'missing-owner', 'missing-capability', 'family', 'user', 'incomplete'])('denies %s before all ledger reads/writes', async state => {
  if (state === 'anonymous') authenticated = false;
  if (state === 'foreign-admin') principal._id = '222222222222222222222222';
  if (state === 'missing-owner') delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID;
  if (state === 'missing-capability') grants = [];
  if (['family', 'user'].includes(state)) principal.type_user = state;
  if (state === 'incomplete') delete principal.name;
  expect([401, 403]).toContain((await fetch(base)).status);
  expect([401, 403]).toContain((await post()).status);
  expect(service.preview).not.toHaveBeenCalled(); expect(service.close).not.toHaveBeenCalled();
});
test('explicit capability grant permits configured owner without granting another principal', async () => {
  principal.type_user = 'user'; grants.push('finance.account.close');
  expect((await post()).status).toBe(303);
  expect(service.close.mock.calls[0][0]).toBe(owner);
  principal._id = '222222222222222222222222';
  expect((await post()).status).toBe(403);
  expect(service.close).toHaveBeenCalledTimes(1);
});
test.each([{ _csrf: '' }, { _csrf: 'x'.repeat(43) }])('CSRF rejection %#', async override => {
  expect((await post({ ...valid(), ...override })).status).toBe(403); expect(service.close).not.toHaveBeenCalled();
});
test('foreign Origin fails even with valid token', async () => {
  expect((await post(valid(), { Origin: 'https://foreign.invalid' })).status).toBe(403); expect(service.close).not.toHaveBeenCalled();
});
test.each([{ transactionsComplete: '' }, { balancesMatch: '' }, { balancesMatch: 'true' }, { accountId: 'bad' },
  { token: 'bad' }, { balance: '100' }, { owner: 'foreign' }])('invalid confirmation/body fails %#', async override => {
  expect([400, 413]).toContain((await post({ ...valid(), ...override })).status); expect(service.close).not.toHaveBeenCalled();
});
test('oversized body and query parameters fail', async () => {
  expect((await post({ ...valid(), token: 'a'.repeat(5000) })).status).toBe(413);
  expect((await fetch(`${base}?confirm=yes`)).status).toBe(400);
  expect(service.close).not.toHaveBeenCalled(); expect(service.preview).not.toHaveBeenCalled();
});
test('successful explicit confirmation uses validated principal and POST/redirect/GET', async () => {
  const response = await post(); expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/accounting/close-month/');
  expect(service.close).toHaveBeenCalledWith(owner, valid());
});
test('stale submission offers refresh, unexpected error hides private content and logs safely', async () => {
  service.close.mockRejectedValueOnce(Object.assign(new Error('Refresh the review.'), { status: 409 }));
  let response = await post(); expect(response.status).toBe(409); expect(await response.text()).toContain('Refresh the review');
  service.close.mockRejectedValueOnce(new Error('private transaction content'));
  response = await post(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private transaction content');
  expect(JSON.stringify(require('../../utils/logger').error.mock.calls)).not.toContain('private transaction content');
});

test('budget-only owner keeps the budget route alias for review, submit and ledger links', async () => {
  grants = ['budget'];
  const response = await fetch(base.replace('/accounting/', '/budget/'));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('action="/budget/close-month/"');
  expect(html).toContain('href="/budget"');
});
