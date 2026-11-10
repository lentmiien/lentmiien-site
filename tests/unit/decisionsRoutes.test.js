jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../database', () => ({ UseraccountModel: { findById: jest.fn() }, RoleModel: { findOne: jest.fn() } }));
const express = require('express');
const path = require('path');
const { createRouter, refreshAuthorization } = require('../../routes/decisions');
const { DecisionError } = require('../../services/decisionsService');
const token = 'a'.repeat(43);
let server; let base; let service; let reauthorize;
beforeEach(async () => {
  service = { models: jest.fn().mockResolvedValue({ models: [] }), evaluate: jest.fn().mockResolvedValue({ model: 'test', answers: [] }) };
  reauthorize = jest.fn();
  const app = express(); app.set('view engine', 'pug'); app.set('views', path.join(__dirname, '../../views'));
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    req.user = role ? { _id: 'owner', name: 'Tester', type_user: role } : null;
    req.isAuthenticated = () => Boolean(req.user);
    req.session = { csrfToken: token }; next();
  });
  app.use('/admin/decisions', createRouter({ service, roleModel: { findOne: jest.fn().mockResolvedValue(null) }, reauthorize }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/admin/decisions`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const post = (headers = {}, body = '{}') => fetch(base, { method: 'POST', headers: { 'x-test-role': 'admin', 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers }, body });
test.each([undefined, 'user', 'family'])('denies discovery, page and inference without authority (%s)', async role => {
  for (const suffix of ['', '/models']) {
    const response = await fetch(base + suffix, { headers: role ? { 'x-test-role': role } : {} });
    expect(response.status).toBe(role ? 403 : 401);
  }
  const response = await post({ 'x-test-role': role || '' });
  expect(response.status).toBe(role ? 403 : 401);
  expect(service.evaluate).not.toHaveBeenCalled(); expect(service.models).not.toHaveBeenCalled();
});
test('renders the themed tester without analytics and uses no-store', async () => {
  const response = await fetch(base, { headers: { 'x-test-role': 'admin' } });
  const html = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(html).toContain('Decision API tester'); expect(html).toContain('/css/color-theme.css');
  expect(html).toContain(`data-csrf="${token}"`); expect(html).not.toContain('googletagmanager');
});
test.each([{ 'X-CSRF-Token': '' }, { Origin: 'https://attacker.invalid' }])('rejects forged requests before parsing/inference', async headers => {
  expect((await post(headers)).status).toBe(403); expect(service.evaluate).not.toHaveBeenCalled();
});
test('uses authenticated identity and checks authority before and after inference', async () => {
  const response = await post({}, JSON.stringify({ input: 'synthetic' }));
  expect(response.status).toBe(200);
  expect(service.evaluate).toHaveBeenCalledWith({ input: 'synthetic' }, 'owner', { signal: expect.any(AbortSignal) });
  expect(reauthorize).toHaveBeenCalledTimes(2);
});
test('refuses revoked sessions before inference and withholds results after revocation', async () => {
  reauthorize.mockRejectedValueOnce(new DecisionError('Session expired.', 401));
  expect((await post()).status).toBe(401); expect(service.evaluate).not.toHaveBeenCalled();
  reauthorize.mockResolvedValueOnce().mockRejectedValueOnce(new DecisionError('Access revoked.', 403));
  expect((await post()).status).toBe(403);
});
test('rejects malformed and oversized JSON without inference', async () => {
  expect((await post({}, '{')).status).toBe(422);
  expect((await post({}, JSON.stringify({ input: 'x'.repeat(8 * 1024 * 1024) }))).status).toBe(413);
  expect(service.evaluate).not.toHaveBeenCalled();
});
test('does not expose unexpected internal errors', async () => {
  service.evaluate.mockRejectedValue(new Error('private prompt and internal path'));
  const response = await post(); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private prompt');
});
test('disconnect aborts the Gateway request', async () => {
  let started; let cancelled;
  const begun = new Promise(resolve => { started = resolve; });
  const cancellation = new Promise(resolve => { cancelled = resolve; });
  service.evaluate.mockImplementation((_raw, _id, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { cancelled(); reject(new DecisionError('Cancelled', 499)); });
    started();
  }));
  const abort = new AbortController();
  const pending = fetch(base, { method: 'POST', headers: { 'x-test-role': 'admin', 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}', signal: abort.signal }).catch(error => error);
  await begun; abort.abort(); await pending; await cancellation;
});
test('rechecks stored session expiry/identity and the current account capability', async () => {
  const { UseraccountModel, RoleModel } = require('../../database');
  const stored = { passport: { user: 'owner' }, cookie: { expires: new Date(Date.now() + 60000) } };
  const req = { user: { _id: 'owner' }, sessionID: 'session', sessionStore: { get: jest.fn((_id, callback) => callback(null, stored)) } };
  const query = { select: jest.fn().mockReturnThis(), maxTimeMS: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ _id: 'owner', name: 'Tester', type_user: 'admin' }) };
  UseraccountModel.findById.mockReturnValue(query); RoleModel.findOne.mockResolvedValue(null);
  await expect(refreshAuthorization(req)).resolves.toBeUndefined();
  stored.cookie.expires = new Date(0);
  await expect(refreshAuthorization(req)).rejects.toHaveProperty('status', 401);
  stored.cookie.expires = new Date(Date.now() + 60000); stored.passport.user = 'other';
  await expect(refreshAuthorization(req)).rejects.toHaveProperty('status', 401);
  stored.passport.user = 'owner'; query.lean.mockResolvedValue({ _id: 'owner', name: 'Tester', type_user: 'user' });
  await expect(refreshAuthorization(req)).rejects.toHaveProperty('status', 403);
  query.lean.mockResolvedValue(null);
  await expect(refreshAuthorization(req)).rejects.toHaveProperty('status', 403);
});
