jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const OTPAuth = require('otpauth');
const crypto = require('crypto');
const { createFixture, password } = require('../fixtures/twoFactor');
const { verificationReceipt, receiptValid, TRUST_MS, pendingValid, passwordFingerprint } = require('../../utils/twoFactorSession');
const { createTwoFactorService, encryptionKey, TRUST_COOKIE } = require('../../services/twoFactorService');
const { authorizeSocketSession } = require('../../utils/socketAuthorization');
const logger = require('../../utils/logger');

let fixture; let server; let base; let jar;
beforeEach(async () => {
  fixture = await createFixture(); jar = {};
  await new Promise(resolve => { server = fixture.app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
function totp(secret, timestamp = Date.now()) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });
}
async function request(url, options = {}) {
  const response = await fetch(base + url, { ...options, redirect: 'manual', headers: {
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers,
  } });
  for (const cookie of response.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(';')[0].split('='); jar[name] = value.join('=');
  }
  return response;
}
const post = (url, values, headers = {}) => request(url, { method: 'POST', body: new URLSearchParams(values), headers });
const tokenOf = html => html.match(/name="_csrf" value="([^"]+)"/)?.[1];
async function page(url) { const response = await request(url); const html = await response.text(); return { response, html, token: tokenOf(html) }; }
async function login(name = 'admin', supplied = password) {
  const { token } = await page('/login'); return post('/login', { username: name, password: supplied, _csrf: token });
}
async function enroll(name = 'admin') {
  await login(name);
  const { token } = await page('/two-factor/setup');
  expect((await post('/two-factor/setup/start', { _csrf: token, ...(name === 'admin' ? {} : { currentPassword: password }) })).status).toBe(303);
  const setup = await page('/two-factor/setup');
  const secret = setup.html.match(/<code class="two-factor-key">([^<]+)<\/code>/)[1];
  const confirmed = await post('/two-factor/setup/confirm', { _csrf: setup.token, code: totp(secret) });
  const html = await confirmed.text(); expect(confirmed.status).toBe(200);
  const codes = html.match(/[A-F0-9]{4}(?:-[A-F0-9]{4}){7}/g);
  expect(codes).toHaveLength(10);
  return { secret, codes, html, response: confirmed };
}
async function mutateSessions(change) {
  const all = await new Promise((resolve, reject) => fixture.store.all((e, sessions) => e ? reject(e) : resolve(sessions)));
  for (const [id, data] of Object.entries(all)) {
    change(data); await new Promise((resolve, reject) => fixture.store.set(id, data, e => e ? reject(e) : resolve()));
  }
}

test('password-only admin enters a restricted session and must confirm enrollment before access', async () => {
  expect((await login()).headers.get('location')).toBe('/two-factor/setup');
  expect((await request('/mypage')).status).toBe(401);
  expect((await request('/settings')).status).toBe(401);
  const setup = await page('/two-factor/setup');
  expect(setup.html).toContain('required for administrator');
  expect(fixture.records[0].two_factor).toBeUndefined();
  expect((await post('/two-factor/setup/start', { _csrf: setup.token })).status).toBe(303);
  const next = await page('/two-factor/setup');
  expect(next.response.headers.get('cache-control')).toContain('no-store');
  expect(next.response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(next.html).not.toContain('<script');
  expect(next.html).toContain('data:image/png;base64');
  expect((await post('/two-factor/setup/confirm', { _csrf: next.token, code: '123' })).status).toBe(400);
  expect((await request('/mypage')).status).toBe(401);
});

test('confirmed enrollment stores only encrypted secret/hashed recovery codes and grants access', async () => {
  const result = await enroll();
  const stored = JSON.stringify(fixture.records[0]);
  expect(stored).not.toContain(result.secret);
  for (const code of result.codes) expect(stored).not.toContain(code.replaceAll('-', ''));
  expect((await request('/mypage')).status).toBe(200);
  expect((await page('/two-factor')).html).not.toContain(result.codes[0]);
  const cookie = result.response.headers.getSetCookie().find(c => c.startsWith(TRUST_COOKIE));
  expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Max-Age=7776000');
  expect(cookie).not.toContain('Domain=');
});

test('same browser login retains original 90-day verification date and does not renew the trust cookie', async () => {
  await enroll(); delete jar['connect.sid'];
  const trusted = jar[TRUST_COOKIE];
  const response = await login();
  expect(response.headers.get('location')).toBe('/mypage');
  expect(response.headers.getSetCookie().some(c => c.startsWith(TRUST_COOKIE))).toBe(false);
  expect(jar[TRUST_COOKIE]).toBe(trusted);
  expect((await request('/mypage')).status).toBe(200);
});

test('new browsers require a code, recovery is single-use, and password reminders run after verification', async () => {
  const { codes } = await enroll(); jar = {}; fixture.records[0].password_change_requested = true;
  expect((await login()).headers.get('location')).toBe('/two-factor/verify');
  expect((await request('/mypage')).status).toBe(401);
  let challenge = await page('/two-factor/verify');
  expect((await post('/two-factor/verify', { _csrf: challenge.token, code: codes[0] })).headers.get('location')).toBe('/settings');
  jar = {}; await login(); challenge = await page('/two-factor/verify');
  expect((await post('/two-factor/verify', { _csrf: challenge.token, code: codes[0] })).status).toBe(400);
  expect((await request('/mypage')).status).toBe(401);
});

test.each(['expired', 'tampered', 'foreign', 'password', 'version'])('%s browser proof requires verification again', async kind => {
  await enroll(); const user = fixture.records[0];
  const receipt = verificationReceipt(user);
  if (kind === 'expired') receipt.verifiedAt -= TRUST_MS;
  if (kind === 'foreign') receipt.userId = fixture.records[1]._id;
  if (kind === 'password') receipt.credential = 'old-password';
  if (kind === 'version') receipt.version = 'old-factor';
  jar = { [TRUST_COOKIE]: fixture.service.seal(receipt, 'trusted-browser') + (kind === 'tampered' ? 'X' : '') };
  expect((await login()).headers.get('location')).toBe('/two-factor/verify');
});

test('password change revokes current and remembered sessions and requires factor immediately', async () => {
  const { codes } = await enroll(); const savedTrust = jar[TRUST_COOKIE];
  const { token } = await page('/settings');
  const newPassword = 'Different password2!';
  const changed = await post('/settings/password', { _csrf: token, currentPassword: password, newPassword, confirmPassword: newPassword });
  expect(changed.status).toBe(303); expect(changed.headers.get('location')).toBe('/two-factor/verify');
  expect((await request('/mypage')).status).toBe(401);
  const challenge = await page('/two-factor/verify');
  expect((await post('/two-factor/verify', { _csrf: challenge.token, code: codes[0] })).status).toBe(302);
  jar = { [TRUST_COOKIE]: savedTrust };
  expect((await login('admin', newPassword)).headers.get('location')).toBe('/two-factor/verify');
});

test.each(['expired', 'password', 'promoted'])('existing %s sessions cannot bypass the HTTP gate', async kind => {
  if (kind === 'promoted') { await login('user'); fixture.records[1].type_user = 'admin'; }
  else {
    await enroll();
    if (kind === 'password') fixture.records[0].hash_password = 'changed';
    else await mutateSessions(s => { if (s.twoFactor) s.twoFactor.verifiedAt -= TRUST_MS; });
  }
  expect((await post('/private', {})).status).toBe(401);
  expect((await request('/mypage')).status).toBe(401);
});

test('pending proof expires and rejects password/factor changes', async () => {
  await login(); await mutateSessions(s => { if (s.pendingTwoFactor) s.pendingTwoFactor.createdAt -= 600001; });
  expect((await request('/two-factor/setup')).status).toBe(401);
  await login(); fixture.records[0].hash_password = 'changed';
  expect((await request('/two-factor/setup')).status).toBe(401);
});

test('admins cannot disable; management cannot be done with only a remembered login or forged password', async () => {
  const { codes } = await enroll(); const { token } = await page('/two-factor');
  expect((await post('/two-factor/disable', { _csrf: token, currentPassword: password, code: codes[0] })).status).toBe(403);
  expect((await post('/two-factor/recovery-codes', { _csrf: token, currentPassword: 'wrong', code: codes[0] })).status).toBe(400);
  expect((await post('/two-factor/setup/start', { _csrf: token, currentPassword: password })).status).toBe(400);
  expect(fixture.records[0].two_factor.enabled).toBe(true);
});

test.each(['user', 'family', 'other'])('%s may opt in and disable after verifying password and factor', async name => {
  const { codes } = await enroll(name); const { token } = await page('/two-factor');
  expect((await post('/two-factor/disable', { _csrf: token, currentPassword: password, code: codes[0] })).headers.get('location')).toBe('/settings');
  expect(fixture.records.find(u => u.name === name).two_factor.enabled).toBe(false);
  expect(jar[TRUST_COOKIE]).toBe('');
  jar = {}; expect((await login(name)).headers.get('location')).toBe('/mypage');
});

test('replacing recovery codes rotates trust and invalidates old codes', async () => {
  const { codes } = await enroll(); const oldTrust = jar[TRUST_COOKIE];
  const { token } = await page('/two-factor');
  const response = await post('/two-factor/recovery-codes', { _csrf: token, currentPassword: password, code: codes[0] });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain(codes[1]);
  expect(await fixture.service.consume(fixture.records[0], codes[1])).toBe(false);
  jar = { [TRUST_COOKIE]: oldTrust }; expect((await login()).headers.get('location')).toBe('/two-factor/verify');
});

test('anonymous, missing-capability, and cross-account mutations are denied', async () => {
  expect((await request('/two-factor')).headers.get('location')).toBe('/login');
  await login('user'); const { token } = await page('/two-factor/setup');
  expect((await post('/two-factor/setup/start', { _csrf: token, currentPassword: password, userId: fixture.records[0]._id })).status).toBe(400);
  fixture.records[1].type_user = 'custom';
  expect((await request('/two-factor')).status).toBe(403);
  expect(fixture.records[0].two_factor).toBeUndefined();
});

test('login and factor mutations require CSRF; origin, input and body bounds are enforced', async () => {
  expect((await post('/login', { username: 'admin', password }, { Accept: 'application/json' })).status).toBe(403);
  const oversized = await post('/login', { username: 'admin', password: 'x'.repeat(5000) });
  expect(oversized.status).toBe(413); expect(await oversized.text()).toBe('Invalid verification request.');
  await login(); const { token } = await page('/two-factor/setup');
  expect((await post('/two-factor/setup/start', {}, { Accept: 'application/json' })).status).toBe(403);
  expect((await post('/two-factor/setup/start', { _csrf: token }, { Origin: 'https://attacker.invalid', Accept: 'application/json' })).status).toBe(403);
  expect((await post('/two-factor/setup/start', { _csrf: token, currentPassword: 'x'.repeat(5000) })).status).toBe(413);
  expect((await request('/two-factor/setup/start')).status).toBe(404);
  expect(fixture.records[0].two_factor).toBeUndefined();
});

test('factor attempt limit follows account across sessions', async () => {
  await enroll(); jar = {}; await login(); let { token } = await page('/two-factor/verify');
  for (let i = 0; i < 8; i++) expect((await post('/two-factor/verify', { _csrf: token, code: 'bad' })).status).toBe(400);
  jar = {}; await login(); ({ token } = await page('/two-factor/verify'));
  expect((await post('/two-factor/verify', { _csrf: token, code: 'bad' })).status).toBe(429);
});

test('configuration failure fails closed and logs no secret input', async () => {
  fixture.service.configured = () => { throw new Error('private-secret'); };
  expect((await login()).status).toBe(503);
  expect((await request('/mypage')).status).toBe(401);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-secret');
  expect(() => encryptionKey('')).toThrow();
});

test('database failure during pending enrollment returns a generic unavailable response', async () => {
  await login(); fixture.service.load = async () => { throw new Error('synthetic-private-database-details'); };
  const response = await request('/two-factor/setup');
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('synthetic-private');
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('synthetic-private');
});

test('TOTP matches RFC 6238 vector, rejects malformed/old codes and enforces atomic replay protection', async () => {
  const service = createTwoFactorService({ userModel: fixture.userModel, key: fixture.key, now: () => 59000 });
  const secret = OTPAuth.Secret.fromUTF8('12345678901234567890').base32;
  expect(service.matchStep(secret, '287082')).toBe(1);
  expect(service.matchStep(secret, '123')).toBeNull();
  const user = fixture.records[0]; user.two_factor = { enabled: true, version: 'test', last_step: -1, secret: service.seal(secret, `totp:${user._id}`) };
  expect(await Promise.all([service.consume(structuredClone(user), '287082'), service.consume(structuredClone(user), '287082')])).toEqual([true, false]);
});

test('recovery consumption is atomic, owner-bound, and rejected after concurrent password/factor changes', async () => {
  const { codes } = await enroll(); const stale = structuredClone(fixture.records[0]);
  expect(await Promise.all([fixture.service.consume(stale, codes[0]), fixture.service.consume(stale, codes[0])])).toEqual([true, false]);
  expect(fixture.service.recoveryHash(stale._id, codes[1])).not.toBe(fixture.service.recoveryHash(fixture.records[1]._id, codes[1]));
  fixture.records[0].hash_password = 'changed';
  expect(await fixture.service.consume(stale, codes[1])).toBe(false);
  expect(await fixture.service.replaceRecovery(stale)).toBeNull();
});

test('ciphertext is context-bound and authenticated; malformed keys are rejected', () => {
  const ciphertext = fixture.service.seal('synthetic-secret', 'totp:owner');
  expect(() => fixture.service.unseal(ciphertext, 'totp:foreign')).toThrow();
  expect(() => fixture.service.unseal(ciphertext + 'X', 'totp:owner')).toThrow();
  expect(() => fixture.service.unseal('x'.repeat(4097), 'totp:owner')).toThrow();
  expect(encryptionKey(crypto.randomBytes(32).toString('base64'))).toHaveLength(32);
  for (const key of [null, '', 'x'.repeat(32)]) expect(() => encryptionKey(key)).toThrow();
});

test('expired, unverified and password-stale admin socket sessions are rejected', async () => {
  const user = fixture.records[0]; user.two_factor = { enabled: true, version: 'version' };
  const session = { passport: { user: user._id }, cookie: { expires: new Date(Date.now() + 60000) } };
  const options = { userModel: fixture.userModel, permission: null };
  expect((await authorizeSocketSession(session, options)).ok).toBe(false);
  session.twoFactor = verificationReceipt(user);
  expect((await authorizeSocketSession(session, options)).ok).toBe(true);
  session.twoFactor.verifiedAt -= TRUST_MS;
  expect((await authorizeSocketSession(session, options)).ok).toBe(false);
  session.twoFactor = verificationReceipt(user); user.hash_password = 'changed';
  expect((await authorizeSocketSession(session, options)).ok).toBe(false);
});

test('proof is strictly bounded, not transferable, and pending setup cannot outlive credential changes', () => {
  const user = fixture.records[0]; user.two_factor = { enabled: true, version: 'version' };
  const receipt = verificationReceipt(user, 1000);
  expect(receiptValid(user, receipt, 1000 + TRUST_MS - 1)).toBe(true);
  expect(receiptValid(user, receipt, 1000 + TRUST_MS)).toBe(false);
  expect(receiptValid(user, receipt, 999)).toBe(false);
  const pending = { userId: user._id, credential: passwordFingerprint(user), version: 'version', createdAt: 1000 };
  expect(pendingValid(user, pending, 1001)).toBe(true);
  user.two_factor.version = 'changed'; expect(pendingValid(user, pending, 1001)).toBe(false);
});
