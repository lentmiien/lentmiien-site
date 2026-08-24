const mockScheduleTaskReminderService = {
  saveTaskWithReminders: jest.fn(),
  deletePendingForTask: jest.fn(),
};

jest.mock('../../services/scheduleTaskService', () => ({
  roundToSlot: jest.fn((value) => {
    const rounded = new Date(value.getTime());
    rounded.setMinutes(Math.floor(rounded.getMinutes() / 15) * 15, 0, 0);
    return rounded;
  }),
  detectPresenceConflict: jest.fn(),
  getPalette: jest.fn(),
  getTasksForWindow: jest.fn(),
}));

jest.mock('../../services/scheduleTaskStatsService', () => ({
  getDashboardData: jest.fn(),
}));

jest.mock('../../services/pushoverReminderService', () => ({
  PUSHOVER_PRIORITY_OPTIONS: [
    { value: -1, label: 'Low', description: 'Low' },
    { value: 0, label: 'Normal', description: 'Normal' },
    { value: 1, label: 'High', description: 'High' },
  ],
}));

jest.mock('../../services/scheduleTaskReminderService', () => {
  class TaskReminderValidationError extends Error {}
  return {
    MAX_TASK_REMINDERS: 5,
    TaskReminderValidationError,
    scheduleTaskReminderService: mockScheduleTaskReminderService,
  };
});

jest.mock('../../database', () => {
  const Task = jest.fn().mockImplementation(function Task(payload) {
    Object.assign(this, payload);
    this._id = { toString: () => 'task-controller-1' };
  });
  Task.findOne = jest.fn();
  Task.find = jest.fn();
  return { Task, Palette: {} };
});

jest.mock('../../utils/logger', () => ({
  error: jest.fn().mockResolvedValue(),
  warning: jest.fn().mockResolvedValue(),
}));

const { Task } = require('../../database');
const controller = require('../../controllers/scheduleTaskController');

function createResponse() {
  const res = {
    status: jest.fn(),
    render: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('schedule task controller reminder lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleTaskReminderService.saveTaskWithReminders.mockResolvedValue({ reminders: [] });
    mockScheduleTaskReminderService.deletePendingForTask.mockResolvedValue(0);
  });

  test('maps repeated flat form fields into ordered reminder rows', () => {
    expect(controller._test.taskReminderRowsFromBody({
      reminder_anchor: ['start', 'deadline'],
      reminder_days: ['1', '0'],
      reminder_hours: ['2', '4'],
      reminder_minutes: ['15', '30'],
      reminder_priority: ['1', '-1'],
    })).toEqual([
      { anchor: 'start', days: '1', hours: '2', minutes: '15', priority: '1' },
      { anchor: 'deadline', days: '0', hours: '4', minutes: '30', priority: '-1' },
    ]);
    expect(controller._test.taskReminderRowsFromBody({})).toEqual([]);
  });

  test('creates a task and its optional reminders through the shared service', async () => {
    const req = {
      user: { name: 'Lennart' },
      body: {
        title: 'Pay invoice',
        description: 'Before the deadline',
        type: 'todo',
        start: '2030-06-10T09:07',
        end: '2030-06-12T17:00',
        reminder_anchor: ['start', 'deadline'],
        reminder_days: ['0', '1'],
        reminder_hours: ['1', '0'],
        reminder_minutes: ['0', '30'],
        reminder_priority: ['0', '1'],
      },
    };
    const res = createResponse();

    await controller.saveTask(req, res, jest.fn());

    const task = Task.mock.instances[0];
    expect(task).toMatchObject({
      userId: 'Lennart',
      type: 'todo',
      start: new Date('2030-06-10T09:00'),
      end: new Date('2030-06-12T17:00'),
      done: false,
    });
    expect(mockScheduleTaskReminderService.saveTaskWithReminders).toHaveBeenCalledWith(task, [
      { anchor: 'start', days: '0', hours: '1', minutes: '0', priority: '0' },
      { anchor: 'deadline', days: '1', hours: '0', minutes: '30', priority: '1' },
    ]);
    expect(res.redirect).toHaveBeenCalledWith('/scheduleTask/calendar');
  });

  test('completing a task deletes its remaining pending reminders', async () => {
    const task = {
      _id: { toString: () => 'task-controller-1' },
      userId: 'Lennart',
      done: true,
      save: jest.fn().mockResolvedValue(),
    };
    Task.findOne.mockResolvedValue(task);
    mockScheduleTaskReminderService.deletePendingForTask.mockResolvedValue(2);
    const req = {
      user: { name: 'Lennart' },
      params: { id: 'task-controller-1' },
      body: { done: true },
    };
    const res = createResponse();

    await controller.toggleDoneApi(req, res, jest.fn());

    expect(mockScheduleTaskReminderService.deletePendingForTask)
      .toHaveBeenCalledWith('Lennart', task._id);
    expect(task.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      done: true,
      deletedReminders: 2,
    });
  });

  test('the general task update endpoint also cleans reminders when it sets done', async () => {
    const task = {
      _id: { toString: () => 'task-controller-1' },
      userId: 'Lennart',
      type: 'todo',
      done: false,
      save: jest.fn().mockResolvedValue(),
    };
    Task.findOne.mockResolvedValue(task);
    mockScheduleTaskReminderService.deletePendingForTask.mockResolvedValue(1);
    const req = {
      user: { name: 'Lennart' },
      params: { id: 'task-controller-1' },
      body: { done: true },
    };
    const res = createResponse();

    await controller.updateTaskApi(req, res, jest.fn());

    expect(task.save).toHaveBeenCalledTimes(1);
    expect(mockScheduleTaskReminderService.deletePendingForTask)
      .toHaveBeenCalledWith('Lennart', task._id);
    expect(res.json).toHaveBeenCalledWith({ ok: true, deletedReminders: 1 });
  });

  test('reopening a task does not delete reminders', async () => {
    const task = {
      _id: 'task-controller-1',
      userId: 'Lennart',
      done: false,
      save: jest.fn().mockResolvedValue(),
    };
    Task.findOne.mockResolvedValue(task);
    const req = {
      user: { name: 'Lennart' },
      params: { id: 'task-controller-1' },
      body: { done: false },
    };
    const res = createResponse();

    await controller.toggleDoneApi(req, res, jest.fn());

    expect(mockScheduleTaskReminderService.deletePendingForTask).not.toHaveBeenCalled();
    expect(task.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ ok: true, done: false, deletedReminders: 0 });
  });

  test('deleting a task also deletes its pending reminders', async () => {
    const task = {
      _id: { toString: () => 'task-controller-1' },
      userId: 'Lennart',
      type: 'todo',
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    Task.findOne.mockResolvedValue(task);
    const req = {
      user: { name: 'Lennart' },
      params: { id: 'task-controller-1' },
    };
    const res = createResponse();

    await controller.deleteTask(req, res, jest.fn());

    expect(Task.findOne).toHaveBeenCalledWith({
      _id: 'task-controller-1',
      userId: 'Lennart',
    });
    expect(mockScheduleTaskReminderService.deletePendingForTask)
      .toHaveBeenCalledWith('Lennart', task._id);
    expect(task.deleteOne).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/scheduleTask/upcoming');
  });
});
