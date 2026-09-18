const { createWarmSessions } = require('../../services/taric/warmSession');
const { BASE_MODEL, TEST_ADAPTER } = require('../../utils/taricProtocol');
const row = { descriptive_name: 'Synthetic', full_item_name: 'Synthetic', specs: '', hs_code: '950300' };
function fixture() {
  let now = 1000;
  const adapter = { open: jest.fn(async () => ({ id: 'synthetic-id', ownerToken: 'PRIVATE-CAPABILITY', expiresAt: now + 90000, hardExpiresAt: now + 180000 })),
    renew: jest.fn(async () => ({ expiresAt: now + 90000 })),
    generate: jest.fn(async () => ({ model: BASE_MODEL, adapter_name: TEST_ADAPTER, content: '{"taric_code":"0000000001","description":"Synthetic"}', reasoning: 'hidden' })),
    status: jest.fn(async ({ correlationId }) => ({ idle: true, terminal: true, correlationId })),
    close: jest.fn(async () => ({ idle: true })), probe: jest.fn(async () => ({ idle: true, secret: 'hidden' })) };
  return { adapter, sessions: createWarmSessions(adapter, { now: () => now, timeoutMs: 10 }), advance: ms => { now += ms; } };
}
test('missing feature fails closed without operator reservation or cold generation fallback', async () => {
  const sessions = createWarmSessions(); expect(sessions.ready()).toBe(false);
  await expect(sessions.open({})).rejects.toThrow('WARM_SESSION_NOT_READY');
});
test('only the original opaque owner handle can generate or release; capability never serializes', async () => {
  const { sessions, adapter } = fixture(); const handle = await sessions.open({ correlationId: 'a'.repeat(32) });
  expect(JSON.stringify(handle)).not.toContain('PRIVATE');
  await expect(sessions.close({ ...handle })).rejects.toThrow('FORBIDDEN');
  const onDiagnostics = jest.fn();
  await expect(sessions.generate(handle, row, ['0000000001'], 256, { onDiagnostics })).resolves.toMatchObject({ taric_code: '0000000001' });
  expect(JSON.stringify(onDiagnostics.mock.calls)).not.toContain('hidden');
  expect(await sessions.status(handle, 'a'.repeat(32))).toEqual({ idle: true, terminal: true, correlated: true });
  await sessions.renew(handle); await sessions.close(handle);
  expect(adapter.close.mock.calls[0][0].session.ownerToken).toBe('PRIVATE-CAPABILITY');
  await expect(sessions.close(handle)).rejects.toThrow('FORBIDDEN');
});
test('expired handles cannot generate or renew; own release remains permitted', async () => {
  const { sessions, advance, adapter } = fixture(); const handle = await sessions.open({}); advance(90001);
  await expect(sessions.generate(handle, row, ['0000000001'], 256)).rejects.toThrow('RECOVERY_REQUIRED');
  await expect(sessions.renew(handle)).rejects.toThrow('RECOVERY_REQUIRED');
  await sessions.close(handle); expect(adapter.generate).not.toHaveBeenCalled();
});
test('open hard budget violations and lost remote response remain uncertain; no owner guessing', async () => {
  const { sessions, adapter } = fixture(); adapter.open.mockResolvedValue({ id: 'id', expiresAt: 90000, hardExpiresAt: 999999 });
  await expect(sessions.open({})).rejects.toThrow('INFERENCE_UNCERTAIN'); expect(adapter.close).not.toHaveBeenCalled();
  adapter.open.mockImplementation(() => new Promise(() => {}));
  await expect(sessions.open({})).rejects.toThrow('INFERENCE_UNCERTAIN');
});
test('status does not trust unrelated completion and probe strips provider data', async () => {
  const { sessions, adapter } = fixture(); const handle = await sessions.open({});
  adapter.status.mockResolvedValue({ idle: true, terminal: true, correlationId: 'other' });
  expect((await sessions.status(handle, 'a'.repeat(32))).correlated).toBe(false);
  expect(await sessions.probe()).toEqual({ idle: true, observedAt: new Date(1000).toISOString() });
});

test('local lease abort returns promptly even when adapter ignores abort; remote outcome remains uncertain', async () => {
  const { sessions, adapter } = fixture(); const handle = await sessions.open({});
  adapter.generate.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const promise = sessions.generate(handle, row, ['0000000001'], 256, { signal: controller.signal, correlationId: 'a'.repeat(32) });
  controller.abort();
  await expect(promise).rejects.toMatchObject({ code: 'INFERENCE_UNCERTAIN', transport: { phase: 'clientabort', dispatched: true, terminal: false } });
  await sessions.close(handle);
});
