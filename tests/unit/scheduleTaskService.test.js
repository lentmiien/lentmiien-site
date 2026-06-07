jest.mock('../../database', () => {
  const Task = { find: jest.fn() };
  const Palette = { find: jest.fn() };
  return { Task, Palette };
});

const { Task, Palette } = require('../../database');
const ScheduleTaskService = require('../../services/scheduleTaskService');

const createLeanQuery = (payload) => ({
  lean: jest.fn().mockResolvedValue(payload)
});

const reminderTask = (overrides = {}) => ({
  _id: overrides._id || 'task-id',
  userId: 'user-123',
  type: 'todo',
  title: 'Task',
  description: '',
  start: null,
  end: null,
  done: false,
  createdAt: new Date('2026-06-08T00:00:00Z'),
  updatedAt: new Date('2026-06-08T00:00:00Z'),
  ...overrides,
});

describe('ScheduleTaskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getTasksForWindow queries presences and tasks with expected filters', async () => {
    const userId = 'user-123';
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date('2024-01-01T01:00:00Z');
    const presences = [{ _id: 'presence-1' }];
    const todos = [{ _id: 'task-1' }];

    Task.find
      .mockImplementationOnce(() => createLeanQuery(presences))
      .mockImplementationOnce(() => createLeanQuery(todos));

    const result = await ScheduleTaskService.getTasksForWindow(userId, from, to);

    expect(Task.find).toHaveBeenNthCalledWith(1, {
      userId,
      type: 'presence',
      $or: [
        { start: { $lt: to }, end: { $gt: from } }
      ]
    });

    expect(Task.find).toHaveBeenNthCalledWith(2, {
      userId,
      type: { $in: ['todo', 'tobuy'] },
      $or: [
        { start: { $lte: to } },
        { end: { $gte: from } },
        { start: null },
        { end: null }
      ]
    });

    expect(result).toEqual({ presences, tasks: todos });
  });

  test('getTaskReminderBuckets queries todo/tobuy candidates for the reminder windows', async () => {
    const userId = 'user-123';
    const now = new Date('2026-06-08T09:00:00Z');
    const expiringSoonUntil = new Date('2026-06-08T10:00:00Z');
    const startingSoonUntil = new Date('2026-06-08T12:00:00Z');

    Task.find.mockImplementationOnce(() => createLeanQuery([]));

    await ScheduleTaskService.getTaskReminderBuckets(userId, { now });

    expect(Task.find).toHaveBeenCalledWith({
      userId,
      type: { $in: ['todo', 'tobuy'] },
      done: { $ne: true },
      $or: [
        { end: { $lte: now } },
        { end: { $gt: now, $lte: expiringSoonUntil } },
        { start: { $gt: now, $lte: startingSoonUntil } },
        {
          $and: [
            { end: null },
            { $or: [{ start: null }, { start: { $lte: now } }] },
          ],
        },
      ],
    });
  });

  test('getTaskReminderBuckets classifies reminders with priority c, b, a, d', async () => {
    const now = new Date('2026-06-08T09:00:00Z');
    const docs = [
      reminderTask({
        _id: 'starts-soon',
        title: 'Starts Soon',
        start: new Date('2026-06-08T11:00:00Z'),
        end: null,
      }),
      reminderTask({
        _id: 'expiring-and-starting',
        title: 'Expiring and Starting',
        start: new Date('2026-06-08T09:15:00Z'),
        end: new Date('2026-06-08T09:45:00Z'),
      }),
      reminderTask({
        _id: 'expired-and-starting',
        title: 'Expired and Starting',
        start: new Date('2026-06-08T09:30:00Z'),
        end: new Date('2026-06-08T08:00:00Z'),
      }),
      reminderTask({
        _id: 'started-no-deadline',
        title: 'Started No Deadline',
        start: new Date('2026-06-08T08:00:00Z'),
        end: null,
      }),
      reminderTask({
        _id: 'no-dates',
        title: 'No Dates',
        start: null,
        end: null,
        createdAt: new Date('2026-06-08T08:30:00Z'),
      }),
      reminderTask({
        _id: 'completed-expired',
        title: 'Completed Expired',
        end: new Date('2026-06-08T08:30:00Z'),
        done: true,
      }),
    ];
    Task.find.mockImplementationOnce(() => createLeanQuery(docs));

    const result = await ScheduleTaskService.getTaskReminderBuckets('user-123', { now });

    expect(result.generatedAt).toBe('2026-06-08T09:00:00.000Z');
    expect(result.windows).toEqual({
      startingSoonHours: 3,
      expiringSoonHours: 1,
      startingSoonUntil: '2026-06-08T12:00:00.000Z',
      expiringSoonUntil: '2026-06-08T10:00:00.000Z',
    });
    expect(result.counts).toEqual({
      expired: 1,
      expiringSoon: 1,
      startingSoon: 1,
      ongoingWithoutDeadline: 2,
    });
    expect(result.reminders.expired.map((task) => task.id)).toEqual(['expired-and-starting']);
    expect(result.reminders.expiringSoon.map((task) => task.id)).toEqual(['expiring-and-starting']);
    expect(result.reminders.startingSoon.map((task) => task.id)).toEqual(['starts-soon']);
    expect(result.reminders.ongoingWithoutDeadline.map((task) => task.id)).toEqual(['started-no-deadline', 'no-dates']);
    expect(result.reminders.expiringSoon[0]).toMatchObject({
      id: 'expiring-and-starting',
      category: 'expiringSoon',
      start: '2026-06-08T09:15:00.000Z',
      end: '2026-06-08T09:45:00.000Z',
    });
  });

  test('detectPresenceConflict delegates to Task.find', async () => {
    const conflicts = [{ _id: 'conflict-1' }];
    Task.find.mockResolvedValue(conflicts);

    const start = new Date('2024-01-01T12:00:00Z');
    const end = new Date('2024-01-01T13:00:00Z');

    const result = await ScheduleTaskService.detectPresenceConflict('user-1', start, end, 'exclude-id');

    expect(Task.find).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'presence',
      start: { $lt: end },
      end: { $gt: start },
      _id: { $ne: 'exclude-id' }
    });
    expect(result).toBe(conflicts);
  });

  test('getPalette merges defaults with custom palette values', async () => {
    const customDocs = [
      { key: 'location.home', bgColor: '#000000', border: '#ffffff' },
      { key: 'custom.key', bgColor: '#abcdef', border: '#fedcba' }
    ];
    Palette.find.mockImplementationOnce(() => createLeanQuery(customDocs));

    const palette = await ScheduleTaskService.getPalette();

    expect(Palette.find).toHaveBeenCalledWith({});
    expect(palette['location.home']).toEqual({ bgColor: '#000000', border: '#ffffff' });
    expect(palette['custom.key']).toEqual({ bgColor: '#abcdef', border: '#fedcba' });
    expect(palette['purpose.work']).toEqual({ bgColor: null, border: '#1565C0' });
  });

  test('roundToSlot floors minutes to the nearest slot', () => {
    const input = new Date('2024-01-01T09:37:45Z');
    const rounded = ScheduleTaskService.roundToSlot(input);

    expect(rounded.toISOString()).toBe('2024-01-01T09:30:00.000Z');
    expect(input.toISOString()).toBe('2024-01-01T09:37:45.000Z'); // original untouched
  });

  test('getSlots returns contiguous slot boundaries within range', () => {
    const from = new Date('2024-01-01T08:00:00Z');
    const to = new Date('2024-01-01T08:45:00Z');

    const slots = ScheduleTaskService.getSlots(from, to);

    expect(slots).toHaveLength(3);
    expect(slots[0].start.toISOString()).toBe('2024-01-01T08:00:00.000Z');
    expect(slots[0].end.toISOString()).toBe('2024-01-01T08:15:00.000Z');
    expect(slots[2].end.toISOString()).toBe('2024-01-01T08:45:00.000Z');
  });
});
