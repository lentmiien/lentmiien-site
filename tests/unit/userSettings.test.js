jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const vm = require('vm');
const { createUserSettingsRouter } = require('../../routes/userSettings');
const logger = require('../../utils/logger');

const owner = '111111111111111111111111';
const token = 'a'.repeat(43);
const currentPassword = 'Existing password!';
const newPassword = 'A different password!';
let initialHash;
let server; let base; let principal; let authenticated; let userModel; let grants; let roleModel; let session;
beforeAll(async () => { initialHash = await bcrypt.hash(currentPassword, 4); });
beforeEach(async () => {
  principal = { _id: owner, name: 'settings-owner', email: 'old@example.invalid', type_user: 'user', hash_password: initialHash };
  authenticated = true;
  grants = [];
  session = { csrfToken: token };
  userModel = { updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
  roleModel = { findOne: jest.fn(async q => q.type === 'user' ? { permissions: grants } : null) };
  const app = express();
  app.set('views', 'views');
  app.set('view engine', 'pug');
  app.locals.formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
  // Exercise the actual production legacy parser selection, without starting
  // the database, background workers, or environment-dependent application.
  const source = fs.readFileSync('app.js', 'utf8');
  const parserSetup = source.slice(source.indexOf('const isAmiAmiUploadPath ='), source.indexOf('// Public hidden request counter endpoint'));
  vm.runInNewContext(parserSetup, { app, bodyParser: require('body-parser'), express, DEFAULT_BODY_LIMIT: '5mb' });
  app.use((req, res, next) => {
    req.user = principal;
    req.isAuthenticated = () => authenticated;
    req.session = session;
    Object.assign(res.locals, { loggedIn: authenticated, gtag: true, bookmarks: [], htmlPaths: [], permissions: [] });
    next();
  });
  app.use('/settings', createUserSettingsRouter({ userModel, roleModel }));
  // Mimic the larger legacy parsers to ensure settings has already handled its body.
  app.use(express.json({ limit: '5mb' }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });
const get = (path = '') => fetch(`${base}/settings${path}`, { redirect: 'manual' });
const post = (path, body, headers = {}) => fetch(`${base}/settings${path}`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers },
  body: JSON.stringify(body),
});
const emailBody = () => ({ email: 'new@example.invalid', currentPassword });
const passwordBody = () => ({ currentPassword, newPassword, confirmPassword: newPassword });

test.each(['admin', 'family', 'user'])('%s can read only their own account details without writes or secrets', async role => {
  principal.type_user = role;
  const response = await get();
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(html).toContain(principal.name);
  expect(html).toContain(principal.email);
  expect(html).toContain(`>${role}</dd>`);
  expect(html).toContain('name="_csrf"');
  expect(html).toContain('action="/settings/email"');
  expect(html).toContain('action="/settings/password"');
  expect(html).not.toMatch(/googletagmanager|hash_password|name="type_user"|name="name"/);
  expect(html).not.toContain(initialHash);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('anonymous, incomplete and ungranted principals fail closed', async () => {
  authenticated = false;
  expect((await get()).status).toBe(401);
  expect((await post('/email', emailBody())).status).toBe(401);
  authenticated = true;
  principal._id = undefined;
  expect((await get()).status).toBe(401);
  principal._id = owner;
  principal.type_user = 'unknown';
  expect((await get()).status).toBe(403);
  expect((await post('/password', passwordBody())).status).toBe(403);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('explicit grants allow custom roles and separate read, email and password access', async () => {
  principal.type_user = 'custom';
  grants = ['account.profile.read'];
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('<form method="post" action="/settings/');
  expect((await post('/email', emailBody())).status).toBe(403);
  expect((await post('/password', passwordBody())).status).toBe(403);
  grants.push('account.email.write');
  expect((await post('/email', emailBody())).status).toBe(303);
  expect((await post('/password', passwordBody())).status).toBe(403);
  grants = [];
  expect((await get()).status).toBe(403);
});

test('authorization failures have generic responses and actionable logs', async () => {
  principal.type_user = 'custom';
  roleModel.findOne.mockRejectedValue(new Error('private database details'));
  const response = await get();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database details');
  expect(logger.error).toHaveBeenCalled();
});

test.each([
  { 'X-CSRF-Token': '' },
  { 'X-CSRF-Token': 'b'.repeat(43) },
  { Origin: 'https://foreign.invalid' },
])('both mutations reject invalid CSRF/origin %#', async headers => {
  expect((await post('/email', emailBody(), headers)).status).toBe(403);
  expect((await post('/password', passwordBody(), headers)).status).toBe(403);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('missing session token cannot be manufactured by a mutation', async () => {
  session = {};
  expect((await post('/password', passwordBody())).status).toBe(403);
  expect(session.csrfToken).toBeUndefined();
  const response = await get();
  expect(response.status).toBe(200);
  expect(session.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test.each(['name', 'type_user', 'userId', '_id', 'hash_password', 'owner', 'permissions'])('rejects client-supplied %s on both forms, including for admins', async field => {
  principal.type_user = 'admin';
  expect((await post('/email', { ...emailBody(), [field]: 'foreign' })).status).toBe(400);
  expect((await post('/password', { ...passwordBody(), [field]: 'foreign' })).status).toBe(400);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('query parameters cannot select an account, even for an admin; GET cannot mutate', async () => {
  principal.type_user = 'admin';
  expect((await get('?userId=222222222222222222222222')).status).toBe(400);
  expect((await post('/email?userId=222222222222222222222222', emailBody())).status).toBe(400);
  expect((await get('/email')).status).toBe(404);
  expect((await get('/password')).status).toBe(404);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test.each([
  {}, { email: null }, { email: ['a@example.invalid'] }, { email: { $ne: null } },
  { email: 'not-an-email' }, { email: 'a'.repeat(201) + '@example.invalid' },
  { currentPassword: null }, { currentPassword: ['password'] }, { currentPassword: '' },
  { currentPassword: 'a'.repeat(1025) },
])('malformed email changes are rejected %#', async replacement => {
  const body = Object.keys(replacement).length ? { ...emailBody(), ...replacement } : {};
  expect((await post('/email', body)).status).toBe(400);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test.each([
  {}, { newPassword: 'short', confirmPassword: 'short' },
  { confirmPassword: 'does not match' }, { newPassword: null },
  { newPassword: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) },
  { newPassword: '日'.repeat(25), confirmPassword: '日'.repeat(25) },
  { currentPassword: {} },
])('malformed passwords, mismatch and bcrypt truncation are rejected %#', async replacement => {
  const body = Object.keys(replacement).length ? { ...passwordBody(), ...replacement } : {};
  expect((await post('/password', body)).status).toBe(400);
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('wrong current passwords cannot update either field and are never echoed', async () => {
  for (const [path, body] of [['/email', emailBody()], ['/password', passwordBody()]]) {
    const response = await post(path, { ...body, currentPassword: 'private-wrong-password' });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Your current password is incorrect.');
    expect(html).not.toContain('private-wrong-password');
    expect(html).not.toContain(newPassword);
    expect(html).not.toContain(initialHash);
  }
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('same password is rejected', async () => {
  const response = await post('/password', { currentPassword, newPassword: currentPassword, confirmPassword: currentPassword });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain('different from your current password');
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('email is trimmed and saved only to the validated owner; success uses POST/redirect/GET', async () => {
  const response = await post('/email', { ...emailBody(), email: '  new@example.invalid  ' }, { Origin: base });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/settings?updated=email');
  expect(userModel.updateOne).toHaveBeenCalledWith({ _id: owner, hash_password: initialHash },
    { $set: { email: 'new@example.invalid' } }, { runValidators: true });
  const html = await (await get('?updated=email')).text();
  expect(html).toContain('Your email address has been updated.');
  expect(html).toContain('new@example.invalid');
  expect(principal.name).toBe('settings-owner');
  expect(principal.type_user).toBe('user');
});

test.each([newPassword, '日'.repeat(24)])('password change persists a working bcrypt hash, including the 72-byte boundary %#', async password => {
  const response = await post('/password', { currentPassword, newPassword: password, confirmPassword: password });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/settings?updated=password');
  const [filter, update] = userModel.updateOne.mock.calls[0];
  expect(filter).toEqual({ _id: owner, hash_password: initialHash });
  expect(Object.keys(update.$set)).toEqual(['hash_password']);
  expect(update.$set.hash_password).toMatch(/^\$2[aby]\$12\$/);
  expect(await bcrypt.compare(password, update.$set.hash_password)).toBe(true);
  expect(await bcrypt.compare(currentPassword, update.$set.hash_password)).toBe(false);
  const html = await (await get('?updated=password')).text();
  expect(html).toContain('Your password has been changed.');
  expect(html).not.toContain(password);
  expect(JSON.stringify(session)).not.toContain(password);
});

test('normal browser URL-encoded forms work with a hidden CSRF token', async () => {
  const response = await fetch(`${base}/settings/email`, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ ...emailBody(), _csrf: token }),
  });
  expect(response.status).toBe(303);
});

test('oversized, excessive-field and malformed bodies are rejected safely before any mutation', async () => {
  expect((await post('/email', { ...emailBody(), padding: 'x'.repeat(9000) })).status).toBe(413);
  const excessive = await fetch(`${base}/settings/email`, {
    method: 'POST', body: new URLSearchParams({ ...emailBody(), _csrf: token, a: '1', b: '2' }),
  });
  expect(excessive.status).toBe(413);
  const malformed = await fetch(`${base}/settings/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid-private-value' });
  expect(malformed.status).toBe(400);
  expect(await malformed.text()).not.toContain('invalid-private-value');
  expect(userModel.updateOne).not.toHaveBeenCalled();
});

test('concurrent password updates or account deletion return a conflict rather than false success', async () => {
  userModel.updateOne.mockResolvedValue({ matchedCount: 0 });
  expect((await post('/email', emailBody())).status).toBe(409);
  expect((await post('/password', passwordBody())).status).toBe(409);
  expect(principal.hash_password).toBe(initialHash);
  expect(principal.email).toBe('old@example.invalid');
});

test('database failures preserve the form email, clear passwords, and log no personal data', async () => {
  userModel.updateOne.mockRejectedValue(new Error('secret database message'));
  const response = await post('/email', emailBody());
  expect(response.status).toBe(503);
  const html = await response.text();
  expect(html).toContain('value="new@example.invalid"');
  expect(html).not.toMatch(/secret database message|Existing password!/);
  expect(logger.error).toHaveBeenCalledWith('Account settings operation failed', {
    category: 'account_settings', metadata: { operation: 'email' },
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/example.invalid|Existing password|secret database/);
});

test('account text and rejected email values stay escaped', async () => {
  principal.name = '<script>alert(1)</script>';
  principal.email = '"><img src=x onerror=alert(1)>';
  const html = await (await get()).text();
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).not.toContain('<img src=x');
  const failed = await (await post('/email', { ...emailBody(), email: principal.email })).text();
  expect(failed).toContain('&lt;img');
  expect(failed).not.toContain('<img src=x');
});

test('mutation rate limit is shared across forms and applies before further password checks', async () => {
  for (let i = 0; i < 10; i += 1) {
    expect((await post('/email', { ...emailBody(), currentPassword: 'wrong' })).status).toBe(400);
  }
  const response = await post('/password', passwordBody());
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBeTruthy();
  expect(userModel.updateOne).not.toHaveBeenCalled();
});
