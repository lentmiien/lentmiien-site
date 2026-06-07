const { Task, Palette } = require('../database');

const HOUR_MS = 60 * 60 * 1000;
const REMINDER_STARTING_SOON_HOURS = 3;
const REMINDER_EXPIRING_SOON_HOURS = 1;
const TASK_REMINDER_CATEGORIES = [
  'expired',
  'expiringSoon',
  'startingSoon',
  'ongoingWithoutDeadline',
];

function toValidDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function toIsoString(value) {
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

function buildTaskReminderBuckets() {
  return TASK_REMINDER_CATEGORIES.reduce((buckets, category) => {
    buckets[category] = [];
    return buckets;
  }, {});
}

function serializeReminderTask(task, category) {
  return {
    id: task && task._id ? task._id.toString() : '',
    userId: task && task.userId ? task.userId : '',
    type: task && task.type ? task.type : '',
    title: task && task.title ? task.title : '',
    description: task && task.description ? task.description : '',
    start: toIsoString(task ? task.start : null),
    end: toIsoString(task ? task.end : null),
    done: Boolean(task && task.done),
    meta: task && task.meta ? task.meta : null,
    createdAt: toIsoString(task ? task.createdAt : null),
    updatedAt: toIsoString(task ? task.updatedAt : null),
    category,
  };
}

function classifyReminderTask(task, now, startingSoonUntil, expiringSoonUntil) {
  const start = toValidDate(task ? task.start : null);
  const end = toValidDate(task ? task.end : null);

  if (end && end <= now) {
    return 'expired';
  }
  if (end && end > now && end <= expiringSoonUntil) {
    return 'expiringSoon';
  }
  if (start && start > now && start <= startingSoonUntil) {
    return 'startingSoon';
  }
  if (!end && (!start || start <= now)) {
    return 'ongoingWithoutDeadline';
  }

  return null;
}

function sortReminderTasks(category, tasks) {
  const dateField = {
    expired: 'end',
    expiringSoon: 'end',
    startingSoon: 'start',
    ongoingWithoutDeadline: 'start',
  }[category];

  tasks.sort((left, right) => {
    const leftDate = toValidDate(left[dateField]) || toValidDate(left.createdAt) || toValidDate(left.updatedAt);
    const rightDate = toValidDate(right[dateField]) || toValidDate(right.createdAt) || toValidDate(right.updatedAt);

    if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) {
      return leftDate.getTime() - rightDate.getTime();
    }
    if (leftDate && !rightDate) {
      return -1;
    }
    if (!leftDate && rightDate) {
      return 1;
    }
    return (left.title || '').localeCompare(right.title || '');
  });
}

class ScheduleTaskService {
  static SLOT_MINUTES = 15;

  /**
   * Returns {presences, tasks} objects for display in grid.
   * Fills presence gaps as 'home'.
   */
  static async getTasksForWindow(userId, from, to) {
    // Get all presences and tasks for window
    const presences = await Task.find({ 
      userId, 
      type: 'presence', 
      $or: [
        { start: { $lt: to }, end: { $gt: from } }, // Overlapping any slot in window
      ]
    }).lean();

    const tasks = await Task.find({ 
      userId, 
      type: { $in: ['todo', 'tobuy'] },
      $or: [
        { start: { $lte: to } },
        { end: { $gte: from } },
        { start: null }, { end: null }
      ]
    }).lean();

    // Compose presence fills
    const windowSlots = ScheduleTaskService.getSlots(from, to);
    const presenceSlots = [];
    // Mark each slot as covered or not, fill with 'home' where none exists.
    // TODO: Compose slot=>presence mapping

    return { presences, tasks };
  }

  /**
   * Checks for overlap with an existing presence for this user
   */
  static async detectPresenceConflict(userId, start, end, excludeId=null) {
    const query = {
      userId,
      type: 'presence',
      start: { $lt: end },
      end:   { $gt: start }
    };
    if (excludeId) query._id = { $ne: excludeId };

    return Task.find(query);
  }

  /**
   * Get palette as { [key]: { bgColor, border } }, merged with defaults
   */
  static async getPalette() {
    // Minimal example, expand as needed
    const defaults = {
      'location.home':      { bgColor: '#E8F5E9', border: null },
      'location.office':    { bgColor: '#E3F2FD', border: null },
      'location.commute':   { bgColor: '#FFF3E0', border: null },
      'location.travel':    { bgColor: '#EDE7F6', border: null },
      'purpose.work':       { bgColor: null, border: '#1565C0' },
      'purpose.travel':     { bgColor: null, border: '#6A1B9A' },
      'purpose.hospital':   { bgColor: null, border: '#F542B9' },
      'purpose.son':        { bgColor: null, border: '#AD3F0C' },
      'purpose.eatout':     { bgColor: null, border: '#3BC442' },
    };
    const docs = await Palette.find({}).lean();
    const custom = {};
    docs.forEach(c => custom[c.key] = { bgColor: c.bgColor, border: c.border });
    return {...defaults, ...custom};
  }

  static async getTaskReminderBuckets(userId, options = {}) {
    const now = options.now ? toValidDate(options.now) : new Date();
    if (!now) {
      throw new Error('now must be a valid date.');
    }

    const startingSoonUntil = new Date(now.getTime() + REMINDER_STARTING_SOON_HOURS * HOUR_MS);
    const expiringSoonUntil = new Date(now.getTime() + REMINDER_EXPIRING_SOON_HOURS * HOUR_MS);

    const docs = await Task.find({
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
    }).lean();

    const reminders = buildTaskReminderBuckets();
    (docs || []).forEach((task) => {
      if (task && task.done === true) {
        return;
      }
      const category = classifyReminderTask(task, now, startingSoonUntil, expiringSoonUntil);
      if (category) {
        reminders[category].push(serializeReminderTask(task, category));
      }
    });

    TASK_REMINDER_CATEGORIES.forEach((category) => sortReminderTasks(category, reminders[category]));

    return {
      userId,
      generatedAt: now.toISOString(),
      windows: {
        startingSoonHours: REMINDER_STARTING_SOON_HOURS,
        expiringSoonHours: REMINDER_EXPIRING_SOON_HOURS,
        startingSoonUntil: startingSoonUntil.toISOString(),
        expiringSoonUntil: expiringSoonUntil.toISOString(),
      },
      counts: TASK_REMINDER_CATEGORIES.reduce((counts, category) => {
        counts[category] = reminders[category].length;
        return counts;
      }, {}),
      reminders,
    };
  }

  static roundToSlot(date) {
    const d = new Date(date);           // Copy
    d.setSeconds(0, 0);
    const mins = d.getMinutes();
    const slot = Math.floor(mins / 15) * 15;
    d.setMinutes(slot);
    return d;
  }

  /**
   * Helper: return slot array of {start, end:Date} objects in [from, to)
   */
  static getSlots(from, to) {
    const result = [];
    let d = new Date(from);
    while (d < to) {
      const start = new Date(d);
      d = new Date(d.getTime() + 1000*60*ScheduleTaskService.SLOT_MINUTES);
      result.push({ start, end: new Date(d) });
    }
    return result;
  }

  /* Add further helpers as needed... */
}

module.exports = ScheduleTaskService;
