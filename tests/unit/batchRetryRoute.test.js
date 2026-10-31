const express = require('express');
const http = require('http');
const path = require('path');
const pug = require('pug');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { createBatchRetryRouter } = require('../../routes/batchRetry');
const token = 'a'.repeat(43);
let user, authenticated, server, base;
const service = { retryFailedPrompt: jest.fn() };
const roles = { findOne: jest.fn() };
beforeAll(async () => {
  const app = express(); app.set('view engine', 'pug'); app.set('views', path.join(__dirname, '../../views'));
  app.use((req, _res, next) => { req.user = user; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; next(); });
  app.use('/retry', createBatchRetryRouter(service, { roleModel: roles }));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/retry`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  jest.clearAllMocks(); roles.findOne.mockResolvedValue(null);
  authenticated = true; user = { _id: 'a'.repeat(24), name: 'synthetic', type_user: 'admin' };
  service.retryFailedPrompt.mockResolvedValue();
});
function post({ id = 'prompt-1', csrf = token, headers = {}, body = {} } = {}) {
  return fetch(`${base}/${id}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ _csrf: csrf, ...body }) });
}
test('authorized retry uses a non-GET request and the validated principal', async () => {
  const response = await post(); expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/chat4/batch_status');
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(service.retryFailedPrompt).toHaveBeenCalledWith('prompt-1', user);
});
test.each(['anonymous', 'user', 'family'])('denies %s without an explicit capability', async type => {
  if (type === 'anonymous') authenticated = false; else user.type_user = type;
  expect((await post()).status).toBe(type === 'anonymous' ? 401 : 403);
  expect(service.retryFailedPrompt).not.toHaveBeenCalled();
});
test('explicit management capability applies to the declared admin-managed scope', async () => {
  user.type_user = 'user'; roles.findOne.mockResolvedValue({ permissions: ['batch.prompts.manage'] });
  expect((await post()).status).toBe(303);
});
test.each([{ csrf: '' }, { csrf: 'wrong' }, { headers: { Origin: 'https://foreign.invalid' } }])('rejects forged mutation %j', async options => {
  expect((await post(options)).status).toBe(403); expect(service.retryFailedPrompt).not.toHaveBeenCalled();
});
test.each([{ id: 'invalid-id' }, { body: { userId: 'forged' } }, { body: { state: 'queued' } }])('rejects malformed or privileged input %j', async options => {
  expect((await post(options)).status).toBe(400); expect(service.retryFailedPrompt).not.toHaveBeenCalled();
});
test('GET never retries work', async () => {
  expect((await fetch(`${base}/prompt-1`)).status).toBe(404); expect(service.retryFailedPrompt).not.toHaveBeenCalled();
});
test('oversized forms are bounded and return a generic response', async () => {
  const response = await post({ body: { padding: 'x'.repeat(2048) } });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'Retry form is too large.' });
  expect(service.retryFailedPrompt).not.toHaveBeenCalled();
});
test('failure rendering escapes content and offers explicit retry with a CSRF token', () => {
  const html = pug.renderFile(path.join(__dirname, '../../views/batch_status.pug'), { prompts: [{
    custom_id: 'prompt-1', request_id: 'batch-1', state: 'failed', title: '<script>private()</script>',
    task_type: 'summary', failure: { reason: '<img src=x onerror=bad()>' },
  }], requests: [], canRetryBatch: true, csrfToken: token, name: 'synthetic' });
  expect(html).toContain('Retry using current chat'); expect(html).toContain('name="_csrf"');
  expect(html).toContain('/css/color-theme.css'); expect(html).not.toContain('<script>private()');
  expect(html).not.toContain('<img src=x');
});
