jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const session = require('express-session');
const { Passport } = require('passport');
const { Strategy } = require('passport-local');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { createUserSettingsRouter } = require('../../routes/userSettings');
const { createPasswordRemindersRouter } = require('../../routes/passwordReminders');
const { createSessionCsrf } = require('../../middleware/sessionCsrf');
const logger = require('../../utils/logger');

let server; let base; let records; let userModel; let cookie;
let initialHash;
const oldPassword = 'Old fixture password1!';
const newPassword = 'New fixture password2!';
beforeAll(async () => { initialHash = await bcrypt.hash(oldPassword, 4); });
beforeEach(async () => {
  cookie = '';
  records = ['admin', 'user', 'family', 'other'].map((role, index) => ({
    _id: String(index + 1).repeat(24), name: role, type_user: role, email: role + '@example.invalid',
    hash_password: initialHash, password_changed_at: new Date(), password_change_requested: false,
  }));
  userModel = {
    updateMany: jest.fn(async (_filter, update) => { records.forEach(record => Object.assign(record, update.$set)); return { matchedCount: records.length }; }),
    updateOne: jest.fn(async (filter, update) => {
      const record = records.find(r => r._id === filter._id && r.hash_password === filter.hash_password);
      if (!record) return { matchedCount: 0 };
      Object.assign(record, update.$set); return { matchedCount: 1 };
    }),
  };
  const roleModel = { findOne: async () => null };
  const app = express(); app.set('views', 'views'); app.set('view engine', 'pug');
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const isAmiAmiUploadPath ='), source.indexOf('// Public hidden request counter endpoint')), {
    app, bodyParser: require('body-parser'), express, DEFAULT_BODY_LIMIT: '5mb',
  });
  app.use(session({ secret: 'synthetic-test-session-secret', resave: false, saveUninitialized: false }));
  const passport = new Passport();
  passport.use(new Strategy(async (username, password, done) => {
    const user = records.find(record => record.name === username);
    done(null, user && await bcrypt.compare(password, user.hash_password) ? { ...user } : false);
  }));
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser((id, done) => done(null, { ...records.find(record => record._id === id) }));
  app.use(passport.initialize()); app.use(passport.session());
  app.use((req, res, next) => {
    Object.assign(res.locals, { loggedIn: req.isAuthenticated(), permissions: [], htmlPaths: [], bookmarks: [] }); next();
  });
  // Use the production login route registration to test Passport's successful
  // login continuation, failed login and session regeneration together.
  const loginStart = source.indexOf("app.post(\n  '/login',");
  vm.runInNewContext(source.slice(loginStart, source.indexOf('// Helper: constant-time', loginStart)), {
    app, passport, loginLimiter: (_req, _res, next) => next(), require: createRequire(path.resolve('app.js')),
  });
  app.use('/settings', createUserSettingsRouter({ userModel, roleModel }));
  app.use('/admin/password-reminders', createPasswordRemindersRouter({ userModel, roleModel }));
  app.get('/admin', createSessionCsrf().issueToken, (req, res) => res.render('manage_users', {
    users: records, feedback: null, refreshCooldownHours: 6, refreshState: null,
  }));
  app.get('/mypage', (_req, res) => res.send('My Account'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });
async function request(url, options = {}) {
  const response = await fetch(base + url, { ...options, redirect: 'manual', headers: { Cookie: cookie, ...options.headers } });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return response;
}
const login = (username = 'user', password = oldPassword) => request('/login', { method: 'POST', body: new URLSearchParams({ username, password }) });
async function csrf(url = '/settings') {
  const html = await (await request(url)).text();
  return html.match(/name="_csrf" value="([^"]+)"/)[1];
}
const remind = (token, body = { confirm: 'all-users' }, headers = {}) => request('/admin/password-reminders', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers }, body: JSON.stringify(body),
});

test('login repeats optional reminders until a personal password change, then starts a fresh timer', async () => {
  records[1].password_changed_at = new Date('2020-01-01');
  expect((await login()).headers.get('location')).toBe('/settings');
  expect(await (await request('/settings')).text()).toContain('more than six months');
  expect((await request('/mypage')).status).toBe(200);
  expect((await login()).headers.get('location')).toBe('/settings');
  const token = await csrf();
  const response = await request('/settings/password', {
    method: 'POST', body: new URLSearchParams({ _csrf: token, currentPassword: oldPassword, newPassword, confirmPassword: newPassword }),
  });
  expect(response.status).toBe(303);
  expect(records[1].password_changed_at.getTime()).toBeGreaterThan(Date.now() - 5000);
  expect((await login('user', newPassword)).headers.get('location')).toBe('/mypage');
  expect((await login('user', oldPassword)).headers.get('location')).toBe('/login');
});

test('unknown last-change date prompts; recent password logs in normally', async () => {
  expect((await login()).headers.get('location')).toBe('/mypage');
  delete records[1].password_changed_at;
  expect((await login()).headers.get('location')).toBe('/settings');
  expect(await (await request('/settings')).text()).toContain('do not have a record');
});

test('admin bulk request preserves dates and hashes and prompts every role on every login', async () => {
  await login('admin');
  const html = await (await request('/admin')).text();
  expect(html).toContain('Request password updates for all users');
  expect(html).toContain('name="confirm" value="all-users" required');
  const dates = records.map(r => r.password_changed_at.toISOString());
  const response = await remind(await csrf('/admin'));
  expect(response.status).toBe(303);
  expect(userModel.updateMany).toHaveBeenCalledWith({}, { $set: { password_change_requested: true } }, { runValidators: true });
  expect(records.map(r => r.password_changed_at.toISOString())).toEqual(dates);
  expect(records.every(r => r.hash_password === initialHash)).toBe(true);
  for (const record of records) {
    expect((await login(record.name)).headers.get('location')).toBe('/settings');
    const settings = await request('/settings');
    expect(settings.status).toBe(200);
    expect(await settings.text()).toContain('An administrator has asked everyone');
    expect((await request('/mypage')).status).toBe(200);
    expect((await login(record.name)).headers.get('location')).toBe('/settings');
  }
  await login('user');
  const changed = await request('/settings/password', {
    method: 'POST', body: new URLSearchParams({ _csrf: await csrf(), currentPassword: oldPassword, newPassword, confirmPassword: newPassword }),
  });
  expect(changed.status).toBe(303);
  expect((await login('user', newPassword)).headers.get('location')).toBe('/mypage');
  expect(records.filter(record => record.name !== 'user').every(record => record.password_change_requested)).toBe(true);
});

test('anonymous and non-admin roles cannot request bulk reminders', async () => {
  expect((await remind('invalid')).status).toBe(401);
  for (const role of ['user', 'family', 'other']) {
    await login(role);
    expect((await remind(await csrf())).status).toBe(403);
  }
  expect(userModel.updateMany).not.toHaveBeenCalled();
});

test.each([
  ['', { confirm: 'all-users' }, {}, 403],
  ['wrong-token', { confirm: 'all-users' }, {}, 403],
  [null, { confirm: 'all-users' }, { Origin: 'https://foreign.invalid' }, 403],
  [null, {}, {}, 400],
  [null, { confirm: 'all-users', userId: 'foreign' }, {}, 400],
  [null, { confirm: 'all-users', padding: 'x'.repeat(1024) }, {}, 413],
])('bulk action rejects CSRF and invalid input %#', async (token, body, headers, status) => {
  await login('admin');
  const validToken = await csrf('/admin');
  expect((await remind(token === null ? validToken : token, body, headers)).status).toBe(status);
  expect(userModel.updateMany).not.toHaveBeenCalled();
});

test('bulk action is POST only, bounded and reports private generic failures', async () => {
  await login('admin');
  expect((await request('/admin/password-reminders')).status).toBe(404);
  userModel.updateMany.mockRejectedValue(new Error('secret database details'));
  const token = await csrf('/admin');
  const failed = await remind(token);
  expect(failed.status).toBe(503);
  expect(failed.headers.get('cache-control')).toContain('private, no-store');
  expect(await failed.text()).not.toContain('secret database details');
  expect(logger.error).toHaveBeenCalledWith('Unable to request password updates for all users', expect.objectContaining({ category: 'account_settings' }));
  await remind(token); await remind(token);
  expect((await remind(token)).status).toBe(429);
  expect(userModel.updateMany).toHaveBeenCalledTimes(3);
});
