const { remaining, publicSession, capability } = require('../../services/localAi/sessions');
const { sessionBusy, retryMs } = require('../../services/localAi/busy');
const good = () => ({ hard_remaining_seconds: 300, lease_remaining_seconds: 100, _timing: { received: 100, rtt: 39 } });
test('remaining lifetime subtracts full RTT, monotonic age and safety margin', () => {
  expect(remaining(good(), 200)).toBe(98861);
});
test.each([
  { lease_remaining_seconds: undefined }, { hard_remaining_seconds: NaN }, { lease_remaining_seconds: Infinity },
  { _timing: { received: 100, rtt: 2001 } }, { _timing: { received: NaN, rtt: 0 } }, { _timing: null },
])('malformed or stale evidence cannot authorize dispatch: %j', change => {
  expect(remaining({ ...good(), ...change }, 200)).toBe(0);
});
test('clock steps cannot freshen old responses', () => {
  expect(remaining(good(), 6000)).toBe(0); expect(remaining(good(), 99)).toBe(0);
});
test('session DTO excludes authority and arbitrary remote fields', () => {
  const dto = publicSession({ _id: 's', state: 'held', token: 'secret', pendingRecovery: { token: 'secret' }, remote: { headers: 'secret', token: 'secret', hard_deadline: 'deadline' } });
  expect(JSON.stringify(dto)).not.toContain('secret'); expect(dto.deadline).toBe('deadline');
});
test('legacy capabilities cannot silently downgrade new work', () => {
  expect(() => capability({ protocol: 'durable-local-ai', version: 1, enabled: true })).toThrow('exclusive_sessions_unavailable');
});
test('only definitive Gateway 409 changes the caller attempt budget', () => {
  expect(sessionBusy({ response: { status: 409, data: { detail: { code: 'gpu_batch_session_busy' } } } })).toBe(true);
  expect(sessionBusy({ code: 'gpu_batch_session_busy' })).toBe(false);
  expect(sessionBusy({ response: { status: 503, data: { detail: { code: 'gpu_batch_session_busy' } } } })).toBe(false);
  expect(retryMs({ responseHeaders: { 'retry-after': '15' } })).toBe(15000);
});

test('retained manual request identities also prevent rollback to an incompatible reader', async () => {
  await expect(require('../../services/localAi/compatibility').assertRollbackCompatible({
    Session: { exists: async () => false }, SessionRequest: { exists: async () => true },
  }, 'v1')).rejects.toMatchObject({ code: 'rollback_requires_site_sessions' });
});
