const { RunpodCreationIntentService, CORRELATION_ENV, RECOVERY_LEASE_MS } = require('../../services/runpodCreationIntentService');

function fixture() {
  const rows = new Map();
  const model = {
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const row = rows.get(filter._id);
      if (row && row.state !== filter.state) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.set(filter._id, { ...update.$set });
      return rows.get(filter._id);
    }),
    updateOne: jest.fn(async (filter, update) => {
      const row = rows.get(filter._id);
      if (!row || row.token !== filter.token) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    }),
    find: jest.fn(() => ({ limit: () => ({ lean: async () => [...rows.values()].filter((r) => r.state !== 'resolved').map((r) => ({ ...r })) }) })),
  };
  const appLogger = { warning: jest.fn(), error: jest.fn() };
  let now = new Date('2026-10-20T00:00:00Z');
  const service = new RunpodCreationIntentService({ model, appLogger, now: () => now });
  const context = {
    runpodService: {
      listPods: jest.fn().mockResolvedValue([]), getPod: jest.fn(), deletePod: jest.fn().mockResolvedValue(true),
      listNetworkVolumes: jest.fn().mockResolvedValue([]), getNetworkVolume: jest.fn(), deleteNetworkVolume: jest.fn().mockResolvedValue(true),
    },
    podModel: { findOne: jest.fn(() => ({ lean: async () => null })), updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) },
    networkVolumeModel: { findOne: jest.fn(() => ({ lean: async () => null })) },
  };
  return { service, context, rows, model, appLogger, now: () => now, advance: (ms) => { now = new Date(+now + ms); } };
}

describe('durable Runpod creation recovery', () => {
  test('atomically blocks duplicate creates across service instances and retains original deadline', async () => {
    const f = fixture();
    const deadline = new Date(+f.now() + 60_000);
    const intent = await f.service.begin('pod', 'original', deadline);
    const restarted = new RunpodCreationIntentService({ model: f.model, appLogger: f.appLogger, now: f.now });
    await expect(restarted.begin('pod', 'again')).rejects.toMatchObject({ code: 'RUNPOD_CREATION_UNRESOLVED' });
    expect(f.rows.get('pod').intendedStopAt).toEqual(deadline);
    expect(f.service.payload(intent, { name: 'original', env: { EXISTING: 'kept' } })).toEqual({ name: 'original', env: { EXISTING: 'kept', [CORRELATION_ENV]: intent.token } });
  });
  test('a failed intent write blocks provider work and does not expose database diagnostics', async () => {
    const f = fixture();
    f.model.findOneAndUpdate.mockRejectedValue(new Error('secret database URI'));
    await expect(f.service.begin('pod', 'name')).rejects.toMatchObject({ code: 'RUNPOD_INTENT_PERSIST_FAILED' });
    expect(JSON.stringify(f.appLogger.error.mock.calls)).not.toContain('secret database URI');
  });
  test('unknown creation with no exact match stays blocked, including after restart', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    await f.service.failed(intent, new Error('timeout'));
    f.context.runpodService.listPods.mockResolvedValue([{ id: 'unrelated', name: 'name' }]);
    const restarted = new RunpodCreationIntentService({ model: f.model, appLogger: f.appLogger, now: f.now });
    await restarted.reconcile(f.context);
    expect(f.rows.get('pod').state).toBe('unknown');
    expect(f.context.runpodService.deletePod).not.toHaveBeenCalled();
    await expect(restarted.begin('pod', 'name')).rejects.toMatchObject({ code: 'RUNPOD_CREATION_UNRESOLVED' });
  });
  test('restart recovers a persisted request after its lease and re-reads exact identity before cleanup', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    const pod = { id: 'created', env: { [CORRELATION_ENV]: intent.token } };
    f.context.runpodService.listPods.mockResolvedValueOnce([pod]).mockResolvedValueOnce([]);
    f.context.runpodService.getPod.mockResolvedValueOnce(pod).mockRejectedValueOnce({ status: 404 });
    const restarted = new RunpodCreationIntentService({ model: f.model, appLogger: f.appLogger, now: f.now });
    await restarted.reconcile(f.context);
    expect(f.context.runpodService.getPod).not.toHaveBeenCalled();
    f.advance(RECOVERY_LEASE_MS);
    await restarted.reconcile(f.context);
    expect(f.context.runpodService.getPod).toHaveBeenCalledWith('created');
    expect(f.context.runpodService.deletePod).toHaveBeenCalledWith('created');
    expect(f.rows.get('pod').state).toBe('resolved');
  });
  test('refuses cleanup when the exact re-read no longer carries the operation identifier', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    await f.service.failed(intent, new Error());
    f.context.runpodService.listPods.mockResolvedValue([{ id: 'created', env: { [CORRELATION_ENV]: intent.token } }]);
    f.context.runpodService.getPod.mockResolvedValue({ id: 'created', env: {} });
    await f.service.reconcile(f.context);
    expect(f.context.runpodService.deletePod).not.toHaveBeenCalled();
    expect(f.rows.get('pod').state).toBe('unknown');
  });
  test('recovers a locally persisted pod, restores only a missing deadline and does not delete it', async () => {
    const f = fixture();
    const deadline = new Date(+f.now() + 60_000);
    const intent = await f.service.begin('pod', 'name', deadline);
    await f.service.failed(intent, new Error());
    f.context.runpodService.listPods.mockResolvedValue([{ id: 'created', env: { [CORRELATION_ENV]: intent.token } }]);
    f.context.podModel.findOne.mockReturnValue({ lean: async () => ({ _id: 'local', recordOrigin: 'managed', autoStopAt: null }) });
    await f.service.reconcile(f.context);
    expect(f.context.podModel.updateOne).toHaveBeenCalledWith({ _id: 'local', autoStopAt: null }, { $set: { autoStopAt: deadline } });
    expect(f.context.runpodService.deletePod).not.toHaveBeenCalled();
    expect(f.rows.get('pod').state).toBe('resolved');
  });
  test('uses a random exact volume name and will not delete a volume attached after creation', async () => {
    const f = fixture();
    const intent = await f.service.begin('volume', 'models');
    const payload = f.service.payload(intent, { name: 'models', size: 10 });
    expect(payload.name).toBe(`models-${intent.token}`);
    expect(payload).not.toHaveProperty('idempotencyKey');
    await f.service.failed(intent, new Error());
    const volume = { id: 'volume', name: payload.name };
    f.context.runpodService.listNetworkVolumes.mockResolvedValue([volume]);
    f.context.runpodService.getNetworkVolume.mockResolvedValue(volume);
    f.context.runpodService.listPods.mockResolvedValue([{ mounts: { network: [{ volumeId: 'volume' }] } }]);
    await f.service.reconcile(f.context);
    expect(f.context.runpodService.deleteNetworkVolume).not.toHaveBeenCalled();
    expect(f.rows.get('volume').state).toBe('unknown');
  });
  test('does not claim cleanup succeeded on a timeout or database failure', async () => {
    const f = fixture();
    const intent = await f.service.begin('volume', 'models');
    await f.service.failed(intent, new Error());
    const volume = { id: 'volume', name: intent.providerName };
    f.context.runpodService.listNetworkVolumes.mockResolvedValue([volume]);
    f.context.runpodService.getNetworkVolume.mockResolvedValue(volume);
    f.context.runpodService.deleteNetworkVolume.mockRejectedValue(new Error('secret'));
    await f.service.reconcile(f.context);
    expect(f.rows.get('volume').state).toBe('unknown');
    expect(f.appLogger.warning).toHaveBeenCalled();
    expect(JSON.stringify(f.appLogger.warning.mock.calls)).not.toContain('secret');
    f.model.updateOne.mockRejectedValue(new Error('db failed'));
    await f.service.failed(intent, new Error());
    expect(f.rows.get('volume').state).toBe('unknown');
  });
  test('an observed create ID absent from the list is not evidence that rollback succeeded', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    await f.service.observed(intent, { id: 'created' });
    await f.service.failed(intent, new Error('local db failed'));
    f.context.runpodService.getPod.mockRejectedValue({ status: 404 });
    await f.service.reconcile(f.context);
    expect(f.rows.get('pod').state).toBe('unknown');
    await expect(f.service.begin('pod', 'again')).rejects.toMatchObject({ code: 'RUNPOD_CREATION_UNRESOLVED' });
  });
  test('a nonterminal deletion acknowledgement retains pending cleanup until corroborated absence', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    await f.service.failed(intent, new Error());
    const pod = { id: 'created', env: { [CORRELATION_ENV]: intent.token } };
    f.context.runpodService.listPods.mockResolvedValue([pod]);
    f.context.runpodService.getPod.mockResolvedValue(pod);
    await f.service.reconcile(f.context);
    expect(f.rows.get('pod')).toMatchObject({ state: 'unknown', providerId: 'created', cleanupRequestedAt: f.now() });
    f.context.runpodService.listPods.mockResolvedValue([]);
    f.context.runpodService.getPod.mockRejectedValue({ status: 404 });
    await f.service.reconcile(f.context);
    expect(f.rows.get('pod').state).toBe('resolved');
    expect(f.context.runpodService.deletePod).toHaveBeenCalledTimes(1);
  });
  test('does not extend an existing deadline after restart', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name', new Date(+f.now() + 3_600_000));
    await f.service.failed(intent, new Error());
    f.context.runpodService.listPods.mockResolvedValue([{ id: 'created', env: { [CORRELATION_ENV]: intent.token } }]);
    f.context.podModel.findOne.mockReturnValue({ lean: async () => ({ recordOrigin: 'managed', autoStopAt: new Date(+f.now() + 60_000) }) });
    await f.service.reconcile(f.context);
    expect(f.context.podModel.updateOne).not.toHaveBeenCalled();
    expect(f.rows.get('pod').state).toBe('resolved');
  });

  test('allows a new operation after a definitive provider rejection, without replay', async () => {
    const f = fixture();
    const intent = await f.service.begin('pod', 'name');
    await f.service.failed(intent, { status: 429 });
    await expect(f.service.begin('pod', 'name')).resolves.toHaveProperty('token');
  });
});
