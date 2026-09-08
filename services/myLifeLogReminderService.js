const logger = require('../utils/logger');
const { MyLifeLogReminder, MyLifeLogEntry } = require('../database');

const { REMINDER_TYPES, REMINDER_SCHEDULE_TYPES, WEEKDAY_NAMES, TYPE_LABELS, buildDueReminder, buildScheduleLabel, comboKey, formatDateKeyLocal, normalizeReminderPayload } = require('../utils/myLifeLogReminderRules');

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
