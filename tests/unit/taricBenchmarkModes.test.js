const express = require('express');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const { benchmarkConfiguration, benchmarkRunMode } = require('../../services/taric/gate');
const { TEST_ADAPTER, hash } = require('../../utils/taricProtocol');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));

test('diagnostic configuration binds its target allowlist and cannot carry runtime release identity', () => {
  const settings = { revision: 1, maxTokens: 256, catalog: { approved: true, codes: ['0000000001'] },
    runtime: { adapters: [{ name: TEST_ADAPTER, verified: true, identity: 'release' }] } };
  const benchmark = { _id: 'synthetic', version: 1, cases: [{ target: '0000000003' }, { target: '0000000002' }, { target: '0000000003' }] };
  const config = benchmarkConfiguration(settings, TEST_ADAPTER, 'code', benchmark, 'diagnostic');
  expect(config).toMatchObject({ mode: 'diagnostic', runtime: null,
    catalog: { approved: false, codes: ['0000000002', '0000000003'] } });
  expect(hash(config)).not.toBe(hash(benchmarkConfiguration(settings, TEST_ADAPTER, 'code', benchmark, 'release')));
  expect(hash(config)).not.toBe(hash(benchmarkConfiguration(settings, TEST_ADAPTER, 'code', { ...benchmark, cases: [{ target: '0000000001' }] }, 'diagnostic')));
  expect(benchmarkRunMode({}, { version: 0 })).toBe('diagnostic');
  expect(benchmarkRunMode({}, benchmark)).toBe('release');
  expect(() => benchmarkRunMode({ mode: null }, benchmark)).toThrow('INVALID_REQUEST');
});

test('diagnostic queue route requires a session, capability and CSRF, rejects extra authority, and derives its actor', async () => {
  const actor = 'a'.repeat(24); const benchmark = 'b'.repeat(32); const csrf = 'x'.repeat(43);
  const service = { queueRun: jest.fn().mockResolvedValue({ id: 'c'.repeat(32), mode: 'diagnostic' }) };
  let authenticated = false; let role = 'user';
  const app = express();
  app.set('views', require('path').join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = { _id: actor, name: 'synthetic', type_user: role };
    req.isAuthenticated = () => authenticated; req.session = { csrfToken: csrf }; next();
  });
  app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: async () => null } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/taric/benchmarks/${benchmark}/runs`;
  const body = { adapter: TEST_ADAPTER, mode: 'diagnostic' };
  const post = (value = body, headers = {}) => fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(value) });
  try {
    expect((await post()).status).toBe(401); authenticated = true;
    expect((await post()).status).toBe(403); role = 'family';
    expect((await post()).status).toBe(403); role = 'admin';
    expect((await post(body, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect((await post(body, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await fetch(url)).status).toBe(404);
    for (const extra of [{ actor: 'foreign' }, { releaseEligible: true }, { configuration: {} }]) {
      expect((await post({ ...body, ...extra })).status).toBe(400);
    }
    expect(service.queueRun).not.toHaveBeenCalled();
    const response = await post();
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ mode: 'diagnostic' });
    expect(service.queueRun).toHaveBeenCalledWith(benchmark, TEST_ADAPTER, actor, 'diagnostic');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
