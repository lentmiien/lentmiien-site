const DAY = 86400000;
const TIME_ZONE = 'Asia/Tokyo';
const TASK_STATES = ['Overdue', 'Due today', 'Ongoing', 'Upcoming'];

function tokyoDay(now = new Date()) {
  const key = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${key}T00:00:00+09:00`);
  return { key, start, end: new Date(start.getTime() + DAY) };
}

// The dashboard's start window is inclusive and measured from the current instant.
// MongoDB equality to null includes absent fields as well as explicit nulls.
function dashboardTaskStartFilter(now) {
  return { $or: [{ start: null }, { start: { $lte: new Date(now.getTime() + 14 * DAY) } }] };
}

function taskDates(task, now = new Date()) {
  const start = task.start == null ? null : new Date(task.start);
  const end = task.end == null ? null : new Date(task.end);
  const day = tokyoDay(now);
  // Deadlines remain due throughout their Tokyo calendar day. A start alone
  // never expires a task; future starts remain scheduled until that instant.
  const status = end && end < day.start ? 'Overdue'
    : start && start > now ? 'Upcoming'
      : end && end < day.end ? 'Due today' : 'Ongoing';
  return { start, end, status, planningDate: end || (start && start > now ? start : now) };
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const formatTaskDate = date => dateFormatter.format(date);
const taskMonth = date => ({ key: tokyoDay(date).key.slice(0, 7), label: monthFormatter.format(date) });

module.exports = { tokyoDay, dashboardTaskStartFilter, taskDates, formatTaskDate, taskMonth, TASK_STATES };
