const { createRunpodPodGuardRunner } = require('../../schedulers/runpodPodGuard');

describe('Runpod automatic Pod cost guard', () => {
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
