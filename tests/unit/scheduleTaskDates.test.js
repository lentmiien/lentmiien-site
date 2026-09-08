const { taskDates, taskMonth, tokyoDay, formatTaskDate } = require('../../utils/scheduleTaskDates');
const { now, cases } = require('../fixtures/taskDates');

test.each(cases)('%s has coherent status', (_id, dates, status) => {
  expect(taskDates(dates, now).status).toBe(status);
});
test('a future start becomes ongoing at its exact instant without a deadline', () => {
  const task = { start: new Date(+now + 1), end: null };
  expect(taskDates(task, now).status).toBe('Upcoming');
  expect(taskDates(task, task.start).status).toBe('Ongoing');
  expect(taskDates(task, new Date(+now + 86400000)).status).toBe('Ongoing');
});
test('Tokyo midnight and month boundaries are independent of host timezone', () => {
  const boundary = new Date('2026-09-30T15:00:00Z');
  expect(taskMonth(boundary)).toEqual({ key: '2026-10', label: 'October 2026' });
  expect(taskMonth(new Date(+boundary - 1)).key).toBe('2026-09');
  expect(tokyoDay(boundary).key).toBe('2026-10-01');
  expect(formatTaskDate(boundary)).toMatch(/Oct 1, 2026.*12:00 AM/);
});
test('available no-deadline tasks plan in the current month without inventing stored dates', () => {
  const dates = taskDates({ start: new Date('2020-01-01T00:00:00Z') }, now);
  expect(dates.planningDate).toBe(now);
  expect(dates.end).toBeNull();
  expect(taskDates({}, now).start).toBeNull();
});
