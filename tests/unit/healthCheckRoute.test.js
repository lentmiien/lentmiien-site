jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createHealthCheckRouter } = require('../../routes/healthCheck');
const { isOwner } = require('../../utils/healthCheckPolicy');
const { resolvePolicy, navigationFor, bookmarkAllowed } = require('../../services/accountSurfacePolicy');
const owner = '111111111111111111111111'; const token = 'a'.repeat(43);
let server; let base; let user; let authenticated; let service; let grants;
beforeEach(async () => {
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = owner; authenticated = true; grants = [];
  user = { _id: owner, name: 'synthetic@example.invalid', type_user: 'user' };
  service = { read: jest.fn(async () => ({ revision: 0, exams: [] })), review: jest.fn(async () => ({ conflicts: [] })), commit: jest.fn(async () => ({ saved: true })) };
  const app = express(); app.set('views', 'views'); app.set('view engine', 'pug');
  app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; res.locals.loggedIn = authenticated; res.locals.bookmarks = []; res.locals.htmlPaths = []; next(); });
  app.use('/health-check', createHealthCheckRouter({ service, roleModel: { findOne: async () => ({ permissions: grants }) } }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/health-check`;
});
afterEach(async () => { delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; await new Promise(resolve => server.close(resolve)); });
const post = (action = 'preview', body = {}, headers = {}) => fetch(`${base}/api/import/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token, ...headers }, body: JSON.stringify(body) });
test.each(['/', '/upload', '/api/history'])('owner page or API %s is private with no analytics', async path => {
  const response = await fetch(base + path); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store'); expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await response.text()).not.toContain('googletagmanager');
});
test.each(['admin', 'family', 'user'])('configured owner with role %s can access', async role => { user.type_user = role; expect((await fetch(`${base}/api/history`)).status).toBe(200); });
test.each(['/', '/upload', '/api/history', '/api/import/preview', '/api/import/commit'])('non-owner admin denied at %s before all data access', async path => {
  user._id = '222222222222222222222222'; user.type_user = 'admin';
  const response = path.includes('/import/') ? await post(path.split('/').at(-1)) : await fetch(base + path);
  expect(response.status).toBe(403); expect(service.read).not.toHaveBeenCalled(); expect(service.review).not.toHaveBeenCalled(); expect(service.commit).not.toHaveBeenCalled();
});
test('anonymous, missing capability and incomplete principal fail closed', async () => {
  authenticated = false; expect((await fetch(`${base}/api/history`)).status).toBe(401);
  authenticated = true; user.type_user = 'unknown'; expect((await fetch(`${base}/api/history`)).status).toBe(403);
  grants = ['health.check.read']; expect((await fetch(`${base}/api/history`)).status).toBe(200); expect((await post()).status).toBe(403);
  delete user.name; expect((await fetch(`${base}/api/history`)).status).toBe(403);
});
test.each([undefined, '', 'bad'])('missing/invalid configured owner denies %s', async value => { if (value === undefined) delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; else process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = value; expect((await fetch(`${base}/api/history`)).status).toBe(403); expect(service.read).not.toHaveBeenCalled(); });
test.each([{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'b'.repeat(43) }, { Origin: 'https://foreign.invalid' }])('CSRF and Origin denial %#', async headers => { expect((await post('commit', {}, headers)).status).toBe(403); expect(service.commit).not.toHaveBeenCalled(); });
test('save and preview use only validated principal ID', async () => {
  expect((await post('commit')).status).toBe(200); expect(service.commit).toHaveBeenCalledWith(owner, {});
  expect((await post('mapping')).status).toBe(200); expect(service.review).toHaveBeenCalledWith(owner, {}, true);
  expect((await fetch(`${base}/api/history?ownerId=foreign`)).status).toBe(400);
});
test('malformed and oversized bodies are bounded and generic', async () => {
  const response = await fetch(`${base}/api/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{invalid' });
  expect(response.status).toBe(400); expect(await response.text()).toContain('Invalid JSON');
  expect((await post('preview', { large: 'x'.repeat(3 * 1024 * 1024) })).status).toBe(413); expect(service.review).not.toHaveBeenCalled();
});
test('database error is generic and logs no health data', async () => {
  service.read.mockRejectedValue(new Error('PRIVATE HEALTH CONTENT'));
  const response = await fetch(`${base}/api/history`); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE HEALTH');
  expect(require('../../utils/logger').error).toHaveBeenCalledWith(expect.stringContaining('Health-check operation failed'), { category: 'health_check', metadata: { operation: '/api/history' } });
});
test('navigation links and bookmarks are restricted to owner', async () => {
  const roles = { findOne: async () => null }; let policy = await resolvePolicy(user, roles);
  expect(navigationFor(policy).filter(item => item.href.startsWith('/health-check'))).toHaveLength(2); expect(bookmarkAllowed(policy, '/health-check')).toBe(true);
  user._id = '222222222222222222222222'; user.type_user = 'admin'; policy = await resolvePolicy(user, roles);
  expect(navigationFor(policy).filter(item => item.href.startsWith('/health-check'))).toHaveLength(0); expect(bookmarkAllowed(policy, '/health-check/upload')).toBe(false);
  expect(isOwner(user)).toBe(false);
});
