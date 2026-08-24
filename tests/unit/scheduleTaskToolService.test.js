jest.mock('../../database', () => {
  const taskSave = jest.fn().mockResolvedValue();
  const Task = jest.fn().mockImplementation(function Task(payload) {
    Object.assign(this, payload, {
      _id: { toString: () => 'task-tool-1' },
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    this.save = taskSave;
  });
  Task.find = jest.fn();
  return {
    Task,
    Palette: { find: jest.fn() },
    QuicknoteModel: jest.fn(),
  };
});

const { Task } = require('../../database');
const ScheduleTaskToolService = require('../../services/scheduleTaskToolService');

describe('schedule task Tool Manager service reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['createTodo', 'todo'],
    ['createTobuy', 'tobuy'],
  ])('%s always uses zero reminders for backward compatibility', async (method, type) => {
    const taskReminderService = {
      saveTaskWithReminders: jest.fn(async (task) => ({ task, reminders: [] })),
    };
    const service = new ScheduleTaskToolService({ taskReminderService });

    const result = await service[method]({
      title: 'Legacy tool task',
      reminders: [{ anchor: 'start' }],
    }, { toolName: 'legacy-tool' });

    expect(taskReminderService.saveTaskWithReminders).toHaveBeenCalledWith(
      expect.objectContaining({ type }),
      []
    );
    expect(result).not.toHaveProperty('reminders');
    expect(result.task.type).toBe(type);
  });

  test('the reminder-aware todo tool passes reminder arrays and returns created reminders', async () => {
    const reminder = {
      _id: { toString: () => 'reminder-tool-1' },
      scheduledFor: new Date('2030-05-10T08:00:00.000Z'),
      priority: 1,
      metadata: {
        anchor: 'start',
        offset: { days: 0, hours: 1, minutes: 0 },
      },
    };
    const taskReminderService = {
      saveTaskWithReminders: jest.fn(async (task) => ({ task, reminders: [reminder] })),
    };
    const service = new ScheduleTaskToolService({ taskReminderService });
    const reminders = [{ anchor: 'start', hours: 1, priority: 1 }];

    const result = await service.createTodoWithReminders({
      title: 'Reminder-aware task',
      start: '2030-05-10T09:07:00.000Z',
      reminders,
    }, { toolName: 'add_todo_with_reminders' });

    expect(Task).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'Lennart',
      type: 'todo',
      start: new Date('2030-05-10T09:00:00.000Z'),
      done: false,
    }));
    expect(taskReminderService.saveTaskWithReminders).toHaveBeenCalledWith(
      expect.any(Object),
      reminders
    );
    expect(result).toMatchObject({
      ok: true,
      taskType: 'todo',
      reminderCount: 1,
      reminders: [{
        id: 'reminder-tool-1',
        scheduledFor: '2030-05-10T08:00:00.000Z',
        priority: 1,
        anchor: 'start',
        offset: { days: 0, hours: 1, minutes: 0 },
      }],
    });
  });

  test('the reminder-aware to-buy tool defaults its optional reminder array to empty', async () => {
    const taskReminderService = {
      saveTaskWithReminders: jest.fn(async (task) => ({ task, reminders: [] })),
    };
    const service = new ScheduleTaskToolService({ taskReminderService });

    const result = await service.createTobuyWithReminders({ title: 'Milk' });

    expect(taskReminderService.saveTaskWithReminders).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tobuy' }),
      []
    );
    expect(result).toMatchObject({ reminderCount: 0, reminders: [] });
  });
});
