const now = new Date('2026-09-08T01:00:00Z');
const dayStart = new Date('2026-09-07T15:00:00Z');
const dayEnd = new Date('2026-09-08T15:00:00Z');
const horizon = new Date('2026-09-22T01:00:00Z');
const cases = [
  ['missing-both', {}, 'Ongoing'],
  ['null-both', { start: null, end: null }, 'Ongoing'],
  ['past-start', { start: new Date('2026-01-01T00:00:00Z') }, 'Ongoing'],
  ['null-deadline', { start: dayStart, end: null }, 'Ongoing'],
  ['start-now', { start: now }, 'Ongoing'],
  ['start-next-ms', { start: new Date(+now + 1) }, 'Upcoming'],
  ['future-start-no-end', { start: horizon }, 'Upcoming'],
  ['future-start-null-end', { start: horizon, end: null }, 'Upcoming'],
  ['before-horizon', { start: new Date(+horizon - 1) }, 'Upcoming'],
  ['beyond-horizon', { start: new Date(+horizon + 1) }, 'Upcoming', false],
  ['far-future', { start: new Date('2028-01-01T00:00:00Z'), end: new Date('2028-02-01T00:00:00Z') }, 'Upcoming', false],
  ['started-future-deadline', { start: dayStart, end: new Date('2026-11-01T00:00:00Z') }, 'Ongoing'],
  ['missing-start-future-deadline', { end: dayEnd }, 'Ongoing'],
  ['null-start-today', { start: null, end: now }, 'Due today'],
  ['today-start-boundary', { end: dayStart }, 'Due today'],
  ['today-end-minus-ms', { end: new Date(+dayEnd - 1) }, 'Due today'],
  ['today-end-boundary', { end: dayEnd }, 'Ongoing'],
  ['missing-start-overdue', { end: new Date(+dayStart - 1) }, 'Overdue'],
  ['null-start-overdue', { start: null, end: new Date(+dayStart - 1) }, 'Overdue'],
  ['started-overdue', { start: new Date('2026-01-01T00:00:00Z'), end: new Date(+dayStart - 1) }, 'Overdue'],
  ['overdue-at-horizon', { start: horizon, end: new Date(+dayStart - 1) }, 'Overdue'],
  ['overdue-beyond-horizon', { start: new Date(+horizon + 1), end: new Date(+dayStart - 1) }, 'Overdue', false],
  ['future-start-due-today', { start: new Date(+now + 1), end: new Date(+dayEnd - 1) }, 'Upcoming'],
];
const tasks = cases.map(([id, dates], index) => ({
  _id: id, title: `Synthetic ${id}`, userId: 'member', type: index % 2 ? 'todo' : 'tobuy', done: false, ...dates,
}));
// Evaluate the query operators used by the adapter against synthetic BSON-like
// values, including MongoDB's null equality semantics for absent fields.
function matches(task, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(part => matches(task, part));
    if (key === '$or') return value.some(part => matches(task, part));
    const actual = task[key];
    if (value === null) return actual == null;
    if (typeof value !== 'object' || value instanceof Date) return actual === value;
    return Object.entries(value).every(([op, operand]) => {
      if (op === '$in') return operand.includes(actual);
      if (op === '$ne') return operand === null ? actual != null : actual !== operand;
      if (actual == null) return false;
      if (op === '$lt') return actual < operand;
      if (op === '$lte') return actual <= operand;
      if (op === '$gte') return actual >= operand;
      throw new Error(`Unexpected fixture query operator: ${op}`);
    });
  });
}
module.exports = { now, dayStart, dayEnd, horizon, cases, tasks, matches };
