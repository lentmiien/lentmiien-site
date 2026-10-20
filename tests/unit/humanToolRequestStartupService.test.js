const {
  recoverInterruptedHumanToolResponses,
  scheduleHumanToolRequestRecovery,
} = require('../../services/humanToolRequestStartupService');

describe('human tool request startup recovery', () => {
  test('reports requeued answered calls without logging private content', async () => {
    const service = {
      recoverInterruptedResponses: jest.fn().mockResolvedValue({
        expiredCount: 1,
        matchedCount: 2,
        modifiedCount: 2,
      }),
    };
    const log = {
      notice: jest.fn().mockResolvedValue(),
      error: jest.fn().mockResolvedValue(),
    };

    await expect(recoverInterruptedHumanToolResponses({ service, log })).resolves.toEqual({
      expiredCount: 1,
      matchedCount: 2,
      modifiedCount: 2,
    });
    expect(log.notice).toHaveBeenCalledWith(
      'Reconciled durable human tool calls',
      { category: 'human_tool_request', metadata: { expired: 1, requeued: 2 } }
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  test('contains startup failures and logs only the error type', async () => {
    const secret = 'private response text';
    const service = {
      recoverInterruptedResponses: jest.fn().mockRejectedValue(new Error(secret)),
    };
    const log = {
      notice: jest.fn(),
      error: jest.fn().mockResolvedValue(),
    };

    const result = await recoverInterruptedHumanToolResponses({ service, log });

    expect(result).toMatchObject({ expiredCount: 0, modifiedCount: 0, error: secret });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(secret);
    expect(log.error).toHaveBeenCalledWith(
      'Failed to reconcile durable human tool calls',
      { category: 'human_tool_request', metadata: { errorName: 'Error' } }
    );
  });

  test('runs recovery immediately and on a bounded interval', async () => {
    const service = {
      recoverInterruptedResponses: jest.fn().mockResolvedValue({
        expiredCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
      }),
    };
    const log = { notice: jest.fn(), error: jest.fn() };
    const handle = { unref: jest.fn() };
    const setIntervalFn = jest.fn(() => handle);

    expect(scheduleHumanToolRequestRecovery({
      service,
      log,
      env: { HUMAN_TOOL_RECOVERY_INTERVAL_MS: '1000' },
      setIntervalFn,
      ready: () => true,
    })).toBe(handle);
    await Promise.resolve();

    expect(service.recoverInterruptedResponses).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15000);
    expect(handle.unref).toHaveBeenCalledTimes(1);
  });

  test('pauses recurring recovery while MongoDB is unavailable and resumes without overlap', async () => {
    let ready = false, scheduled, finish;
    const service = { recoverInterruptedResponses: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
    const log = { notice: jest.fn(), error: jest.fn() };
    scheduleHumanToolRequestRecovery({ service, log, ready: () => ready,
      setIntervalFn: callback => { scheduled = callback; return {}; } });
    await scheduled();
    expect(service.recoverInterruptedResponses).not.toHaveBeenCalled();
    ready = true;
    const pending = scheduled();
    await scheduled();
    expect(service.recoverInterruptedResponses).toHaveBeenCalledTimes(1);
    ready = false;
    finish({ modifiedCount: 0, expiredCount: 0 });
    await pending;
    await scheduled();
    expect(service.recoverInterruptedResponses).toHaveBeenCalledTimes(1);
    ready = true;
    const resumed = scheduled();
    finish({ modifiedCount: 1, expiredCount: 0 });
    await resumed;
    expect(service.recoverInterruptedResponses).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });
});
