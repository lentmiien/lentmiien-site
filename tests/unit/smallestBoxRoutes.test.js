const express = require('express');
const path = require('path');
const { createSmallestBoxRouter } = require('../../routes/binpackingSmallest');
const { CAPABILITIES } = require('../../utils/smallestBoxPolicy');
const owner = 'a'.repeat(24);
const foreign = 'b'.repeat(24);
const token = 'A'.repeat(43);
const box = { id: '</script><img src=x onerror=alert(1)>', w: 10, d: 10, h: 10, emptyWeight: 0, maxLoadWeight: 10 };
const items = [{ id: 'item', w: 1, d: 1, h: 1, weight: 0, qty: 1 }];
let server, base, catalog, roleModel, search, log, saved;
beforeEach(async () => {
  saved = new Map([[foreign, { containers: [box] }]]);
  catalog = {
    findOne: jest.fn(({ ownerId }) => ({ lean: async () => saved.get(String(ownerId)) })),
    findOneAndUpdate: jest.fn(async ({ ownerId }, update) => { saved.set(String(ownerId), update.$set); }),
  };
  search = jest.fn().mockResolvedValue({ success: false, message: 'No fit' });
  log = { error: jest.fn(), warning: jest.fn() };
  roleModel = { findOne: jest.fn().mockResolvedValue(null) };
  const app = express();
  app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: req.get('x-owner') || owner, name: 'tester', type_user: req.get('x-role') || 'admin' };
    req.isAuthenticated = () => Boolean(req.user);
    req.session = { csrfToken: token };
    next();
  });
  app.use('/binpacking-smallest', createSmallestBoxRouter({ catalog, roleModel, search, log }));
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
  expect(catalog.findOne).not.toHaveBeenCalled();
});
test.each(['family', 'user', 'unknown'])('%s has no default access', async role => {
  expect((await request('/containers', { headers: { 'x-role': role } })).status).toBe(403);
  expect(catalog.findOne).not.toHaveBeenCalled();
});
test('per-user read grant permits reads only', async () => {
  roleModel.findOne.mockImplementation(async query => query.type === 'user' ? { permissions: [CAPABILITIES.read] } : null);
  expect((await request('/containers', { headers: { 'x-role': 'user' } })).status).toBe(200);
  expect((await send('/containers', { containers: [] }, { 'x-role': 'user' }, 'PUT')).status).toBe(403);
  expect((await send('/run', { items }, { 'x-role': 'user' })).status).toBe(403);
});
test('admin and explicit user grants can save; reads/searches always scope to the principal', async () => {
  expect(await (await request('/containers')).json()).toEqual({ containers: [] });
  expect((await send('/containers', { containers: [box] }, {}, 'PUT')).status).toBe(200);
  expect(catalog.findOneAndUpdate).toHaveBeenCalledWith({ ownerId: owner }, { $set: { containers: [box] } }, expect.objectContaining({ upsert: true, runValidators: true }));
  expect(await (await request('/containers')).json()).toEqual({ containers: [box] });
  await send('/run', { items });
  expect(search).toHaveBeenCalledWith([box], { algorithm: 'laff', items }, expect.any(Object));
  await send('/containers', { containers: [] }, {}, 'PUT');
  expect(saved.get(foreign)).toEqual({ containers: [box] });
  roleModel.findOne.mockResolvedValue({ permissions: Object.values(CAPABILITIES) });
  expect((await send('/containers', { containers: [box] }, { 'x-role': 'user' }, 'PUT')).status).toBe(200);
});
test.each([
  { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'B'.repeat(43) }, { Origin: 'https://untrusted.example' },
])('rejects forged browser writes %#', async headers => {
  expect((await send('/containers', { containers: [] }, headers, 'PUT')).status).toBe(403);
  expect((await send('/run', { items }, headers)).status).toBe(403);
  expect(catalog.findOneAndUpdate).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
test('safe methods cannot mutate and privileged fields/oversized bodies are rejected', async () => {
  expect((await request('/run')).status).toBe(404);
  expect((await send('/containers', { containers: [], ownerId: foreign }, {}, 'PUT')).status).toBe(400);
  expect((await send('/run', { items, container: box })).status).toBe(400);
  expect((await send('/run', { items, padding: 'x'.repeat(70000) })).status).toBe(413);
  expect(catalog.findOneAndUpdate).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
test('renders the page with local preview, CSRF and no analytics or inline catalog injection', async () => {
  const response = await request(); const html = await response.text();
  expect(response.status).toBe(200); expect(html).toContain('Smallest Box Finder');
  expect(html).toContain(`data-csrf="${token}"`); expect(html).toContain('/js/smallest-box.js');
  expect(html).not.toMatch(/googletagmanager|onerror=alert/);
  expect(catalog.findOneAndUpdate).not.toHaveBeenCalled();
});
test('provider/database failures return generic errors and actionable sanitized logs', async () => {
  search.mockRejectedValue(new Error('sensitive upstream payload'));
  const response = await send('/run', { items });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive');
  expect(log.error).toHaveBeenCalled(); expect(JSON.stringify(log.error.mock.calls)).not.toContain('sensitive');
  catalog.findOne.mockImplementation(() => { throw new Error('database secret'); });
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
