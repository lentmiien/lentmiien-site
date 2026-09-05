jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createConnectivityRouter, CAPABILITY } = require('../../routes/connectivity');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');

let server;
let base;
let principal;
let authenticated;
let store;
let roleModel;
beforeEach(async () => {
  principal = { name: 'admin', type_user: 'admin' };
  authenticated = true;
  store = { history: jest.fn(async () => []) };
  roleModel = { findOne: jest.fn(async () => null) };
  const app = express();
  app.use((req, res, next) => {
    req.user = principal;
    req.isAuthenticated = () => authenticated;
    res.render = (_view, locals) => res.json({ message: locals.message });
    next();
  });
  app.use('/admin/connectivity', createConnectivityRouter({ store, roleModel,
    configReader: () => getConnectivityConfig({}) }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/admin/connectivity`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

test.each(['anonymous', 'family', 'user', 'incomplete'])('denies %s without querying history', async (type) => {
  if (type === 'anonymous') { authenticated = false; principal = null; }
  else principal = { name: type === 'incomplete' ? '' : 'test', type_user: type };
  const response = await fetch(base);
  expect(response.status).toBe(type === 'anonymous' ? 401 : 403);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(store.history).not.toHaveBeenCalled();
});

test.each(['admin', 'grant'])('allows %s to read bounded history with no mutation', async (mode) => {
  if (mode === 'grant') {
    principal = { name: 'reader', type_user: 'user' };
    roleModel.findOne.mockResolvedValue({ permissions: [CAPABILITY] });
  }
  store.history.mockResolvedValue([{ sampledAt: new Date(), signature: getConnectivityConfig({}).signature,
    probes: [{ name: 'internet', degraded: false }] }]);
  const response = await fetch(base);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toMatchObject({ status: 'ok', publicAppConfigured: false, limit: 360 });
  expect(store.history).toHaveBeenCalledWith(expect.any(Date), 360, expect.any(Date));
  expect((await fetch(base, { method: 'POST' })).status).toBe(404);
  expect(store.history).toHaveBeenCalledTimes(1);
});

test.each(['?url=https://127.0.0.1', '?limit=1000000', '?before[]=x', '?before=bad', '?before=2026-99-99T00:00:00.000Z'])('rejects query %s before database access', async (query) => {
  expect((await fetch(base + query)).status).toBe(400);
  expect(store.history).not.toHaveBeenCalled();
});

test('history pagination uses fixed bounds; stale data stays unknown', async () => {
  const sampledAt = new Date('2026-01-01T00:00:00.000Z');
  store.history.mockResolvedValue(Array.from({ length: 360 }, () => ({ sampledAt, probes: [] })));
  const response = await fetch(base + '?before=2026-09-05T00:00:00.000Z');
  expect(await response.json()).toMatchObject({ status: 'unknown', nextBefore: sampledAt.toISOString() });
  expect(store.history.mock.calls[0][2]).toEqual(new Date('2026-09-05T00:00:00Z'));
});

test('changed probe configuration cannot claim health from earlier samples', async () => {
  store.history.mockResolvedValue([{ sampledAt: new Date(), signature: 'previous-config', probes: [] }]);
  const body = await (await fetch(base)).json();
  expect(body.status).toBe('unknown');
  expect(body.samples[0]).not.toHaveProperty('signature');
});

test('database and capability lookup failures fail closed without leaking diagnostics', async () => {
  store.history.mockRejectedValue(new Error('mongodb://secret'));
  let response = await fetch(base);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('mongodb');
  principal = { name: 'reader', type_user: 'user' };
  roleModel.findOne.mockRejectedValue(new Error('secret'));
  response = await fetch(base);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret');
});
