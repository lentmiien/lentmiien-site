jest.mock('../../database', () => ({
  MyLifeLogReminder: jest.fn(),
  MyLifeLogEntry: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
}));

const {
  buildDueReminder,
  buildScheduleLabel,
  normalizeReminderPayload,
} = require('../../services/myLifeLogReminderService');

const reminder = (overrides = {}) => ({
  _id: 'reminder-1',
  type: 'basic',
  label: 'Weight',
  scheduleType: 'interval',
  intervalDays: 2,
  weekdays: [],
  monthDates: [],
  ...overrides,
});

describe('myLifeLogReminderService calendar rules', () => {
  test('interval reminders become due on the interval day and stay late after it', () => {
    const dueToday = buildDueReminder({
      reminder: reminder(),
      lastEntry: { timestamp: new Date(2026, 4, 20, 22, 30) },
      today: new Date(2026, 4, 22, 9, 0),
    });
    const late = buildDueReminder({
      reminder: reminder(),
      lastEntry: { timestamp: new Date(2026, 4, 20, 22, 30) },
      today: new Date(2026, 4, 23, 9, 0),
    });
    const notDue = buildDueReminder({
      reminder: reminder(),
      lastEntry: { timestamp: new Date(2026, 4, 20, 22, 30) },
      today: new Date(2026, 4, 21, 9, 0),
    });

    expect(dueToday).toMatchObject({ dueDate: '2026-05-22', statusLabel: 'Due today' });
    expect(late).toMatchObject({ dueDate: '2026-05-22', statusLabel: '1 day late' });
    expect(notDue).toBeNull();
  });

  test('weekday reminders are due on selected weekdays and remain late until an entry is saved after the trigger', () => {
    const weekdayReminder = reminder({
      scheduleType: 'weekdays',
      intervalDays: null,
      weekdays: [1, 5],
    });

    const mondayDue = buildDueReminder({
      reminder: weekdayReminder,
      lastEntry: { timestamp: new Date(2026, 4, 24, 12, 0) },
      today: new Date(2026, 4, 25, 9, 0),
    });
    const wednesdayLate = buildDueReminder({
      reminder: weekdayReminder,
      lastEntry: { timestamp: new Date(2026, 4, 24, 12, 0) },
      today: new Date(2026, 4, 27, 9, 0),
    });
    const savedAfterMonday = buildDueReminder({
      reminder: weekdayReminder,
      lastEntry: { timestamp: new Date(2026, 4, 26, 12, 0) },
      today: new Date(2026, 4, 27, 9, 0),
    });

    expect(mondayDue).toMatchObject({ dueDate: '2026-05-25', statusLabel: 'Due today' });
    expect(wednesdayLate).toMatchObject({ dueDate: '2026-05-25', statusLabel: '2 days late' });
    expect(savedAfterMonday).toBeNull();
  });

  test('scheduled reminders still show when there is no previous entry', () => {
    const weekdayReminder = reminder({
      scheduleType: 'weekdays',
      intervalDays: null,
      weekdays: [1, 5],
    });

    const missingEntry = buildDueReminder({
      reminder: weekdayReminder,
      lastEntry: null,
      today: new Date(2026, 4, 27, 9, 0),
    });

    expect(missingEntry).toMatchObject({
      dueDate: '2026-05-25',
      statusLabel: '2 days late',
      detailLabel: 'No saved entry yet',
    });
  });


  test('month-date reminders use selected dates up to day 28 and stay late until a later entry exists', () => {
    const monthDateReminder = reminder({
      scheduleType: 'month_dates',
      intervalDays: null,
      monthDates: [15, 28],
    });

    const dueOnFifteenth = buildDueReminder({
      reminder: monthDateReminder,
      lastEntry: { timestamp: new Date(2026, 4, 14, 8, 0) },
      today: new Date(2026, 4, 15, 8, 0),
    });
    const lateAfterFifteenth = buildDueReminder({
      reminder: monthDateReminder,
      lastEntry: { timestamp: new Date(2026, 4, 14, 8, 0) },
      today: new Date(2026, 4, 20, 8, 0),
    });
    const savedAfterFifteenth = buildDueReminder({
      reminder: monthDateReminder,
      lastEntry: { timestamp: new Date(2026, 4, 16, 8, 0) },
      today: new Date(2026, 4, 20, 8, 0),
    });

    expect(dueOnFifteenth).toMatchObject({ dueDate: '2026-05-15', statusLabel: 'Due today' });
    expect(lateAfterFifteenth).toMatchObject({ dueDate: '2026-05-15', statusLabel: '5 days late' });
    expect(savedAfterFifteenth).toBeNull();
  });

  test('normalizes and validates reminder trigger payloads', () => {
    const payload = normalizeReminderPayload({
      type: 'medical',
      label: ' Blood pressure ',
      enabled: true,
      scheduleType: 'month_dates',
      monthDates: ['28', '29', '1', '1'],
    });

    expect(payload).toMatchObject({
      type: 'medical',
      label: 'Blood pressure',
      labelKey: 'blood pressure',
      enabled: true,
      scheduleType: 'month_dates',
      monthDates: [1, 28],
    });
  });

  test('builds readable schedule labels', () => {
    expect(buildScheduleLabel(reminder({ intervalDays: 1 }))).toBe('Every day');
    expect(buildScheduleLabel(reminder({
      scheduleType: 'weekdays',
      intervalDays: null,
      weekdays: [1, 5],
    }))).toBe('Every Monday and Friday');
    expect(buildScheduleLabel(reminder({
      scheduleType: 'month_dates',
      intervalDays: null,
      monthDates: [1, 15, 28],
    }))).toBe('On the 1st, 15th, and 28th of each month');
  });
});
