const { withStandaloneCreationReporting } = require('../../scripts/lib/runpodStandaloneSafety');

test.each(['pod', 'volume'])('reports an exact %s correlation before the call and never replays an unknown create', async (kind) => {
  const method = kind === 'pod' ? 'createPod' : 'createNetworkVolume';
  const stdout = jest.fn();
  const stderr = jest.fn();
  const service = { [method]: jest.fn().mockRejectedValue(new Error('synthetic-secret-provider-text')) };
  const wrapped = withStandaloneCreationReporting(service, { stdout, stderr });
  await expect(wrapped[method]({ name: 'test', env: { SECRET: 'synthetic-env-secret' } })).rejects.toThrow();
  expect(service[method]).toHaveBeenCalledTimes(1);
  expect(stdout.mock.invocationCallOrder[0]).toBeLessThan(service[method].mock.invocationCallOrder[0]);
  const payload = service[method].mock.calls[0][0];
  const correlation = kind === 'pod' ? payload.env.LENTMIIEN_CREATION_OPERATION : payload.name;
  expect(stdout.mock.calls[0][0]).toContain(correlation);
  expect(stderr.mock.calls[0][0]).toContain('UNKNOWN');
  expect(wrapped.standaloneUnresolvedCreates.has(kind)).toBe(true);
  expect(JSON.stringify([stdout.mock.calls, stderr.mock.calls])).not.toContain('synthetic-');
});

test('reports exact successful ID and preserves caller environment', async () => {
  const service = { createPod: jest.fn().mockResolvedValue({ id: 'pod-1' }) };
  const stdout = jest.fn();
  const wrapped = withStandaloneCreationReporting(service, { stdout, stderr: jest.fn() });
  await wrapped.createPod({ env: { EXISTING: 'kept' } });
  expect(service.createPod.mock.calls[0][0].env.EXISTING).toBe('kept');
  expect(stdout.mock.calls[1][0]).toContain('provider ID pod-1');
  expect(wrapped.standaloneUnresolvedCreates.size).toBe(0);
});

test('reports known local deferral without claiming an ambiguous paid resource', async () => {
  const service = { createPod: jest.fn().mockRejectedValue({ code: 'RUNPOD_COOLDOWN' }) };
  const stderr = jest.fn();
  const wrapped = withStandaloneCreationReporting(service, { stdout: jest.fn(), stderr });
  await expect(wrapped.createPod({})).rejects.toMatchObject({ code: 'RUNPOD_COOLDOWN' });
  expect(stderr.mock.calls[0][0]).toContain('rejected or deferred');
  expect(wrapped.standaloneUnresolvedCreates.size).toBe(0);
});
