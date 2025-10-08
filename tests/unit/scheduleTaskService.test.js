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
