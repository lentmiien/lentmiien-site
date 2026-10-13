jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const pug = require('pug');
const { createRouter } = require('../../routes/embeddinggemma2');
const { config } = require('../../services/embeddingGemma2/config');
const logger = require('../../utils/logger');
const owner = '111111111111111111111111'; const id = 'a'.repeat(24); const token = 'a'.repeat(43);
let server; let base; let service; let reauthorize; let root;
beforeEach(async () => {
  const lease = { assert: jest.fn(), release: jest.fn() };
  service = { acquire: jest.fn(async () => lease), reconcile: jest.fn(), list: jest.fn(async () => ({ records: [], counts: { count: 0 } })), add: jest.fn(async () => ({ id })), search: jest.fn(async () => ({ records: [], scanned: 0 })), remove: jest.fn(), media: jest.fn() };
  reauthorize = jest.fn();
  const app = express(); app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => { const role = req.get('x-test-role'); req.user = role ? { _id: owner, name: 'synthetic', type_user: role } : undefined; req.isAuthenticated = () => Boolean(role); req.session = { csrfToken: token }; res.locals.loggedIn = Boolean(role); next(); });
  app.use('/admin/embeddinggemma2', createRouter({ service, settings: config({ EMBEDDINGGEMMA2_ENABLED: 'true' }), reauthorize }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/admin/embeddinggemma2`;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'eg2-route-'));
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
const endpoints = [['GET', ''], ['GET', '/api/records'], ['GET', `/api/records/${id}/media`], ['POST', '/api/records'], ['POST', '/api/search'], ['DELETE', `/api/records/${id}`]];
test.each([undefined, 'family', 'user'])('denies every page/API/media/mutation for %s', async role => {
  for (const [method, url] of endpoints) {
    const result = await fetch(base + url, { method, headers: role ? { 'x-test-role': role } : {} });
    expect(result.status).toBe(role ? 403 : 401); expect(result.headers.get('cache-control')).toContain('no-store');
  }
  expect(service.acquire).not.toHaveBeenCalled(); expect(service.media).not.toHaveBeenCalled(); expect(service.list).not.toHaveBeenCalled();
});
test.each([{}, { 'x-csrf-token': 'invalid' }, { 'x-csrf-token': token, origin: 'https://attacker.invalid' }])('CSRF denies all mutations before parsers/provider/DB %j', async headers => {
  for (const [method, url] of endpoints.filter(([m]) => m !== 'GET')) {
    const result = await fetch(base + url, { method, headers: { 'x-test-role': 'admin', Accept: 'application/json', ...headers } }); expect(result.status).toBe(403);
  }
  expect(service.acquire).not.toHaveBeenCalled();
});
test('admin page, list and correctly role-mapped text operations succeed', async () => {
  const headers = { 'x-test-role': 'admin', 'x-csrf-token': token, 'Content-Type': 'application/json' };
  const page = await fetch(base, { headers }); expect(page.status).toBe(200); expect(await page.text()).toContain('EmbeddingGemma2 playground');
  const list = await fetch(base + '/api/records', { headers }); expect(list.status).toBe(200); expect(service.list).toHaveBeenCalledWith(owner, undefined);
  const add = await fetch(base + '/api/records', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: '<script>synthetic</script>', title: 'test' }) }); expect(add.status).toBe(201);
  expect(service.add).toHaveBeenCalledWith(owner, expect.objectContaining({ text: '<script>synthetic</script>', title: 'test' }), undefined, expect.anything(), expect.any(Function), expect.any(Function));
  const search = await fetch(base + '/api/search', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: 'query' }) }); expect(search.status).toBe(200);
  const removed = await fetch(base + `/api/records/${id}`, { method: 'DELETE', headers }); expect(removed.status).toBe(200); expect(service.remove).toHaveBeenCalledWith(owner, id, expect.anything());
});
test('multipart query passes one original file and releases resources; rejects too many/oversize', async () => {
  const headers = { 'x-test-role': 'admin', 'x-csrf-token': token };
  const form = new FormData(); form.set('kind', 'image'); form.set('file', new Blob([Buffer.from('fixture')], { type: 'image/png' }), 'fixture.png');
  const result = await fetch(base + '/api/search', { method: 'POST', headers, body: form }); expect(result.status).toBe(200);
  expect(service.search.mock.calls[0][2].originalname).toBe('fixture.png'); expect(service.search.mock.calls[0][2].buffer).toBeUndefined();
  const double = new FormData(); double.set('kind', 'image'); double.append('file', new Blob(['one']), 'one.png'); double.append('file', new Blob(['two']), 'two.png');
  expect((await fetch(base + '/api/search', { method: 'POST', headers, body: double })).status).toBe(413);
  const huge = new FormData(); huge.set('kind', 'image'); huge.set('file', new Blob([Buffer.alloc(8388609)]), 'huge.png');
  expect((await fetch(base + '/api/search', { method: 'POST', headers, body: huge })).status).toBe(413);
  expect(service.search).toHaveBeenCalledTimes(1);
});
test('range playback, suffix ranges and invalid ranges retain private response headers', async () => {
  const file = path.join(root, 'fixture'); await fs.writeFile(file, '0123456789');
  service.media.mockImplementation(async () => { const handle = await fs.open(file); return { handle, stat: await handle.stat(), mime: 'audio/wav' }; });
  const headers = { 'x-test-role': 'admin', range: 'bytes=2-5' };
  const response = await fetch(base + `/api/records/${id}/media`, { headers }); expect(response.status).toBe(206); expect(await response.text()).toBe('2345');
  expect(response.headers.get('content-range')).toBe('bytes 2-5/10'); expect(response.headers.get('content-security-policy')).toContain('sandbox'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const suffix = await fetch(base + `/api/records/${id}/media`, { headers: { ...headers, range: 'bytes=-3' } }); expect(await suffix.text()).toBe('789');
  for (const range of ['bytes=99-', 'bytes=1-2,5-6', 'bytes=-0']) expect((await fetch(base + `/api/records/${id}/media`, { headers: { ...headers, range } })).status).toBe(416);
});
test('invalid identifiers/fields and GET mutations never reach mutation service', async () => {
  const headers = { 'x-test-role': 'admin', 'x-csrf-token': token, 'Content-Type': 'application/json' };
  for (const url of ['/api/records/invalid/media', '/api/records?before=../../secret']) expect((await fetch(base + url, { headers })).status).toBeGreaterThanOrEqual(400);
  expect((await fetch(base + '/api/search', { headers })).status).toBe(404);
  expect((await fetch(base + '/api/records', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: 'x', owner: 'foreign' }) })).status).toBe(422);
  expect((await fetch(base + '/api/records', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: 'x'.repeat(65536) }) })).status).toBe(413);
  expect(service.add).not.toHaveBeenCalled(); expect(service.media).not.toHaveBeenCalled();
});
test('failure diagnostics never expose provider text or database paths', async () => {
  service.list.mockRejectedValue(new Error('secret /home/private text payload'));
  const response = await fetch(base + '/api/records', { headers: { 'x-test-role': 'admin' } });
  expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret|\/home/);
  expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/secret|\/home/);
});
test('UI compiles and uses escaped text/DOM output with no inline handlers', async () => {
  const html = pug.renderFile(path.join(__dirname, '../../views/admin_embeddinggemma2.pug'), { csrfToken: '" onmouseover="evil', loggedIn: false });
  expect(html).toContain('&quot; onmouseover=&quot;evil');
  const client = await fs.readFile(path.join(__dirname, '../../public/js/embeddinggemma2.js'), 'utf8'); expect(client).not.toContain('innerHTML');
  const app = await fs.readFile(path.join(__dirname, '../../app.js'), 'utf8');
  expect(app.match(/isEmbeddingGemma2Path\(req\) \|\|/g)).toHaveLength(2);
});
test('mutation admission is rate-limited independently of the Gateway', async () => {
  const headers = { 'x-test-role': 'admin', 'x-csrf-token': token, 'Content-Type': 'application/json' };
  for (let i = 0; i < 6; i++) expect((await fetch(base + '/api/search', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: 'synthetic' }) })).status).toBe(200);
  expect((await fetch(base + '/api/search', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', text: 'synthetic' }) })).status).toBe(429);
  expect(service.search).toHaveBeenCalledTimes(6);
});
test('expired persisted sessions are rejected by long-request reauthorization', async () => {
  const { refreshAuthorization } = require('../../routes/embeddinggemma2');
  for (const stored of [undefined, { passport: { user: owner }, cookie: { expires: new Date(0).toISOString() } }, { passport: { user: 'other' } }]) {
    const req = { user: { _id: owner }, sessionID: 'synthetic', sessionStore: { get: (_id, callback) => callback(null, stored) } };
    await expect(refreshAuthorization(req)).rejects.toThrow('Session expired');
  }
});
test('long-request authorization rejects a current account with a revoked admin bundle', async () => {
  const modelQuery = { select() { return this; }, maxTimeMS() { return this; }, lean: async () => ({ _id: owner, name: 'synthetic', type_user: 'user' }) };
  jest.doMock('../../database', () => ({ UseraccountModel: { findById: () => modelQuery } }));
  const { refreshAuthorization } = require('../../routes/embeddinggemma2');
  await expect(refreshAuthorization({ user: { _id: owner }, sessionID: 'synthetic', sessionStore: { get: (_id, callback) => callback(null, { passport: { user: owner } }) } })).rejects.toThrow('revoked');
});
