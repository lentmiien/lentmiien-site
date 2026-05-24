const logger = require('../utils/logger');
const { MyLifeLogReminder, MyLifeLogEntry } = require('../database');

const REMINDER_TYPES = ['basic', 'medical', 'diary'];
const REMINDER_SCHEDULE_TYPES = ['interval', 'weekdays', 'month_dates'];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPE_LABELS = {
  basic: 'Basic',
  medical: 'Medical',
  diary: 'Diary',
};

const pad2 = (value) => String(value).padStart(2, '0');

const formatDateKeyLocal = (date) => {
  const safe = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safe.getTime())) return null;
  return `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}`;
};

const formatDateKeyUTC = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const parseDateKeyParts = (dateKey) => {
  if (typeof dateKey !== 'string') return null;
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const dateKeyToDayNumber = (dateKey) => {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
};

const dayNumberToDateKey = (dayNumber) => formatDateKeyUTC(new Date(dayNumber * DAY_MS));

const addDaysToDateKey = (dateKey, days) => {
  const dayNumber = dateKeyToDayNumber(dateKey);
  if (!Number.isFinite(dayNumber)) return null;
  return dayNumberToDateKey(dayNumber + days);
};

const diffDateKeys = (fromDateKey, toDateKey) => {
  const from = dateKeyToDayNumber(fromDateKey);
  const to = dateKeyToDayNumber(toDateKey);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to - from;
};

const getWeekdayForDateKey = (dateKey) => {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
};

const normalizeLabel = (label) => {
  if (typeof label !== 'string') return '';
  return label.trim();
};

const comboKey = (type, label) => `${type}::${normalizeLabel(label).toLowerCase()}`;

const uniqueSortedNumbers = (values, min, max) => Array.from(new Set(
  (Array.isArray(values) ? values : [values])
    .flat()
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= min && value <= max)
)).sort((a, b) => a - b);

const formatList = (items) => {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const ordinal = (value) => {
  const normalized = Number.parseInt(value, 10);
  if (!Number.isInteger(normalized)) return '';
  const lastTwo = normalized % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${normalized}th`;
  const last = normalized % 10;
  if (last === 1) return `${normalized}st`;
  if (last === 2) return `${normalized}nd`;
  if (last === 3) return `${normalized}rd`;
  return `${normalized}th`;
};

const buildScheduleLabel = (reminder) => {
  if (!reminder) return '';
  if (reminder.scheduleType === 'interval') {
    const days = Number.parseInt(reminder.intervalDays, 10) || 1;
    return days === 1 ? 'Every day' : `Every ${days} days`;
  }
  if (reminder.scheduleType === 'weekdays') {
    const weekdays = uniqueSortedNumbers(reminder.weekdays, 0, 6)
      .map((day) => WEEKDAY_NAMES[day]);
    return weekdays.length ? `Every ${formatList(weekdays)}` : 'Selected weekdays';
  }
  if (reminder.scheduleType === 'month_dates') {
    const monthDates = uniqueSortedNumbers(reminder.monthDates, 1, 28)
      .map((day) => ordinal(day));
    return monthDates.length ? `On the ${formatList(monthDates)} of each month` : 'Selected dates of month';
  }
  return '';
};

const findLastWeekdayTrigger = ({ weekdays, todayKey }) => {
  const selected = new Set(uniqueSortedNumbers(weekdays, 0, 6));
  if (!selected.size) return null;
  const todayNumber = dateKeyToDayNumber(todayKey);
  if (!Number.isFinite(todayNumber)) return null;

  for (let dayNumber = todayNumber; todayNumber - dayNumber <= 7; dayNumber -= 1) {
    const dateKey = dayNumberToDateKey(dayNumber);
    if (selected.has(getWeekdayForDateKey(dateKey))) {
      return dateKey;
    }
  }
  return null;
};

const findLastMonthDateTrigger = ({ monthDates, todayKey }) => {
  const selected = new Set(uniqueSortedNumbers(monthDates, 1, 28));
  if (!selected.size) return null;
  const todayNumber = dateKeyToDayNumber(todayKey);
  if (!Number.isFinite(todayNumber)) return null;

  for (let dayNumber = todayNumber; todayNumber - dayNumber <= 370; dayNumber -= 1) {
    const dateKey = dayNumberToDateKey(dayNumber);
    const parts = parseDateKeyParts(dateKey);
    if (parts && selected.has(parts.day)) {
      return dateKey;
    }
  }
  return null;
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return parseBoolean(value[value.length - 1], fallback);
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return Boolean(value);
};

const normalizeReminderPayload = (payload = {}) => {
  const type = typeof payload.type === 'string' ? payload.type.trim() : '';
  const label = normalizeLabel(payload.label);
  const scheduleType = typeof payload.scheduleType === 'string'
    ? payload.scheduleType.trim()
    : typeof payload.schedule_type === 'string'
      ? payload.schedule_type.trim()
      : '';

  if (!REMINDER_TYPES.includes(type)) {
    throw new Error('Choose a valid life log type.');
  }
  if (!label) {
    throw new Error('Label is required.');
  }
  if (!REMINDER_SCHEDULE_TYPES.includes(scheduleType)) {
    throw new Error('Choose a valid reminder schedule.');
  }

  const normalized = {
    type,
    label,
    labelKey: label.toLowerCase(),
    enabled: parseBoolean(payload.enabled, true),
    scheduleType,
    intervalDays: null,
    weekdays: [],
    monthDates: [],
  };

  if (scheduleType === 'interval') {
    const intervalDays = Number.parseInt(payload.intervalDays || payload.interval_days, 10);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 366) {
      throw new Error('Every-days reminders need an interval from 1 to 366 days.');
    }
    normalized.intervalDays = intervalDays;
  }

  if (scheduleType === 'weekdays') {
    normalized.weekdays = uniqueSortedNumbers(payload.weekdays, 0, 6);
    if (!normalized.weekdays.length) {
      throw new Error('Select at least one weekday.');
    }
  }

  if (scheduleType === 'month_dates') {
    normalized.monthDates = uniqueSortedNumbers(payload.monthDates || payload.month_dates, 1, 28);
    if (!normalized.monthDates.length) {
      throw new Error('Select at least one date of month.');
    }
  }

  return normalized;
};

const buildDueReminder = ({ reminder, lastEntry, today = new Date() }) => {
  const todayKey = formatDateKeyLocal(today);
  const lastEntryKey = lastEntry?.timestamp ? formatDateKeyLocal(lastEntry.timestamp) : null;
  if (!todayKey) return null;

  let dueDate = null;

  if (reminder.scheduleType === 'interval') {
    const intervalDays = Number.parseInt(reminder.intervalDays, 10) || 1;
    dueDate = lastEntryKey ? addDaysToDateKey(lastEntryKey, intervalDays) : todayKey;
  } else if (reminder.scheduleType === 'weekdays') {
    dueDate = findLastWeekdayTrigger({
      weekdays: reminder.weekdays,
      todayKey,
    });
    if (dueDate && lastEntryKey && diffDateKeys(dueDate, lastEntryKey) >= 0) {
      return null;
    }
  } else if (reminder.scheduleType === 'month_dates') {
    dueDate = findLastMonthDateTrigger({
      monthDates: reminder.monthDates,
      todayKey,
    });
    if (dueDate && lastEntryKey && diffDateKeys(dueDate, lastEntryKey) >= 0) {
      return null;
    }
  }

  if (!dueDate) return null;
  const daysLate = diffDateKeys(dueDate, todayKey);
  if (!Number.isFinite(daysLate) || daysLate < 0) return null;

  return {
    id: reminder._id?.toString() || reminder.id || '',
    type: reminder.type,
    typeLabel: TYPE_LABELS[reminder.type] || reminder.type,
    label: reminder.label || '',
    reminderKey: comboKey(reminder.type, reminder.label),
    scheduleType: reminder.scheduleType,
    scheduleLabel: buildScheduleLabel(reminder),
    dueDate,
    statusLabel: daysLate === 0
      ? 'Due today'
      : `${daysLate} day${daysLate === 1 ? '' : 's'} late`,
    daysLate,
    lastEntryDate: lastEntryKey,
    detailLabel: lastEntryKey ? `Last saved ${lastEntryKey}` : 'No saved entry yet',
  };
};

class MyLifeLogReminderService {
  constructor({ LifeLogReminder, LifeLogEntry, logger }) {
    this.LifeLogReminder = LifeLogReminder;
    this.LifeLogEntry = LifeLogEntry;
    this.logger = logger;
  }

  async listTriggers() {
    return this.LifeLogReminder.find({})
      .sort({ enabled: -1, type: 1, labelKey: 1, createdAt: 1 })
      .lean();
  }

  async getTrigger(id) {
    if (!id) return null;
    return this.LifeLogReminder.findById(id).lean();
  }

  async saveTrigger(payload = {}) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const existing = id ? await this.LifeLogReminder.findById(id) : null;
    if (id && !existing) {
      throw new Error('Reminder trigger not found.');
    }
    const normalized = normalizeReminderPayload(payload);

    if (existing) {
      Object.assign(existing, normalized);
      return existing.save();
    }

    const reminder = new this.LifeLogReminder(normalized);
    return reminder.save();
  }

  async deleteTrigger(id) {
    if (!id) return null;
    return this.LifeLogReminder.findByIdAndDelete(id);
  }

  async getDueReminders(today = new Date()) {
    const reminders = await this.LifeLogReminder.find({ enabled: true })
      .sort({ type: 1, labelKey: 1, createdAt: 1 })
      .lean();
    if (!reminders.length) return [];

    const comboQueries = [];
    const seenCombos = new Set();
    reminders.forEach((reminder) => {
      const key = comboKey(reminder.type, reminder.label);
      if (seenCombos.has(key)) return;
      seenCombos.add(key);
      comboQueries.push({ type: reminder.type, label: reminder.label });
    });

    const entries = comboQueries.length
      ? await this.LifeLogEntry.find(
        { $or: comboQueries },
        { type: 1, label: 1, timestamp: 1 }
      )
        .sort({ timestamp: -1 })
        .lean()
      : [];

    const latestByCombo = new Map();
    entries.forEach((entry) => {
      const key = comboKey(entry.type, entry.label);
      if (!latestByCombo.has(key)) {
        latestByCombo.set(key, entry);
      }
    });

    return reminders
      .map((reminder) => buildDueReminder({
        reminder,
        lastEntry: latestByCombo.get(comboKey(reminder.type, reminder.label)),
        today,
      }))
      .filter(Boolean)
      .sort((a, b) => {
        if (b.daysLate !== a.daysLate) return b.daysLate - a.daysLate;
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.label.localeCompare(b.label);
      });
  }
}

const myLifeLogReminderService = new MyLifeLogReminderService({
  LifeLogReminder: MyLifeLogReminder,
  LifeLogEntry: MyLifeLogEntry,
  logger,
});

module.exports = myLifeLogReminderService;
module.exports.MyLifeLogReminderService = MyLifeLogReminderService;
module.exports.REMINDER_TYPES = REMINDER_TYPES;
module.exports.REMINDER_SCHEDULE_TYPES = REMINDER_SCHEDULE_TYPES;
module.exports.WEEKDAY_NAMES = WEEKDAY_NAMES;
module.exports.TYPE_LABELS = TYPE_LABELS;
module.exports.buildDueReminder = buildDueReminder;
module.exports.buildScheduleLabel = buildScheduleLabel;
module.exports.comboKey = comboKey;
module.exports.formatDateKeyLocal = formatDateKeyLocal;
module.exports.normalizeReminderPayload = normalizeReminderPayload;
