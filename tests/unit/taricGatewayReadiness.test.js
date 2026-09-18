const http = require('http');
const zlib = require('zlib');
const { createTransport, boundedJson } = require('../../services/taric/transport');
const { createWarmSessions } = require('../../services/taric/warmSession');
const { createGatewayCapabilities, REQUIRED, validate } = require('../../services/taric/gatewayCapabilities');
const { gatewayFixture, openapi } = require('../helpers/taricGateway');
let fixture;
afterEach(async () => { if (fixture) await fixture.close(); fixture = null; });
test.each(REQUIRED)('missing published role %s %s never passes health or a partial document', (path, method) => {
  const document = openapi(); delete document.paths[path][method];
  expect(() => validate(document)).toThrow('GATEWAY_UPGRADE_REQUIRED');
});
test('missing generation route, malformed operations and fake health fail closed', () => {
  expect(() => validate({ status: 'healthy' })).toThrow('READINESS_UNVERIFIED');
  const document = openapi(); document.paths['/qwen3-lora/{path}'].post = {};
  expect(() => validate(document)).toThrow('GATEWAY_UPGRADE_REQUIRED');
});
test('old healthy Gateway: every owned entrypoint stops at read-only OpenAPI', async () => {
  fixture = await gatewayFixture(); fixture.document = { openapi: '3.1.0', paths: { '/health': { get: {} } } };
  const adapter = createTransport({ env: fixture.env }).sessionAdapter;
  const session = { id: 'untrusted', ownerToken: 'never-send' };
  for (const [method, args] of [['open', { correlationId: 'fresh' }], ['status', { session }], ['renew', { session }],
    ['generate', { session, body: {} }], ['close', { session }], ['probe', {}]]) {
    await expect(adapter[method](args)).rejects.toMatchObject({ code: 'GATEWAY_UPGRADE_REQUIRED', stage: 'gateway.preflight', inferenceDispatched: false });
  }
  expect(fixture.requests.every(r => r.path === '/openapi.json' && r.method === 'GET')).toBe(true);
  expect(fixture.requests.every(r => !r.headers['x-inference-session-token'])).toBe(true);
  expect(fixture.sessions).toHaveLength(0); expect(fixture.generateCount).toBe(0);
});
test('cache is short, keyed by configuration, invalidated by forced refresh and excludes failed proofs', async () => {
  let now = 0; let fingerprint = 'config-one';
  const gateway = jest.fn(async () => openapi());
  const caps = createGatewayCapabilities(gateway, { now: () => now, fingerprint: () => fingerprint, ttlMs: 100 });
  const proof = await caps.preflight(); expect(proof).toMatchObject({ protocol: 'owned-v1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await caps.preflight(); expect(gateway).toHaveBeenCalledTimes(1);
  now = 101; await caps.preflight(); expect(gateway).toHaveBeenCalledTimes(2);
  fingerprint = 'config-two'; await caps.preflight(); expect(gateway).toHaveBeenCalledTimes(3);
  await caps.preflight({ force: true }); expect(gateway).toHaveBeenCalledTimes(4);
  caps.invalidate(); gateway.mockResolvedValue({ healthy: true });
  await expect(caps.preflight()).rejects.toMatchObject({ code: 'READINESS_UNVERIFIED' });
  gateway.mockResolvedValue(openapi()); await caps.preflight(); expect(gateway).toHaveBeenCalledTimes(6);
  expect(gateway.mock.calls[0]).toEqual(['/openapi.json', expect.objectContaining({ maxBytes: 2097152, maxWireBytes: 2097152, deadlineMs: 4000 })]);
});
test('owned status and cleanup retain proof when later discovery fails; generation cannot use failed discovery', async () => {
  fixture = await gatewayFixture(); const t = createTransport({ env: fixture.env }); const warm = createWarmSessions(t.sessionAdapter);
  const session = await warm.open({ correlationId: 'fresh' });
  expect(session.capabilityProof.digest).toMatch(/^[a-f0-9]{64}$/);
  fixture.discoveryStatus = 503;
  await expect(warm.preflight({ force: true })).rejects.toMatchObject({ code: 'READINESS_UNVERIFIED', transport: { status: 503 } });
  await expect(t.sessionAdapter.generate({ session: {}, body: {} })).rejects.toMatchObject({ code: 'READINESS_UNVERIFIED' });
  expect(await warm.status(session, 'absent')).toMatchObject({ missing: true });
  expect(await warm.close(session)).toEqual({ idle: true });
  expect(fixture.generateCount).toBe(0);
});
test.each(['html', 'json', 'declared', 'compressed', 'unavailable', 'timeout'])('bounded loopback discovery rejects %s without any owned call', async mode => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    if (mode === 'timeout') return;
    res.writeHead(mode === 'unavailable' ? 503 : 200, {
      'Content-Type': mode === 'html' ? 'text/html' : 'application/json',
      ...(mode === 'declared' ? { 'Content-Length': '2097153' } : {}),
      ...(mode === 'compressed' ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(mode === 'compressed' ? zlib.gzipSync(JSON.stringify({ value: 'x'.repeat(2097153) })) : mode === 'json' ? '{broken' : '{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const t = createTransport({ env: { TARIC_GATEWAY_ORIGIN: origin, TARIC_GATEWAY_ALLOWED_ORIGINS: origin },
      json: (url, options) => boundedJson(url, { ...options, deadlineMs: mode === 'timeout' ? 30 : options.deadlineMs }) });
    const error = await t.sessionAdapter.open({ correlationId: 'fresh' }).catch(e => e);
    expect(error).toMatchObject({ code: 'READINESS_UNVERIFIED', stage: 'gateway.preflight', inferenceDispatched: false });
    expect(error.transport).not.toBeNull(); expect(paths).toEqual(['/openapi.json']);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test.each([400, 401, 403, 404])('definitive create HTTP %i preserves structured pre-generation stage', async status => {
  const t = createTransport({ env: { TARIC_GATEWAY_ORIGIN: 'https://synthetic.test', TARIC_GATEWAY_ALLOWED_ORIGINS: 'https://synthetic.test' },
    json: async url => {
      if (url.pathname === '/openapi.json') return openapi();
      const error = new (require('../../utils/taricContracts').TaricError)('PROVIDER_FAILED');
      error.transport = { phase: 'http', status, dispatched: true, terminal: true }; throw error;
    } });
  await expect(createWarmSessions(t.sessionAdapter).open({ correlationId: 'fresh' })).rejects.toMatchObject({
    code: 'PROVIDER_FAILED', stage: 'session.create', inferenceDispatched: false, transport: { status },
  });
});
test('connect failure before session dispatch is not inference uncertainty', async () => {
  const error = new (require('../../utils/taricContracts').TaricError)('PROVIDER_FAILED');
  error.transport = { phase: 'connect', dispatched: false, terminal: false, socketCode: 'ECONNREFUSED' };
  const adapter = require('../../services/taric/gatewaySessions').createGatewaySessions(async path => {
    if (path === '/openapi.json') return openapi(); throw error;
  });
  await expect(createWarmSessions(adapter).open({ correlationId: 'fresh' })).rejects.toMatchObject({ code: 'PROVIDER_FAILED', stage: 'session.create', transport: { dispatched: false } });
});
