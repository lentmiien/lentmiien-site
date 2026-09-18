const { createTransport, boundedJson } = require('../../services/taric/transport');
const { createWarmSessions } = require('../../services/taric/warmSession');
const { createGatewaySessions } = require('../../services/taric/gatewaySessions');
const { openapi, contract, operation, status, envelope, gatewayFixture } = require('../helpers/taricGateway');
const { TEST_ADAPTER, payload } = require('../../utils/taricProtocol');
const withDiscovery = gateway => (path, options) => path === '/openapi.json' ? Promise.resolve(openapi()) : gateway(path, options);
const row = { descriptive_name: 'Synthetic', full_item_name: 'Synthetic', specs: '', hs_code: '950300' };
let fixture;
afterEach(async () => { if (fixture) await fixture.close(); fixture = null; });
test('fixture matches exact exported Gateway field sets and limits (not invented nested JSON)', () => {
  expect(Object.keys(status()).sort()).toEqual(Object.keys(contract.status_shape).sort());
  expect(Object.keys(operation('op')).sort()).toEqual(Object.keys(contract.operation_shape).sort());
  expect(Object.keys(envelope()).sort()).toEqual(Object.keys(contract.generation_success_shape).sort());
  expect(contract.reconciliation.generation_auto_retry).toBe(false);
  expect(contract.bounds.generation_response_gateway_byte_cap).toBeNull();
  expect(contract.site_taric_policy.site_test_true_adapter_name).toBe(TEST_ADAPTER);
});
test('real isolated HTTP: one-time owner, separate admin/proxy headers, exact named-adapter bytes and owned cleanup', async () => {
  fixture = await gatewayFixture();
  const t = createTransport({ env: fixture.env }); const warm = createWarmSessions(t.sessionAdapter);
  const handle = await warm.open({ correlationId: 'fresh-client' });
  expect(JSON.stringify(handle)).not.toContain('synthetic-owner-capability');
  expect(fixture.generateCount).toBe(0);
  await warm.generate(handle, row, ['0000000001'], 256, { correlationId: 'persisted-op' });
  expect(await warm.status(handle, 'persisted-op')).toMatchObject({ idle: true, terminal: true, correlated: true });
  await warm.renew(handle); expect(await warm.close(handle)).toEqual({ idle: true });
  const generation = fixture.requests.find(r => r.path === contract.endpoints.generate.path);
  expect(generation.body).toEqual(payload(row, TEST_ADAPTER, 256));
  expect(generation.body.adapter_name).toBe('taric-v1-20260917-2');
  expect(generation.headers).toMatchObject({ 'x-inference-session': handle.id, 'x-inference-session-token': 'synthetic-owner-capability', 'x-inference-operation': 'persisted-op' });
  expect(fixture.requests.every(r => r.headers['x-admin-token'] === 'synthetic-admin' && r.headers.authorization === 'Bearer synthetic-proxy')).toBe(true);
  expect(fixture.requests.find(r => r.path === contract.endpoints.create.path).body).toEqual({ ...contract.endpoints.create.body_example, client_id: 'fresh-client' });
});
test('HTTP abort with remote 200 remains failed; matching ARRAY entry allows NEXT case only; duplicate never executes', async () => {
  fixture = await gatewayFixture(); fixture.dropAt = 1;
  const warm = createWarmSessions(createTransport({ env: fixture.env }).sessionAdapter);
  const handle = await warm.open({ correlationId: 'client' });
  await expect(warm.generate(handle, row, ['0000000001'], 256, { correlationId: 'op-1' })).rejects.toThrow('INFERENCE_UNCERTAIN');
  fixture.sessions[0].operations.push(operation('unrelated-last'));
  expect(await warm.status(handle, 'op-1')).toMatchObject({ idle: true, terminal: true, correlated: true });
  await expect(warm.generate(handle, row, ['0000000001'], 256, { correlationId: 'op-1' })).rejects.toThrow('INFERENCE_UNCERTAIN');
  expect(fixture.generateCount).toBe(1);
  await warm.generate(handle, row, ['0000000001'], 256, { correlationId: 'op-2' });
  expect(fixture.generateCount).toBe(2); await warm.close(handle);
});
test.each([
  s => ({ ...s, idle_proven: undefined }),
  s => ({ ...s, operations: { 'op-1': operation('op-1') } }),
])('missing idle proof or map operations fails closed', async patch => {
  const gateway = jest.fn().mockResolvedValue(patch(status()));
  await expect(createGatewaySessions(withDiscovery(gateway)).status({ session: { id: 'session-1' }, correlationId: 'op-1' })).rejects.toThrow('INFERENCE_UNCERTAIN');
});
test('missing operation / HTTP404 / wrong owner / busy operator do not provide completion proof or mutate others', async () => {
  fixture = await gatewayFixture(); const t = createTransport({ env: fixture.env }); const warm = createWarmSessions(t.sessionAdapter);
  fixture.busy = true; await expect(warm.open({ correlationId: 'client' })).rejects.toThrow('PROVIDER_FAILED');
  expect(fixture.sessions).toHaveLength(0); fixture.busy = false;
  const handle = await warm.open({ correlationId: 'client-2' });
  expect(await warm.status(handle, 'absent')).toMatchObject({ missing: true, correlated: false, terminal: false });
  await expect(boundedJson(new URL(`${fixture.env.TARIC_GATEWAY_ORIGIN}/qwen3-lora/inference-sessions/${handle.id}`), {
    method: 'DELETE', headers: { 'X-Admin-Token': 'synthetic-admin', Authorization: 'Bearer synthetic-proxy', 'X-Inference-Session-Token': 'wrong' },
  })).rejects.toMatchObject({ transport: { status: 403 } });
  expect(fixture.sessions[0].reclaim_verified).toBe(false);
  fixture.sessions[0].session_id = 'different';
  await expect(warm.status(handle, 'absent')).rejects.toMatchObject({ transport: { status: 404 } });
});
test('close202 polls bounded and never trusts status code alone; verified reclaim allows fresh session', async () => {
  const gateway = jest.fn().mockResolvedValue({ ...status(), state: 'uncertain', idle_proven: false });
  const adapter = createGatewaySessions(withDiscovery(gateway), { closePolls: 2, delayMs: 1 });
  expect(await adapter.close({ session: { id: 'session-1' } })).toEqual({ idle: false });
  expect(gateway).toHaveBeenCalledTimes(3);
  gateway.mockResolvedValue({ ...status(), state: 'expired', idle_proven: false, reclaim_verified: true });
  expect(await adapter.status({ session: { id: 'session-1' }, correlationId: 'op' })).toMatchObject({ reclaimed: true, terminal: false });
  expect(await adapter.close({ session: { id: 'session-1' } })).toEqual({ idle: true });
  fixture = await gatewayFixture(); fixture.closePending = true;
  const warm = createWarmSessions(createTransport({ env: fixture.env }).sessionAdapter);
  const first = await warm.open({ correlationId: 'first' }); await warm.close(first);
  const second = await warm.open({ correlationId: 'second' }); expect(second.id).not.toBe(first.id); await warm.close(second);
});
test('hard deadline cannot be extended by heartbeat or server clock skew', async () => {
  let now = 0;
  const gateway = jest.fn().mockImplementation(async () => ({ ...status(), server_time: 99999999, owner_token: 'synthetic-owner-capability', hard_remaining_sec: 900 - now / 1000 }));
  const warm = createWarmSessions(createGatewaySessions(withDiscovery(gateway), { now: () => now }), { now: () => now });
  const handle = await warm.open({ correlationId: 'hard-deadline' });
  for (let i = 0; i < 8; i++) { now += 100000; await warm.renew(handle); }
  expect(handle.hardExpiresAt).toBe(900000); now = 900001;
  await expect(warm.renew(handle)).rejects.toThrow('RECOVERY_REQUIRED');
  await expect(warm.generate(handle, row, ['0000000001'], 256)).rejects.toThrow('RECOVERY_REQUIRED');
});

test('ambiguous create is uncertain, never retried and never exposes body/header secrets', async () => {
  const gateway = jest.fn().mockRejectedValue(Object.assign(new Error('PRIVATE-TOKEN'), { transport: { phase: 'timeout', dispatched: true, terminal: false } }));
  const error = await createGatewaySessions(withDiscovery(gateway)).open({ correlationId: 'fresh' }).catch(e => e);
  expect(error.code).toBe('INFERENCE_UNCERTAIN'); expect(JSON.stringify(error)).not.toContain('PRIVATE'); expect(gateway).toHaveBeenCalledTimes(1);
});
