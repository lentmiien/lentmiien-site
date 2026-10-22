const express = require('express');
const path = require('path');
const { createSmallestBoxRouter, createSmallestBoxApiRouter } = require('../../routes/binpackingSmallest');
const { createPackingOperations } = require('../../services/smallestBoxOperations');
const { CAPABILITIES } = require('../../utils/smallestBoxPolicy');
const owner = 'a'.repeat(24);
const foreign = 'b'.repeat(24);
const token = 'A'.repeat(43);
const box = { id: '</script><img src=x onerror=alert(1)>', w: 10, d: 10, h: 10, emptyWeight: 0, maxLoadWeight: 10 };
const items = [{ id: 'item', w: 1, d: 1, h: 1, weight: 0, qty: 1 }];
let server, base, catalog, roleModel, search, log, saved, keys;
beforeEach(async () => {
  saved = new Map([['shared', { containers: [], revision: 0 }], [foreign, { containers: [box] }]]);
  catalog = {
    read: jest.fn(async () => saved.get('shared')),
    save: jest.fn(async ({ containers, revision }) => {
      if (revision !== saved.get('shared').revision) throw Object.assign(new Error('Conflict'), { status: 409, publicMessage: 'Reload before saving.' });
      const result = { containers, revision: revision + 1 }; saved.set('shared', result); return result;
    }),
  };
  keys = { authenticate: jest.fn(async header => {
    if (header !== 'Bearer test-key') throw Object.assign(new Error('Denied'), { status: 401, publicMessage: 'Invalid API key.' });
    return { ownerId: owner };
  }), list: jest.fn().mockResolvedValue([]), issue: jest.fn().mockResolvedValue({ id: 'c'.repeat(24), secret: 'once' }), revoke: jest.fn().mockResolvedValue(false) };
  search = jest.fn().mockResolvedValue({ success: false, message: 'No fit' });
  log = { error: jest.fn(), warning: jest.fn(), notice: jest.fn() };
  roleModel = { findOne: jest.fn().mockResolvedValue(null) };
  const app = express();
  app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: req.get('x-owner') || owner, name: 'tester', type_user: req.get('x-role') || 'admin' };
    req.isAuthenticated = () => Boolean(req.user);
    req.session = { csrfToken: token };
    next();
  });
  const operations = createPackingOperations({ catalog, search });
  app.use('/api/binpacking-smallest', createSmallestBoxApiRouter({ catalog, operations, keys, log }));
  app.use('/binpacking-smallest', createSmallestBoxRouter({ catalog, roleModel, operations, keys, log }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/binpacking-smallest`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const request = (url = '', options = {}) => fetch(base + url, { ...options,
  headers: { Accept: 'application/json', ...options.headers } });
const send = (url, body, headers = {}, method = 'POST') => request(url, { method,
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers }, body: JSON.stringify(body) });

test('anonymous denied with private cache policy', async () => {
  const response = await request('/containers', { headers: { 'x-anonymous': 'true' } });
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(catalog.read).not.toHaveBeenCalled();
});
test.each(['unknown'])('%s has no default access', async role => {
  expect((await request('/containers', { headers: { 'x-role': role } })).status).toBe(403);
  expect(catalog.read).not.toHaveBeenCalled();
});
test('per-user read grant permits reads only', async () => {
  roleModel.findOne.mockImplementation(async query => query.type === 'user' ? { permissions: [CAPABILITIES.read] } : null);
  expect((await request('/containers', { headers: { 'x-role': 'unknown' } })).status).toBe(200);
  expect((await send('/containers', { containers: [] }, { 'x-role': 'unknown' }, 'PUT')).status).toBe(403);
  expect((await send('/run', { items }, { 'x-role': 'unknown' })).status).toBe(403);
});
test('all normal users read/search the shared catalog; only editors can update it', async () => {
  expect(await (await request('/containers')).json()).toEqual({ containers: [], revision: 0 });
  expect((await send('/containers', { containers: [box], revision: 0 }, {}, 'PUT')).status).toBe(200);
  expect(catalog.save).toHaveBeenCalledWith({ containers: [{ ...box, tags: [] }], revision: 0 });
  for (const role of ['admin', 'family', 'user']) {
    expect(await (await request('/containers', { headers: { 'x-role': role, 'x-owner': foreign } })).json()).toEqual({ containers: [{ ...box, tags: [] }], revision: 1 });
    expect((await send('/run', { items }, { 'x-role': role })).status).toBe(200);
  }
  expect((await send('/containers', { containers: [], revision: 1 }, { 'x-role': 'user' }, 'PUT')).status).toBe(403);
  roleModel.findOne.mockResolvedValue({ permissions: [CAPABILITIES.write] });
  expect((await send('/containers', { containers: [], revision: 1 }, { 'x-role': 'user' }, 'PUT')).status).toBe(200);
  expect(saved.get(foreign)).toEqual({ containers: [box] });
  expect((await send('/containers', { containers: [box], revision: 1 }, {}, 'PUT')).status).toBe(409);
});

test.each([
  { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'B'.repeat(43) }, { Origin: 'https://untrusted.example' },
])('rejects forged browser writes %#', async headers => {
  expect((await send('/containers', { containers: [] }, headers, 'PUT')).status).toBe(403);
  expect((await send('/run', { items }, headers)).status).toBe(403);
  expect(catalog.save).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
test('safe methods cannot mutate and privileged fields/oversized bodies are rejected', async () => {
  expect((await request('/run')).status).toBe(404);
  expect((await send('/containers', { containers: [], ownerId: foreign }, {}, 'PUT')).status).toBe(400);
  expect((await send('/run', { items, container: box })).status).toBe(400);
  expect((await send('/run', { items, padding: 'x'.repeat(70000) })).status).toBe(413);
  expect(catalog.save).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
test('renders the page with local preview, CSRF and no analytics or inline catalog injection', async () => {
  const response = await request(); const html = await response.text();
  expect(response.status).toBe(200); expect(html).toContain('Smallest Box Finder');
  expect(html).toContain(`data-csrf="${token}"`); expect(html).toContain('/js/smallest-box.js');
  expect(html).not.toMatch(/googletagmanager|onerror=alert/);
  expect(catalog.save).not.toHaveBeenCalled();
});
test('provider/database failures return generic errors and actionable sanitized logs', async () => {
  search.mockRejectedValue(new Error('sensitive upstream payload'));
  const response = await send('/run', { items });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive');
  expect(log.error).toHaveBeenCalled(); expect(JSON.stringify(log.error.mock.calls)).not.toContain('sensitive');
  catalog.read.mockImplementation(() => { throw new Error('database secret'); });
  expect((await request('/containers')).status).toBe(503);
});
test('one concurrent search per owner; releases slot after completion', async () => {
  let finish; let started;
  const entered = new Promise(resolve => { started = resolve; });
  search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
  const pending = send('/run', { items }); await entered;
  expect((await send('/run', { items })).status).toBe(429);
  finish({ success: false }); expect((await pending).status).toBe(200);
  expect((await send('/run', { items })).status).toBe(200);
});
test('rate limits searches', async () => {
  for (let i = 0; i < 5; i += 1) expect((await send('/run', { items })).status).toBe(200);
  expect((await send('/run', { items })).status).toBe(429);
});

test('at most two different owners search concurrently', async () => {
  const finish = [];
  let notify;
  const entered = () => new Promise(resolve => { notify = resolve; });
  search.mockImplementation(() => new Promise(resolve => { finish.push(resolve); notify(); }));
  let started = entered(); const first = send('/run', { items }); await started;
  started = entered(); const second = send('/run', { items }, { 'x-owner': foreign }); await started;
  expect((await send('/run', { items }, { 'x-owner': 'c'.repeat(24) })).status).toBe(429);
  finish.forEach(resolve => resolve({ success: false }));
  expect((await first).status).toBe(200); expect((await second).status).toBe(200);
});

const api = (body = { items }, headers = {}, method = 'POST') => fetch(base.replace('/binpacking-smallest', '/api/binpacking-smallest'), {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key', ...headers },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
test('machine route accepts bearer auth without a browser session/CSRF and uses saved boxes and tag filters', async () => {
  saved.set('shared', { containers: [box], revision: 0 });
  const tagFilter = { require: ['fold-box'], requireNot: ['tube'] };
  expect((await api({ items, tagFilter }, { 'x-anonymous': 'true' })).status).toBe(200);
  expect(search).toHaveBeenCalledWith([box], { algorithm: 'laff', items, tagFilter }, expect.any(Object));
  expect(keys.authenticate).toHaveBeenCalledTimes(2);
});
test('API rejects session-only/legacy/bad auth and unknown options before searching', async () => {
  expect((await api({ items }, { Authorization: '' })).status).toBe(401);
  expect((await api({ items }, { Authorization: 'Bearer legacy-key' })).status).toBe(401);
  expect((await api({ items, ownerId: foreign })).status).toBe(400);
  expect((await api({ items, padding: 'x'.repeat(70000) })).status).toBe(413);
  expect((await api(undefined, {}, 'GET')).status).toBe(404);
  expect(search).not.toHaveBeenCalled();
});
test('browser and API share the per-issuer concurrency limit', async () => {
  let finish, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; entered(); }));
  const pending = send('/run', { items }); await ready;
  expect((await api()).status).toBe(429);
  finish({ success: false }); await pending;
  expect((await api()).status).toBe(200);
});
test('API key management requires capability and CSRF and scopes mutations to the current user', async () => {
  expect((await send('/api-keys', { label: 'app', days: 30 }, { 'x-role': 'user' })).status).toBe(403);
  expect((await send('/api-keys', { label: 'app', days: 30 }, { 'X-CSRF-Token': '' })).status).toBe(403);
  expect((await send('/api-keys', { label: 'app', days: 30, ownerId: foreign })).status).toBe(400);
  expect((await send('/api-keys', { label: 'app', days: 30 })).status).toBe(201);
  expect(keys.issue).toHaveBeenCalledWith(owner, 'app', 30);
  expect((await send('/api-keys/' + foreign, {}, {}, 'DELETE')).status).toBe(404);
  expect(keys.revoke).toHaveBeenCalledWith(owner, foreign);
  expect(JSON.stringify(log.notice.mock.calls)).not.toContain('once');
});

test('machine route is mounted before legacy parsers and cannot fall through to the legacy API', async () => {
  const source = require('fs').readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const mounted = source.indexOf("app.use('/api/binpacking-smallest'");
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(source.indexOf('const legacyJsonParser'));
  const response = await fetch(base.replace('/binpacking-smallest', '/api/binpacking-smallest') + '/unknown', {
    headers: { Authorization: 'Bearer test-key' },
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ success: false, message: 'API route not found.' });
});

test('revocation during a machine search prevents result delivery', async () => {
  keys.authenticate.mockResolvedValueOnce({ ownerId: owner }).mockRejectedValueOnce(Object.assign(new Error('Revoked'), { status: 401, publicMessage: 'Invalid API key.' }));
  const response = await api();
  expect(response.status).toBe(401);
  expect(search).toHaveBeenCalledTimes(1);
});

const apiCatalog = (options = {}, suffix = '') => fetch(base.replace('/binpacking-smallest', '/api/binpacking-smallest') + '/containers' + suffix, {
  ...options, headers: { Authorization: 'Bearer test-key', ...options.headers },
});
test('API returns shared boxes and sorted unique tags without a browser session or mutation', async () => {
  const containers = [{ ...box, tags: ['tube', 'fold-box'] }, { ...box, id: 'second', tags: ['tube'] }, { ...box, id: 'untagged', tags: [] }];
  saved.set('shared', { containers, revision: 3, migratedFrom: owner });
  const response = await apiCatalog({ headers: { 'x-anonymous': 'true' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await response.json()).toEqual({ containers, revision: 3, tags: ['fold-box', 'tube'] });
  expect(keys.authenticate).toHaveBeenCalledTimes(2);
  expect(catalog.save).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
});
test('empty API catalog succeeds and reads do not consume search quota', async () => {
  for (let i = 0; i < 6; i += 1) {
    const response = await apiCatalog();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ containers: [], revision: 0, tags: [] });
  }
  expect((await api()).status).toBe(200);
});
test('API catalog rejects missing/invalid keys, query selectors and write methods', async () => {
  for (const Authorization of ['', 'Bearer legacy-key']) {
    expect((await apiCatalog({ headers: { Authorization } })).status).toBe(401);
  }
  expect((await apiCatalog({}, '?ownerId=' + foreign)).status).toBe(400);
  for (const method of ['POST', 'PUT', 'DELETE']) expect((await apiCatalog({ method })).status).toBe(404);
  expect(catalog.read).not.toHaveBeenCalled();
  expect(catalog.save).not.toHaveBeenCalled();
});
test('API catalog hides storage errors and logs an actionable failure', async () => {
  catalog.read.mockRejectedValue(new Error('private database details'));
  const response = await apiCatalog();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database details');
  expect(log.error).toHaveBeenCalled();
  expect(JSON.stringify(log.error.mock.calls)).not.toContain('private database details');
});
test('revocation during a catalog read prevents result delivery', async () => {
  keys.authenticate.mockResolvedValueOnce({ ownerId: owner }).mockRejectedValueOnce(Object.assign(new Error('Revoked'), { status: 401, publicMessage: 'Invalid API key.' }));
  expect((await apiCatalog()).status).toBe(401);
});
