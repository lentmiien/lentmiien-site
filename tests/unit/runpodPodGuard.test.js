const { createRunpodPodGuardRunner } = require('../../schedulers/runpodPodGuard');

describe('Runpod automatic Pod cost guard', () => {
  test('failed observations still run expiry stops, throttle warnings, and report recovery counts', async () => {
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const manager = {
      syncProviderPods: jest.fn().mockRejectedValue(Object.assign(new Error('private upstream error'), {
        code: 'RUNPOD_HTTP_ERROR', status: 503,
      })),
      stopExpiredPods: jest.fn().mockResolvedValue(1),
    };
    const appLogger = { warning: jest.fn(), error: jest.fn(), notice: jest.fn() };
    const tick = createRunpodPodGuardRunner({ manager, appLogger });
    try {
      await tick();
      dateSpy.mockReturnValue(1_060_000);
      await tick();
      expect(manager.stopExpiredPods).toHaveBeenCalledTimes(2);
      expect(appLogger.warning).toHaveBeenCalledTimes(1);
      expect(appLogger.warning.mock.calls[0][1].metadata).toMatchObject({ failedTicks: 1, providerStatus: 503 });
      manager.syncProviderPods.mockResolvedValue({ updated: 1 });
      dateSpy.mockReturnValue(1_120_000);
      await tick();
      await tick();
      expect(appLogger.notice).toHaveBeenCalledTimes(1);
      expect(appLogger.notice).toHaveBeenCalledWith(
        'Runpod usage observer recovered provider state',
        { category: 'runpod_management', metadata: { failedTicks: 2, durationMs: 120_000 } },
      );
      expect(JSON.stringify(appLogger.warning.mock.calls)).not.toContain('private upstream');
    } finally { dateSpy.mockRestore(); }
  });
  test('observes provider state before applying automatic stops', async () => {
    const manager = {
      syncProviderPods: jest.fn().mockResolvedValue({ imported: 0, updated: 1, archived: 0 }),
      stopExpiredPods: jest.fn().mockResolvedValue(0),
    };
    const tick = createRunpodPodGuardRunner({
      manager,
      appLogger: { warning: jest.fn(), error: jest.fn() },
    });

    await expect(tick('scheduled')).resolves.toEqual({
      skipped: false,
      stopped: 0,
      synchronized: { imported: 0, updated: 1, archived: 0 },
    });
    expect(manager.syncProviderPods).toHaveBeenCalledWith(
      { name: 'runpod-state-observer' },
      { recordEvent: false }
    );
    expect(manager.syncProviderPods.mock.invocationCallOrder[0])
      .toBeLessThan(manager.stopExpiredPods.mock.invocationCallOrder[0]);
  });

  test('stops expired Pods and prevents overlapping ticks', async () => {
    let release;
    const manager = {
      stopExpiredPods: jest.fn().mockReturnValue(new Promise((resolve) => {
        release = resolve;
      })),
    };
    const tick = createRunpodPodGuardRunner({ manager, appLogger: { error: jest.fn() } });

    const first = tick('scheduled');
    await expect(tick('scheduled')).resolves.toEqual({ skipped: true });
    release(1);

    await expect(first).resolves.toEqual({ skipped: false, stopped: 1 });
    expect(manager.stopExpiredPods).toHaveBeenCalledTimes(1);
  });

  test('reports a safe actionable error and allows the next tick', async () => {
    const secret = 'database-credentials';
    const manager = {
      stopExpiredPods: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error(secret), { code: 'RUNPOD_STOP_FAILED' }))
        .mockResolvedValueOnce(0),
    };
    const appLogger = { error: jest.fn() };
    const tick = createRunpodPodGuardRunner({ manager, appLogger });

    await expect(tick('startup')).resolves.toEqual(expect.objectContaining({ skipped: false }));
    await expect(tick('scheduled')).resolves.toEqual({ skipped: false, stopped: 0 });

    expect(appLogger.error).toHaveBeenCalledWith(
      'Runpod automatic cost guard tick failed',
      {
        category: 'runpod_management',
        metadata: { reason: 'startup', errorCode: 'RUNPOD_STOP_FAILED' },
      }
    );
    expect(JSON.stringify(appLogger.error.mock.calls)).not.toContain(secret);
  });
});
