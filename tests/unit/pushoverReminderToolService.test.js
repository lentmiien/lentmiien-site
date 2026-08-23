const PushoverReminderToolService = require('../../services/pushoverReminderToolService');

describe('Pushover reminder Tool Manager service', () => {
  const reminderId = '64b7f1a2c3d4e5f60718293a';

  test('sets a reminder for the user in the tool execution context', async () => {
    const reminderService = {
      create: jest.fn().mockResolvedValue({
        _id: reminderId,
        title: 'Dentist',
        message: 'Leave home.',
        scheduledFor: new Date('2026-09-01T02:30:00.000Z'),
        priority: 1,
        createdAt: new Date('2026-08-23T05:00:00.000Z'),
      }),
    };
    const service = new PushoverReminderToolService({ reminderService });

    const result = await service.setReminder({
      title: 'Dentist',
      message: 'Leave home.',
      scheduled_for: '2026-09-01T11:30:00+09:00',
      priority: 1,
    }, { userName: 'Lennart' });

    expect(reminderService.create).toHaveBeenCalledWith('Lennart', {
      title: 'Dentist',
      message: 'Leave home.',
      scheduledFor: '2026-09-01T11:30:00+09:00',
      priority: 1,
    });
    expect(result).toEqual({
      ok: true,
      user: 'Lennart',
      reminder: {
        id: reminderId,
        title: 'Dentist',
        message: 'Leave home.',
        scheduledFor: '2026-09-01T02:30:00.000Z',
        priority: 1,
        createdAt: '2026-08-23T05:00:00.000Z',
      },
    });
  });

  test('fetches pending reminders in an inclusive window and returns deletion ids', async () => {
    const reminderService = {
      listUpcomingInRange: jest.fn().mockResolvedValue([{
        _id: reminderId,
        title: 'Water plants',
        message: 'Balcony pots.',
        scheduledFor: new Date('2026-09-02T00:00:00.000Z'),
        priority: 0,
      }]),
    };
    const service = new PushoverReminderToolService({ reminderService });

    const result = await service.fetchReminders({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-03T00:00:00.000Z',
    }, { user: { name: 'Lennart' } });

    expect(reminderService.listUpcomingInRange).toHaveBeenCalledWith(
      'Lennart',
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-03T00:00:00.000Z')
    );
    expect(result.count).toBe(1);
    expect(result.reminders[0]).toMatchObject({
      id: reminderId,
      scheduledFor: '2026-09-02T00:00:00.000Z',
    });
  });

  test('rejects a reversed fetch window before querying reminders', async () => {
    const reminderService = { listUpcomingInRange: jest.fn() };
    const service = new PushoverReminderToolService({ reminderService });

    await expect(service.fetchReminders({
      from: '2026-09-03T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    }, { userName: 'Lennart' })).rejects.toThrow('to must be the same as or after from');
    expect(reminderService.listUpcomingInRange).not.toHaveBeenCalled();
  });

  test('deletes one pending reminder by the fetched id and reports missing ids', async () => {
    const reminderService = {
      remove: jest.fn()
        .mockResolvedValueOnce({
          _id: reminderId,
          title: 'Remove me',
          message: 'No longer needed.',
          scheduledFor: new Date('2026-09-02T00:00:00.000Z'),
          priority: -1,
        })
        .mockResolvedValueOnce(null),
    };
    const service = new PushoverReminderToolService({ reminderService });

    await expect(service.deleteReminder({ reminder_id: reminderId }, {
      userName: 'Lennart',
    })).resolves.toMatchObject({
      ok: true,
      deleted: true,
      reminder: { id: reminderId },
    });
    expect(reminderService.remove).toHaveBeenCalledWith('Lennart', reminderId);

    const missing = service.deleteReminder({ reminder_id: reminderId }, {
      userName: 'Lennart',
    });
    await expect(missing).rejects.toMatchObject({
      message: 'Pending Pushover reminder not found.',
      status: 404,
    });
  });
});
