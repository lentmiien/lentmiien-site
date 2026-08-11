jest.mock('../../services/codexLogReviewWorkflowService', () => ({
  codexLogReviewWorkflowService: { tick: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../utils/pushover', () => ({
  PUSHOVER_PRIORITIES: { MEDIUM: 0 },
  sendPushoverNotification: jest.fn(),
}));

const {
  createCodexLogReviewRunner,
  getIntervalMs,
} = require('../../schedulers/codexLogReview');

describe('Codex log review scheduler', () => {
  test('uses a one-minute poll and enforces a safe minimum', () => {
    expect(getIntervalMs(undefined)).toBe(60_000);
    expect(getIntervalMs('1000')).toBe(30_000);
    expect(getIntervalMs('120000')).toBe(120_000);
  });

  test('notifies only after three consecutive scheduler errors', async () => {
    const error = new Error('database unavailable');
    const workflowService = { tick: jest.fn().mockRejectedValue(error) };
    const notificationSender = jest.fn().mockResolvedValue({ status: 1 });
    const log = { error: jest.fn().mockResolvedValue() };
    const tick = createCodexLogReviewRunner({ workflowService, notificationSender, log });

    await tick('test-1');
    await tick('test-2');
    expect(notificationSender).not.toHaveBeenCalled();
    await tick('test-3');
    await tick('test-4');

    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(notificationSender).toHaveBeenCalledWith(expect.objectContaining({
      priority: 0,
      message: expect.stringContaining('failed 3 times'),
    }));
  });
});
