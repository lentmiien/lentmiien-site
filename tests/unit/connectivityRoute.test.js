jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createConnectivityRouter, CAPABILITY } = require('../../routes/connectivity');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');

let server;
let base;
let principal;
let authenticated;
let store;
let roleModel;
let routeConfig;
beforeEach(async () => {
  principal = { name: 'admin', type_user: 'admin' };
  authenticated = true;
  store = { history: jest.fn(async () => []) };
  roleModel = { findOne: jest.fn(async () => null) };
  routeConfig = getConnectivityConfig({});
  const app = express();
  app.use((req, res, next) => {
    req.user = principal;
    req.isAuthenticated = () => authenticated;
    res.render = (_view, locals) => res.json({ message: locals.message });
    next();
  });
  app.use('/admin/connectivity', createConnectivityRouter({ store, roleModel,
    configReader: () => routeConfig }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/admin/connectivity`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

test.each(['anonymous', 'family', 'user', 'incomplete'])('denies %s without querying history', async (type) => {
  if (type === 'anonymous') { authenticated = false; principal = null; }
  else principal = { name: type === 'incomplete' ? '' : 'test', type_user: type };
  const response = await fetch(base);
  expect(response.status).toBe(type === 'anonymous' ? 401 : 403);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(store.history).not.toHaveBeenCalled();
});

test.each(['admin', 'grant'])('allows %s to read bounded history with no mutation', async (mode) => {
  if (mode === 'grant') {
    principal = { name: 'reader', type_user: 'user' };
    roleModel.findOne.mockResolvedValue({ permissions: [CAPABILITY] });
  }
  store.history.mockResolvedValue([{ sampledAt: new Date(), signature: getConnectivityConfig({}).signature,
    probes: ['internet', 'cloudflare'].map((name) => ({ name, outcome: 'ok', degraded: false })) }]);
  const response = await fetch(base);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toMatchObject({ status: 'ok', publicAppConfigured: false, limit: 360 });
  expect(store.history).toHaveBeenCalledWith(expect.any(Date), 360, expect.any(Date));
  expect((await fetch(base, { method: 'POST' })).status).toBe(404);
  expect(store.history).toHaveBeenCalledTimes(1);
});

test.each(['?url=https://127.0.0.1', '?limit=1000000', '?before[]=x', '?before=bad', '?before=2026-99-99T00:00:00.000Z'])('rejects query %s before database access', async (query) => {
  expect((await fetch(base + query)).status).toBe(400);
  expect(store.history).not.toHaveBeenCalled();
});

test('history pagination uses fixed bounds; stale data stays unknown', async () => {
  const sampledAt = new Date('2026-01-01T00:00:00.000Z');
  store.history.mockResolvedValue(Array.from({ length: 360 }, () => ({ sampledAt, probes: [] })));
  const response = await fetch(base + '?before=2026-09-05T00:00:00.000Z');
  expect(await response.json()).toMatchObject({ status: 'unknown', nextBefore: sampledAt.toISOString() });
  expect(store.history.mock.calls[0][2]).toEqual(new Date('2026-09-05T00:00:00Z'));
});

test('changed probe configuration cannot claim health from earlier samples', async () => {
  store.history.mockResolvedValue([{ sampledAt: new Date(), signature: 'previous-config', probes: [] }]);
  const body = await (await fetch(base)).json();
  expect(body.status).toBe('unknown');
  expect(body.samples[0]).not.toHaveProperty('signature');
});

test('database and capability lookup failures fail closed without leaking diagnostics', async () => {
  store.history.mockRejectedValue(new Error('mongodb://secret'));
  let response = await fetch(base);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('mongodb');
  principal = { name: 'reader', type_user: 'user' };
  roleModel.findOne.mockRejectedValue(new Error('secret'));
  response = await fetch(base);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret');
});

test.each(['/api', '/analytics?hours=1', '/analytics?hours=6', '/analytics?hours=24', '/analytics?hours=72'])('explicit route %s is bounded and private', async (path) => {
  const response = await fetch(base + path);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  const [since, limit, until] = store.history.mock.calls[0];
  expect(limit).toBe(path === '/api' ? 360 : 5001);
  if (path !== '/api') expect(+until - since).toBe(Number(path.split('=')[1]) * 3600000);
  expect(JSON.stringify(await response.json())).not.toContain('signature');
});

test.each(['/analytics?hours=1000000', '/analytics?hours[]=1', '/analytics?hours=1&hours=6', '/analytics?url=https://private',
  '/analytics?hours=-1', '/analytics?hours=1.0', '/api?limit=5000'])('rejects invalid analytics/API bounds %s before querying', async (path) => {
  expect((await fetch(base + path)).status).toBe(400);
  expect(store.history).not.toHaveBeenCalled();
});

test.each(['/api', '/analytics?hours=24', '/'])('all representations require the semantic capability: %s', async (path) => {
  principal = { name: 'reader', type_user: 'family' };
  expect((await fetch(base + path, { headers: { Accept: 'text/html' } })).status).toBe(403);
  expect(store.history).not.toHaveBeenCalled();
  principal = null; authenticated = false;
  expect((await fetch(base + path)).status).toBe(401);
});

test('browser navigation renders UI without DB work, while explicit JSON and pagination remain JSON', async () => {
  const browser = await fetch(base, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  expect(browser.status).toBe(200);
  expect(store.history).not.toHaveBeenCalled();
  expect((await fetch(base, { headers: { Accept: 'application/json' } })).status).toBe(200);
  expect(store.history).toHaveBeenCalledTimes(1);
  expect((await fetch(base + '/api?before=2026-09-05T00:00:00.000Z', { headers: { Accept: 'text/html' } })).status).toBe(200);
  expect(store.history).toHaveBeenCalledTimes(2);
});

test('analytics signals truncation and generic database failure', async () => {
  store.history.mockResolvedValue(Array.from({ length: 5001 }, () => ({ sampledAt: new Date(Date.now() - 1000), probes: [] })));
  const response = await fetch(base + '/analytics?hours=72');
  expect(await response.json()).toMatchObject({ truncated: true, sampleCount: 5000 });
  store.history.mockRejectedValue(new Error('mongodb://secret'));
  const failure = await fetch(base + '/analytics');
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain('secret');
});


test('dashboard Pug renders themed, accessible shell without analytics or embedded operational data', () => {
  const html = require('pug').renderFile(require('path').join(__dirname, '../../views/connectivity_dashboard.pug'), {
    gtag: false, loggedIn: true, admin: true, permissions: [],
  });
  expect(html).toContain('/css/color-theme.css');
  expect(html).toContain('/css/connectivityDashboard.css');
  expect(html).toContain('/js/connectivityDashboard.js');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('Connectivity analytics');
  expect(html).not.toContain('googletagmanager');
});


test('analytics respects shorter retention without shrinking the requested coverage window', async () => {
  routeConfig = getConnectivityConfig({ CONNECTIVITY_RETENTION_DAYS: '1' });
  const response = await fetch(base + '/analytics?hours=72');
  const [since, , until] = store.history.mock.calls[0];
  expect(+until - since).toBe(86400000);
  const body = await response.json();
  expect(new Date(body.until) - new Date(body.since)).toBe(72 * 3600000);
  expect(body.coverage.percent).toBe(0);
  expect(body.retentionDays).toBe(1);
});

test('invalid calendar dates cannot silently normalize the pagination cursor', async () => {
  expect((await fetch(base + '/api?before=2026-02-30T00:00:00.000Z')).status).toBe(400);
  expect(store.history).not.toHaveBeenCalled();
});
