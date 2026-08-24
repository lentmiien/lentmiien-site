const {
  MAX_TASK_REMINDERS,
  ScheduleTaskReminderService,
  TaskReminderValidationError,
  isTaskLinkedReminder,
} = require('../../services/scheduleTaskReminderService');

function createTask(overrides = {}) {
  return {
    _id: { toString: () => 'task-123' },
    userId: 'Lennart',
    type: 'todo',
    title: 'Submit expense report',
    start: new Date('2030-05-10T09:00:00.000Z'),
    end: new Date('2030-05-12T12:30:00.000Z'),
    save: jest.fn().mockResolvedValue(),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };
}

describe('schedule task Pushover reminder service', () => {
  const now = new Date('2030-05-01T00:00:00.000Z');

  test('calculates start/deadline offsets and adds task-link metadata', () => {
    const service = new ScheduleTaskReminderService({ ReminderModel: {} });
    const records = service.buildReminderRecords(createTask(), [
      { anchor: 'start', days: 1, hours: 2, minutes: 15, priority: 1 },
      { anchor: 'deadline', days: 0, hours: 3, minutes: 30, priority: -1 },
    ], { now });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      user: 'Lennart',
      title: 'Todo task reminder',
      message: 'Submit expense report',
      scheduledFor: new Date('2030-05-09T06:45:00.000Z'),
      priority: 1,
      source: 'schedule-task',
      done: false,
      deliveryStatus: 'pending',
      metadata: {
        origin: 'schedule-task',
        taskId: 'task-123',
        taskType: 'todo',
        taskTitle: 'Submit expense report',
        anchor: 'start',
        anchorAt: '2030-05-10T09:00:00.000Z',
        offset: { days: 1, hours: 2, minutes: 15 },
      },
    });
    expect(records[1].scheduledFor).toEqual(new Date('2030-05-12T09:00:00.000Z'));
    expect(records[1].metadata.anchor).toBe('deadline');
  });

  test('treats missing reminder arrays as zero reminders even without task dates', async () => {
    const ReminderModel = { insertMany: jest.fn() };
    const service = new ScheduleTaskReminderService({ ReminderModel });
    const task = createTask({ start: null, end: null });

    await expect(service.saveTaskWithReminders(task)).resolves.toEqual({
      task,
      reminders: [],
    });
    expect(task.save).toHaveBeenCalledTimes(1);
    expect(ReminderModel.insertMany).not.toHaveBeenCalled();
  });

  test('requires the selected anchor and a future calculated trigger time', () => {
    const service = new ScheduleTaskReminderService({ ReminderModel: {} });

    expect(() => service.buildReminderRecords(
      createTask({ start: null }),
      [{ anchor: 'start' }],
      { now }
    )).toThrow('task has no start date');

    expect(() => service.buildReminderRecords(
      createTask({ start: new Date('2030-05-01T00:30:00.000Z') }),
      [{ anchor: 'start', hours: 1 }],
      { now }
    )).toThrow('future');
  });

  test('enforces five reminders and bounded whole-number offsets', () => {
    const service = new ScheduleTaskReminderService({ ReminderModel: {} });
    const tooMany = Array.from({ length: MAX_TASK_REMINDERS + 1 }, () => ({ anchor: 'start' }));

    expect(() => service.buildReminderRecords(createTask(), tooMany, { now }))
      .toThrow(TaskReminderValidationError);
    expect(() => service.buildReminderRecords(
      createTask(),
      [{ anchor: 'start', hours: 24 }],
      { now }
    )).toThrow('hours must be a whole number from 0 to 23');
    expect(() => service.buildReminderRecords(
      createTask(),
      [{ anchor: 'start', minutes: 1.5 }],
      { now }
    )).toThrow('minutes must be a whole number');
  });

  test('saves a task and inserts all prepared reminders together', async () => {
    const inserted = [{ _id: 'reminder-1' }];
    const ReminderModel = {
      insertMany: jest.fn().mockResolvedValue(inserted),
      deleteMany: jest.fn(),
    };
    const service = new ScheduleTaskReminderService({ ReminderModel });
    const task = createTask();

    await expect(service.saveTaskWithReminders(
      task,
      [{ anchor: 'deadline', minutes: 30, priority: 2 }],
      { now }
    )).resolves.toEqual({ task, reminders: inserted });
    expect(task.save).toHaveBeenCalledTimes(1);
    expect(ReminderModel.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        scheduledFor: new Date('2030-05-12T12:00:00.000Z'),
        priority: 2,
      }),
    ], { ordered: true });
  });

  test('rolls back a task and any partial reminders when reminder persistence fails', async () => {
    const insertError = new Error('insert failed');
    const ReminderModel = {
      insertMany: jest.fn().mockRejectedValue(insertError),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const log = { error: jest.fn().mockResolvedValue() };
    const service = new ScheduleTaskReminderService({ ReminderModel, log });
    const task = createTask();

    await expect(service.saveTaskWithReminders(
      task,
      [{ anchor: 'start' }],
      { now }
    )).rejects.toBe(insertError);
    expect(ReminderModel.deleteMany).toHaveBeenCalledWith({
      user: 'Lennart',
      source: 'schedule-task',
      'metadata.taskId': 'task-123',
    });
    expect(task.deleteOne).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      'Failed to create task-linked Pushover reminders',
      expect.objectContaining({ category: 'schedule_task_reminders' })
    );
  });

  test('deletes only pending untriggered reminders linked to the selected task', async () => {
    const ReminderModel = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    };
    const service = new ScheduleTaskReminderService({ ReminderModel });

    await expect(service.deletePendingForTask('Lennart', 'task-123')).resolves.toBe(3);
    expect(ReminderModel.deleteMany).toHaveBeenCalledWith({
      user: 'Lennart',
      source: 'schedule-task',
      'metadata.taskId': 'task-123',
      done: false,
      deliveryStatus: 'pending',
    });
  });

  test('recognizes task-linked reminders without changing legacy reminders', () => {
    expect(isTaskLinkedReminder({ source: 'schedule-task' })).toBe(true);
    expect(isTaskLinkedReminder({ source: 'manual' })).toBe(false);
    expect(isTaskLinkedReminder({})).toBe(false);
  });
});
