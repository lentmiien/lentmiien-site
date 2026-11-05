const express = require('express');
const path = require('path');
const fs = require('fs');
const { createMultiBoxRouter, createSubmissionLimits } = require('../../routes/binpackingMulti');
const { owner, item, jobId, job } = require('../fixtures/multiBoxPlan');
const { CAPABILITIES } = require('../../utils/smallestBoxPolicy');
const token = 'A'.repeat(43);
let server, base, packing, keys, log, roleModel;
beforeEach(async () => {
  packing = { submit: jest.fn().mockResolvedValue(job('queued')), poll: jest.fn().mockResolvedValue(job('completed')),
    containers: jest.fn().mockResolvedValue({ containers: [], revision: 1 }) };
  keys = { authenticate: jest.fn(async header => {
    if (header !== 'Bearer scoped-key') throw Object.assign(new Error('Denied'), { status: 401, publicMessage: 'Invalid or expired API key.' });
    return { ownerId: owner };
  }) };
  log = { error: jest.fn(), warning: jest.fn() };
  roleModel = { findOne: jest.fn().mockResolvedValue(null) };
  const app = express(); app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: owner, name: 'tester', type_user: req.get('x-role') || 'admin' };
    req.isAuthenticated = () => Boolean(req.user); req.session = { csrfToken: token }; next();
  });
  const limits = createSubmissionLimits();
  app.use('/api/binpacking-multi', createMultiBoxRouter({ machine: true, packing, keys, roleModel, log, limits }));
  app.use('/binpacking-multi', createMultiBoxRouter({ packing, keys, roleModel, log, limits }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const request = (path = '', options = {}, machine = false) => fetch(base + (machine ? '/api' : '') + '/binpacking-multi' + path, {
  ...options, headers: { Accept: 'application/json', ...(machine ? { Authorization: 'Bearer scoped-key' } : {}), ...options.headers },
});
const submit = (body = { items: [item] }, headers = {}, machine = false) => request('/jobs', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers }, body: JSON.stringify(body),
}, machine);
test('anonymous and missing capabilities denied; normal roles and per-user grants are explicit', async () => {
  expect((await request('/containers', { headers: { 'x-anonymous': '1' } })).status).toBe(401);
  expect((await submit(undefined, { 'x-role': 'unknown' })).status).toBe(403);
  expect(packing.submit).not.toHaveBeenCalled();
  for (const role of ['admin', 'family', 'user']) expect((await submit(undefined, { 'x-role': role })).status).toBe(202);
  roleModel.findOne.mockResolvedValue({ permissions: [CAPABILITIES.read] });
  expect((await request('/containers', { headers: { 'x-role': 'unknown' } })).status).toBe(200);
  expect((await submit(undefined, { 'x-role': 'unknown' })).status).toBe(403);
  roleModel.findOne.mockResolvedValue({ permissions: [CAPABILITIES.read, CAPABILITIES.run] });
  expect((await submit(undefined, { 'x-role': 'unknown' })).status).toBe(202);
});
test.each([{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'B'.repeat(43) }, { Origin: 'https://evil.example' }])('browser mutation rejects CSRF forgery %#', async headers => {
  expect((await submit(undefined, headers)).status).toBe(403); expect(packing.submit).not.toHaveBeenCalled();
});
test('safe methods, oversized data, unknown properties, and query options cannot submit work', async () => {
  expect((await request('/jobs')).status).toBe(404);
  expect((await submit({ items: [item], ownerId: 'b'.repeat(24) })).status).toBe(400);
  expect((await submit({ items: [item], padding: 'a'.repeat(270000) })).status).toBe(413);
  expect((await request('/jobs?key=secret')).status).toBe(400);
  expect(packing.submit).not.toHaveBeenCalled();
});
test('accepted response rewrites URLs and polling passes only the validated principal owner', async () => {
  const response = await submit();
  expect(response.status).toBe(202); expect(response.headers.get('retry-after')).toBe('5');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ jobId, statusUrl: `/binpacking-multi/jobs/${jobId}` });
  expect(packing.submit).toHaveBeenCalledWith(owner, expect.objectContaining({ items: [expect.objectContaining(item)] }));
  expect((await request('/jobs/' + jobId)).status).toBe(200);
  expect(packing.poll).toHaveBeenCalledWith(owner, jobId);
});
test('machine calls require independent bearer auth, not sessions/legacy keys, and bypass browser CSRF', async () => {
  for (const authorization of ['', 'Bearer legacy-global-key']) {
    expect((await submit(undefined, { Authorization: authorization }, true)).status).toBe(401);
  }
  const response = await submit(undefined, { 'x-anonymous': '1', 'X-CSRF-Token': '' }, true);
  expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ statusUrl: `/api/binpacking-multi/jobs/${jobId}` });
  expect(keys.authenticate).toHaveBeenCalledTimes(4);
  expect((await request('/jobs/' + jobId, { headers: { 'x-anonymous': '1' } }, true)).status).toBe(200);
});
test('rechecks revoked credentials before delivering a result', async () => {
  keys.authenticate.mockResolvedValueOnce({ ownerId: owner }).mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 401, publicMessage: 'Invalid API key.' }));
  expect((await request('/jobs/' + jobId, {}, true)).status).toBe(401);
});
test('submission budget is shared across browser and API mounts', async () => {
  for (let i = 0; i < 5; i += 1) expect((await submit(undefined, {}, i % 2 === 0)).status).toBe(202);
  expect((await submit()).status).toBe(429); expect(packing.submit).toHaveBeenCalledTimes(5);
});
test('renders local assets, no analytics, and exposes no provider/DB details on failure', async () => {
  const html = await (await request()).text();
  expect(html).toContain('Multi-box Packer'); expect(html).toContain('/js/multi-box.js');
  expect(html).toContain(`data-csrf="${token}"`); expect(html).not.toMatch(/googletagmanager|192\.168\./);
  packing.poll.mockRejectedValue(new Error('secret upstream payload'));
  const response = await request('/jobs/' + jobId);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  expect(log.error).toHaveBeenCalled(); expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret');
});
test('API mount precedes legacy parsers and browser route skips them', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  expect(source.indexOf("app.use('/api/binpacking-multi'")).toBeLessThan(source.indexOf('const legacyFormParser'));
  expect(source).toContain('binpacking-(?:smallest|multi)');
});
