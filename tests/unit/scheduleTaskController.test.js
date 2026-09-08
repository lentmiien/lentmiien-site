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

describe('upcoming planning page with the real shared layout', () => {
  const pug = require('pug');
  const { now, cases, tasks, matches } = require('../fixtures/taskDates');
  const { createRequire } = require('module');
  const { JSDOM } = createRequire(__filename)('jsdom');
  const logger = require('../../utils/logger');
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks(); });
  afterEach(() => jest.useRealTimers());

  test.each([[[]], [['Planning']]])('renders every incomplete task, far future months and navigation with groups %j', async navigationGroups => {
    const records = [...tasks, { ...tasks[0], _id: 'completed', done: true },
      { ...tasks[0], _id: 'foreign', userId: 'other' }, { ...tasks[0], _id: 'presence', type: 'presence' },
      { ...tasks[0], _id: 'escaped', title: '<script>throw new Error("injected")</script>', description: '<img src=x onerror=alert(1)>' },
      { ...tasks[0], _id: 'month-boundary', start: new Date('2026-09-30T15:00:00Z') }];
    Task.find.mockImplementation(filter => ({ lean: async () => records.filter(t => matches(t, filter)) }));
    const res = createResponse(); const next = jest.fn();
    await controller.renderUpcomingTasksPage({ user: { name: 'member' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(Task.find).toHaveBeenCalledWith({ userId: 'member', done: false, type: { $in: ['todo', 'tobuy'] } });
    const [view, locals] = res.render.mock.calls[0];
    expect(locals).not.toHaveProperty('groups');
    const html = pug.renderFile(`views/${view}.pug`, { ...locals, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [],
      navigationGroups, accountNavigation: [{ id: 'fixture-tool', label: 'Fixture tool', group: 'Planning', subgroup: 'Tasks', href: '/scheduleTask/calendar', src: '/i/fixture.png' }] });
    const dom = new JSDOM(html); const doc = dom.window.document;
    expect(doc.querySelectorAll('.task-card')).toHaveLength(tasks.length + 2);
    expect(doc.querySelector('.section-group[data-key="2028-02"]')).not.toBeNull();
    expect(doc.querySelector('.section-group[data-key="2026-10"] [data-id="month-boundary"]')).not.toBeNull();
    expect(doc.querySelector('.section-group[data-key="2026-09"] [data-id="past-start"]')).not.toBeNull();
    for (const [id, , status] of cases) {
      const card = doc.querySelector(`[data-id="${id}"]`).closest('.task-card');
      expect(card.textContent).toContain(status);
      expect(Boolean(card.closest('.section-expired'))).toBe(status === 'Overdue');
    }
    expect(doc.querySelector('[data-id="missing-both"]').closest('.task-card').textContent).toContain('Available anytimeNo deadline');
    expect(doc.querySelector('[data-id="started-future-deadline"]').closest('.task-card').querySelectorAll('time')).toHaveLength(2);
    expect(doc.querySelector('.tools-group [data-tool-id="fixture-tool"]') !== null).toBe(navigationGroups.length > 0);
    expect(doc.querySelector('.task-card script, .task-card img')).toBeNull();
    for (const href of ['/scheduleTask/calendar', '/scheduleTask/statistics', '/scheduleTask/new/presence', '/scheduleTask/new/task']) {
      expect(doc.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    dom.window.close();
  });

  test('empty plan renders with the real layout', async () => {
    Task.find.mockReturnValue({ lean: async () => [] });
    const res = createResponse();
    await controller.renderUpcomingTasksPage({ user: { name: 'member' } }, res, jest.fn());
    expect(pug.renderFile('views/scheduleTask/upcoming.pug', { ...res.render.mock.calls[0][1], loggedIn: true,
      permissions: [], bookmarks: [], htmlPaths: [] })).toContain('No incomplete tasks.');
  });

  test('logs an actionable generic failure without private diagnostic payloads', async () => {
    const err = new Error('synthetic private payload');
    Task.find.mockReturnValue({ lean: async () => { throw err; } });
    const next = jest.fn();
    await controller.renderUpcomingTasksPage({ user: { name: 'member' } }, createResponse(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(logger.error).toHaveBeenCalledWith('Failed to load upcoming tasks', {
      category: 'schedule_task', metadata: { errorName: 'Error' },
    });
  });
});
