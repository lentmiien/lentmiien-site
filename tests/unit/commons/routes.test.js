jest.mock('../../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const session = require('express-session');
const { createCommonsRouter } = require('../../../routes/commons');
const { PLAY, OPERATIONS } = require('../../../utils/commonsAuthorizationPolicy');
let server, base, user, grants, authenticated;
beforeEach(async () => {
  user = { _id: '111111111111111111111111', name: 'synthetic', type_user: 'user' }; grants = [PLAY]; authenticated = true;
  const app = express(); app.set('views', require('path').resolve('views')); app.set('view engine', 'pug');
  app.use(session({ secret: 'synthetic-test-secret-only', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => authenticated; res.locals.gtag = true; next(); });
  app.use('/commons', createCommonsRouter({ userModel: { findOne: async () => user }, roleModel: { findOne: async () => ({ permissions: grants }) }, configReader: () => ({ enabled: true, maxOnline: 10, checkpointMs: 5000 }) }));
  app.use(require('../../../middleware/errorHandler')(require('../../../utils/logger')));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/commons`;
});
afterEach(() => new Promise(resolve => server.close(resolve)));
test('page is private, escaped, analytics-free and issues shared CSRF token without joining', async () => {
  const response = await fetch(base); const html = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(html).toContain('name="csrf-token"'); expect(html).not.toContain('googletagmanager');
  expect(response.headers.get('set-cookie')).toContain('connect.sid');
});
test('anonymous and missing-grant pages deny access and analytics', async () => {
  authenticated = false; let response = await fetch(base); expect(response.status).toBe(401);
  const html = await response.text();
  expect(html).toContain('Sign in to your account first.');
  expect(html).not.toContain('googletagmanager');
  expect(html).not.toContain('User:');
  expect(require('../../../utils/logger').error).not.toHaveBeenCalled();
  authenticated = true; grants = []; response = await fetch(base); expect(response.status).toBe(403);
});
test('diagnostics require semantic operations plus admin identity and never list residents', async () => {
  grants = [PLAY, OPERATIONS]; expect((await fetch(base + '/diagnostics')).status).toBe(403);
  user.type_user = 'admin'; const response = await fetch(base + '/diagnostics'); expect(response.status).toBe(200);
  const data = await response.json(); expect(data).toHaveProperty('schemaVersion', 1); expect(data).not.toHaveProperty('players');
});
test('unknown POST operations cannot mutate state', async () => expect((await fetch(base + '/action', { method: 'POST' })).status).toBe(404));
