jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../services/pushoverReminderService', () => ({
  pushoverReminderService: {
    processDueReminders: jest.fn(),
    deleteExpiredHistory: jest.fn(),
  },
}));

const {
  REMINDER_POLL_INTERVAL_MS,
  createPushoverReminderRunner,
} = require('../../schedulers/pushoverReminders');

describe('Pushover reminder scheduler', () => {
  test('uses an exact one-minute polling interval', () => {
    expect(REMINDER_POLL_INTERVAL_MS).toBe(60_000);
  });

  test('processes due reminders and three-month cleanup with the same tick time', async () => {
    const now = new Date('2026-08-23T03:05:00.000Z');
    const reminderService = {
      processDueReminders: jest.fn().mockResolvedValue({ claimed: 2, sent: 2, failed: 0 }),
      deleteExpiredHistory: jest.fn().mockResolvedValue(3),
    };
    const tick = createPushoverReminderRunner({
      reminderService,
      clock: () => now,
      log: { error: jest.fn() },
    });

    await expect(tick('test')).resolves.toEqual({
      skipped: false,
      delivery: { claimed: 2, sent: 2, failed: 0 },
      removed: 3,
    });
    expect(reminderService.processDueReminders).toHaveBeenCalledWith(now);
    expect(reminderService.deleteExpiredHistory).toHaveBeenCalledWith(now);
  });

  test('skips an overlapping tick while the prior database check is running', async () => {
    let finishProcessing;
    const processing = new Promise((resolve) => {
      finishProcessing = resolve;
    });
    const reminderService = {
      processDueReminders: jest.fn().mockReturnValue(processing),
      deleteExpiredHistory: jest.fn().mockResolvedValue(0),
    };
    const tick = createPushoverReminderRunner({
      reminderService,
      log: { error: jest.fn() },
    });

    const firstTick = tick('first');
    await expect(tick('overlap')).resolves.toEqual({ skipped: true });
    finishProcessing({ claimed: 0, sent: 0, failed: 0 });
    await firstTick;

    expect(reminderService.processDueReminders).toHaveBeenCalledTimes(1);
    expect(reminderService.deleteExpiredHistory).toHaveBeenCalledTimes(1);
  });

  test('logs an actionable scheduler error and releases the runner', async () => {
    const error = new Error('database unavailable');
    const reminderService = {
      processDueReminders: jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ claimed: 0, sent: 0, failed: 0 }),
      deleteExpiredHistory: jest.fn().mockResolvedValue(0),
    };
    const log = { error: jest.fn().mockResolvedValue() };
    const tick = createPushoverReminderRunner({ reminderService, log });

    await expect(tick('scheduled')).resolves.toEqual({ skipped: false, error });
    await tick('retry');

    expect(log.error).toHaveBeenCalledWith('Pushover reminder scheduler tick failed', {
      category: 'pushover_reminders',
      metadata: {
        reason: 'scheduled',
        error: 'database unavailable',
      },
    });
    expect(reminderService.processDueReminders).toHaveBeenCalledTimes(2);
  });
});
