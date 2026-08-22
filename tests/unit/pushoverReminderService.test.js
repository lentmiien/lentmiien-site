const PushoverReminder = require('../../models/pushover_reminder');
const {
  PushoverReminderService,
  ReminderValidationError,
  addUtcMonths,
  normalizeReminderInput,
} = require('../../services/pushoverReminderService');

describe('Pushover reminder service', () => {
  const now = new Date('2026-08-23T03:04:30.000Z');

  test('normalizes one exact trigger time and a Pushover priority', () => {
    const result = normalizeReminderInput({
      title: '  Water plants  ',
      message: '  Check the balcony pots.  ',
      scheduledFor: '2026-08-23T04:05:42.000Z',
      priority: '-1',
    }, { now });

    expect(result).toEqual({
      title: 'Water plants',
      message: 'Check the balcony pots.',
      scheduledFor: new Date('2026-08-23T04:05:00.000Z'),
      priority: -1,
    });
    expect(Object.keys(result)).toEqual(['title', 'message', 'scheduledFor', 'priority']);
  });

  test('rejects missing text, past times, and non-exact priority values', () => {
    expect(() => normalizeReminderInput({
      message: '',
      scheduledFor: '2026-08-23T04:05:00.000Z',
      priority: 0,
    }, { now })).toThrow(ReminderValidationError);

    expect(() => normalizeReminderInput({
      message: 'Late reminder',
      scheduledFor: '2026-08-23T03:04:59.000Z',
      priority: 0,
    }, { now })).toThrow('future');

    expect(() => normalizeReminderInput({
      message: 'Bad priority',
      scheduledFor: '2026-08-23T04:05:00.000Z',
      priority: '1abc',
    }, { now })).toThrow('valid Pushover priority');
  });

  test('calculates three calendar months without overflowing short months', () => {
    expect(addUtcMonths('2026-11-30T12:15:00.000Z', 3).toISOString())
      .toBe('2027-02-28T12:15:00.000Z');
    expect(addUtcMonths('2027-11-30T12:15:00.000Z', 3).toISOString())
      .toBe('2028-02-29T12:15:00.000Z');
  });

  test('claims a due reminder before sending and records successful delivery', async () => {
    const reminder = {
      _id: 'reminder-1',
      title: 'Dentist',
      message: 'Leave for the appointment.',
      priority: 1,
    };
    const ReminderModel = {
      findOneAndUpdate: jest.fn()
        .mockResolvedValueOnce(reminder)
        .mockResolvedValueOnce(null),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const notificationSender = jest.fn().mockResolvedValue({ status: 1 });
    const service = new PushoverReminderService({
      ReminderModel,
      notificationSender,
      log: { error: jest.fn() },
    });

    const result = await service.processDueReminders(now);

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(ReminderModel.findOneAndUpdate).toHaveBeenNthCalledWith(1, {
      done: false,
      deliveryStatus: 'pending',
      scheduledFor: { $lte: now },
    }, {
      $set: {
        done: true,
        deliveryStatus: 'sending',
        triggeredAt: now,
        historyExpiresAt: new Date('2026-11-23T03:04:30.000Z'),
      },
    }, {
      new: true,
      sort: { scheduledFor: 1, _id: 1 },
    });
    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(notificationSender).toHaveBeenCalledWith({
      title: 'Dentist',
      message: 'Leave for the appointment.',
      priority: 1,
    });
    expect(ReminderModel.updateOne).toHaveBeenCalledWith({
      _id: 'reminder-1',
      done: true,
      deliveryStatus: 'sending',
    }, {
      $set: {
        deliveryStatus: 'sent',
        sentAt: now,
        deliveryError: '',
      },
    });
  });

  test('records a failed attempt as done and never retries it on a later tick', async () => {
    const reminder = {
      _id: 'reminder-failed',
      title: 'Reminder',
      message: 'One attempt only.',
      priority: 0,
    };
    const ReminderModel = {
      findOneAndUpdate: jest.fn()
        .mockResolvedValueOnce(reminder)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const notificationSender = jest.fn().mockRejectedValue(new Error('network unavailable'));
    const log = { error: jest.fn().mockResolvedValue() };
    const service = new PushoverReminderService({ ReminderModel, notificationSender, log });

    const first = await service.processDueReminders(now);
    const second = await service.processDueReminders(new Date(now.getTime() + 60_000));

    expect(first).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(second).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(ReminderModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: {
        deliveryStatus: 'failed',
        deliveryError: 'network unavailable',
      },
    });
    expect(log.error).toHaveBeenCalledWith(
      'Pushover reminder delivery failed',
      expect.objectContaining({ category: 'pushover_reminders' })
    );
  });

  test('atomic claiming allows only one overlapping processor to send a reminder', async () => {
    let available = true;
    const ReminderModel = {
      findOneAndUpdate: jest.fn(async () => {
        if (!available) return null;
        available = false;
        return {
          _id: 'only-once',
          title: 'Atomic reminder',
          message: 'Send once.',
          priority: 0,
        };
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const notificationSender = jest.fn().mockResolvedValue({ status: 1 });
    const service = new PushoverReminderService({
      ReminderModel,
      notificationSender,
      log: { error: jest.fn() },
    });

    const results = await Promise.all([
      service.processDueReminders(now),
      service.processDueReminders(now),
    ]);

    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(notificationSender).toHaveBeenCalledTimes(1);
  });

  test('deletes completed history whose explicit retention date has passed', async () => {
    const ReminderModel = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }),
    };
    const service = new PushoverReminderService({ ReminderModel });

    await expect(service.deleteExpiredHistory(now)).resolves.toBe(4);
    expect(ReminderModel.deleteMany).toHaveBeenCalledWith({
      done: true,
      historyExpiresAt: { $lte: now },
    });
  });

  test('model enforces a single date field and configures TTL cleanup', async () => {
    const reminder = new PushoverReminder({
      user: 'test-user',
      message: 'A reminder',
      scheduledFor: new Date('2026-08-24T00:00:00.000Z'),
      priority: 2,
    });

    await expect(reminder.validate()).resolves.toBeUndefined();
    expect(reminder.done).toBe(false);
    expect(reminder.deliveryStatus).toBe('pending');
    expect(PushoverReminder.schema.path('scheduledFor')).toBeDefined();
    expect(PushoverReminder.schema.path('repeat')).toBeUndefined();
    expect(PushoverReminder.schema.indexes()).toContainEqual([
      { historyExpiresAt: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
  });
});
