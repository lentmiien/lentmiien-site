const express = require('express');
const http = require('http');
const path = require('path');
const { createAmiAmiUploadRouter } = require('../../routes/amiamiUpload');
const { AmiAmiUploadError, MAX_HTML_BYTES } = require('../../utils/amiamiUploadPolicy');
const service = { status: jest.fn(), submit: jest.fn() };
const roleModel = { findOne: jest.fn() };
const logger = { error: jest.fn(), warning: jest.fn() };
const token = 'a'.repeat(43);
let user, authenticated, server, base;
let actorNumber = 0;

beforeAll(async () => {
  const app = express();
  app.set('views', path.join(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.use((req, _res, next) => { req.user = user; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; next(); });
  app.use('/admin/amiami-items/upload', createAmiAmiUploadRouter(service, { roleModel, appLogger: logger }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/admin/amiami-items/upload`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  jest.clearAllMocks();
  user = { _id: (++actorNumber).toString(16).padStart(24, '0'), name: 'synthetic', type_user: 'admin' };
  authenticated = true;
  roleModel.findOne.mockResolvedValue(null);
  service.status.mockResolvedValue(null);
  service.submit.mockResolvedValue({ active: true, jobId: 'fixture' });
});
const body = (html = '<a href="/eng/detail?gcode=TOY-RBT-9417">x</a>') => { const form = new FormData(); form.append('html', html); return form; };
const post = (form = body(), headers = {}) => fetch(base, { method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': token, ...headers }, body: form });

test('GET renders a private themed form and never submits work', async () => {
  const response = await fetch(base);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect(html).toContain('/css/color-theme.css');
  expect(html).toContain('csrf-token');
  expect(html).not.toContain('googletagmanager');
  expect(service.submit).not.toHaveBeenCalled();
});

test.each(['', '/status'])('anonymous requests cannot access %s', async suffix => {
  authenticated = false;
  expect((await fetch(base + suffix)).status).toBe(401);
  expect(service.status).not.toHaveBeenCalled();
});

test.each(['user', 'family'])('%s does not get import capability by default', async type => {
  user.type_user = type;
  expect((await fetch(base + '/status')).status).toBe(403);
  expect((await post()).status).toBe(403);
  expect(service.submit).not.toHaveBeenCalled();
});

test('explicit semantic capability grants allow an authenticated principal to manage the shared slot', async () => {
  user.type_user = 'user';
  roleModel.findOne.mockResolvedValue({ permissions: ['amiami.items.import'] });
  expect((await post()).status).toBe(202);
  expect(service.submit.mock.calls[0][1]).toBe(user._id);
});

test.each([
  { 'X-CSRF-Token': '' },
  { 'X-CSRF-Token': 'wrong' },
  { Origin: 'https://evil.invalid' },
])('rejects missing/invalid CSRF and foreign origins before submission', async headers => {
  expect((await post(body(), headers)).status).toBe(403);
  expect(service.submit).not.toHaveBeenCalled();
});

test('accepts pasted fragments and forwards only the authenticated creator', async () => {
  const html = '<div><a href="/eng/detail?gcode=TOY-RBT-9417">x</a></div>';
  expect((await post(body(html))).status).toBe(202);
  expect(service.submit).toHaveBeenCalledWith(html, user._id);
});

test('accepts a saved UTF-8 HTML file', async () => {
  const form = new FormData(); form.append('file', new Blob(['<body>sample HTML</body>'], { type: 'text/html' }), 'items.html');
  expect((await post(form)).status).toBe(202);
  expect(service.submit).toHaveBeenCalledWith('<body>sample HTML</body>', user._id);
});

test.each(['both', 'extra', 'wrong-extension', 'invalid-encoding', 'multiple-files'])('rejects malformed uploads: %s', async mode => {
  const form = new FormData();
  if (mode === 'both') { form.append('html', '<a>pasted</a>'); form.append('file', new Blob(['<a>file</a>']), 'items.html'); }
  if (mode === 'extra') form.append('creator', 'forged');
  if (mode === 'wrong-extension') form.append('file', new Blob(['text']), 'items.exe');
  if (mode === 'invalid-encoding') form.append('file', new Blob([Uint8Array.from([255, 254, 0])]), 'items.html');
  if (mode === 'multiple-files') { form.append('file', new Blob(['text']), 'one.html'); form.append('file', new Blob(['text']), 'two.html'); }
  expect((await post(form)).status).toBe(400);
  expect(service.submit).not.toHaveBeenCalled();
});

test.each(['paste', 'file'])('rejects oversized %s content', async mode => {
  const form = new FormData();
  if (mode === 'paste') form.append('html', 'x'.repeat(MAX_HTML_BYTES + 1));
  else form.append('file', new Blob(['x'.repeat(MAX_HTML_BYTES + 1)]), 'large.html');
  expect((await post(form)).status).toBe(413);
  expect(service.submit).not.toHaveBeenCalled();
});

test('active-job conflict returns 409 without replacing the job', async () => {
  service.submit.mockRejectedValueOnce(new AmiAmiUploadError('JOB_ACTIVE', 'An import is already running.', 409));
  const response = await post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'An import is already running.' });
});

test('status is read-only and available to other capability holders under the declared shared scope', async () => {
  service.status.mockResolvedValue({ active: true, jobId: 'other-operator-job' });
  expect(await (await fetch(base + '/status')).json()).toEqual({ job: { active: true, jobId: 'other-operator-job' } });
  expect(service.submit).not.toHaveBeenCalled();
});

test('unexpected service failures are logged without raw input or secrets', async () => {
  service.status.mockRejectedValueOnce(new Error('mongodb://private:secret@db/connection'));
  const response = await fetch(base + '/status');
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret');
  expect(logger.error).toHaveBeenCalledWith('AmiAmi HTML import request failed', { category: 'amiami-upload' });
});

test('rejects malformed multipart and compressed input', async () => {
  const response = await fetch(base, { method: 'POST', headers: { 'X-CSRF-Token': token, 'Content-Type': 'multipart/form-data; boundary=invalid' }, body: 'broken' });
  expect(response.status).toBe(400);
  expect((await post(body(), { 'Content-Encoding': 'gzip' })).status).toBe(400);
  expect(service.submit).not.toHaveBeenCalled();
});

test('submission rate limiting is per principal', async () => {
  for (let i = 0; i < 5; i += 1) expect((await post()).status).toBe(202);
  expect((await post()).status).toBe(429);
});

test('app bypasses legacy body parsers, mounts before legacy admin auth and wires worker lifecycle', () => {
  const source = require('fs').readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  expect(source.match(/isAmiAmiUploadPath\(req\)/g)).toHaveLength(2);
  expect(source.indexOf("app.use('/admin/amiami-items/upload'")).toBeLessThan(source.indexOf("app.use('/admin', isAuthenticated"));
  expect(source).toContain("['AmiAmi HTML import worker', () => amiamiUpload.start()]");
  expect(source.match(/amiamiUpload.stop\(\)/g)).toHaveLength(2);
});
