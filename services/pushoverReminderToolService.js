const mongoose = require('mongoose');

const { pushoverReminderService } = require('./pushoverReminderService');

function createInputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function resolveUserName(context = {}) {
  const userName = typeof context.userName === 'string'
    ? context.userName.trim()
    : typeof context.user?.name === 'string'
      ? context.user.name.trim()
      : '';

  if (!userName) {
    throw createInputError('A user is required to manage Pushover reminders.');
  }
  return userName;
}

function parseDateTime(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw createInputError(`${fieldName} is required.`);
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createInputError(`${fieldName} must be a valid ISO 8601 datetime.`);
  }
  return date;
}

function normalizeReminderId(value) {
  const reminderId = typeof value === 'string' ? value.trim() : '';
  if (!mongoose.isValidObjectId(reminderId)) {
    throw createInputError('reminder_id must be a valid reminder id.');
  }
  return reminderId;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeReminder(reminder) {
  return {
    id: reminder?._id?.toString?.() || reminder?.id?.toString?.() || '',
    title: reminder?.title || 'Reminder',
    message: reminder?.message || '',
    scheduledFor: toIsoString(reminder?.scheduledFor),
    priority: Number(reminder?.priority),
    createdAt: toIsoString(reminder?.createdAt),
  };
}

class PushoverReminderToolService {
  constructor({ reminderService = pushoverReminderService } = {}) {
    this.reminderService = reminderService;
  }

  async setReminder(args = {}, context = {}) {
    const user = resolveUserName(context);
    const reminder = await this.reminderService.create(user, {
      title: args.title,
      message: args.message,
      scheduledFor: args.scheduled_for ?? args.scheduledFor,
      priority: args.priority ?? 0,
    });

    return {
      ok: true,
      user,
      reminder: serializeReminder(reminder),
    };
  }

  async fetchReminders(args = {}, context = {}) {
    const user = resolveUserName(context);
    const from = parseDateTime(args.from, 'from');
    const to = parseDateTime(args.to, 'to');
    if (to < from) {
      throw createInputError('to must be the same as or after from.');
    }

    const docs = await this.reminderService.listUpcomingInRange(user, from, to);
    const reminders = (docs || []).map(serializeReminder);
    return {
      ok: true,
      user,
      from: from.toISOString(),
      to: to.toISOString(),
      count: reminders.length,
      reminders,
    };
  }

  async deleteReminder(args = {}, context = {}) {
    const user = resolveUserName(context);
    const reminderId = normalizeReminderId(args.reminder_id ?? args.reminderId ?? args.id);
    const reminder = await this.reminderService.remove(user, reminderId);
    if (!reminder) {
      throw createInputError('Pending Pushover reminder not found.', 404);
    }

    return {
      ok: true,
      user,
      deleted: true,
      reminder: serializeReminder(reminder),
    };
  }
}

PushoverReminderToolService.serializeReminder = serializeReminder;

module.exports = PushoverReminderToolService;
