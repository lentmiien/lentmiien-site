const controller = require('../../controllers/pushoverReminderController');
const {
  pushoverReminderService,
} = require('../../services/pushoverReminderService');

describe('Pushover reminder controller task presentation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('decorates task reminders with a task badge label', () => {
    const result = controller._test.decorateReminder({
      _id: 'reminder-1',
      title: 'To-buy task reminder',
      message: 'Buy milk',
      scheduledFor: new Date('2030-01-01T00:00:00.000Z'),
      priority: 0,
      deliveryStatus: 'pending',
      source: 'schedule-task',
      metadata: {
        taskId: 'task-1',
        taskType: 'tobuy',
        anchor: 'deadline',
      },
    });

    expect(result).toMatchObject({
      isTaskReminder: true,
      taskSourceLabel: 'To-buy task · deadline',
    });
  });

  test('rejects the edit page for task-linked reminders', async () => {
    jest.spyOn(pushoverReminderService, 'getUpcoming').mockResolvedValue({
      _id: 'reminder-1',
      source: 'schedule-task',
      metadata: { taskId: 'task-1' },
    });
    const req = {
      user: { name: 'Lennart' },
      params: { id: 'reminder-1' },
    };
    const res = { redirect: jest.fn() };

    await controller.edit(req, res, jest.fn());

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining(
      'Task+reminders+cannot+be+edited'
    ));
  });
});
