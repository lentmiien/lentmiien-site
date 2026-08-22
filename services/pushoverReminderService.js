const mongoose = require('mongoose');

const PushoverReminder = require('../models/pushover_reminder');
const logger = require('../utils/logger');
const {
  PUSHOVER_PRIORITIES,
  sendPushoverNotification,
} = require('../utils/pushover');

const HISTORY_RETENTION_MONTHS = 3;
const MAX_DELIVERY_ERROR_LENGTH = 1000;
const PUSHOVER_PRIORITY_OPTIONS = Object.freeze([
  Object.freeze({
    value: PUSHOVER_PRIORITIES.LOWEST,
    label: 'Lowest',
    description: 'Delivered quietly without sound or vibration.',
  }),
  Object.freeze({
    value: PUSHOVER_PRIORITIES.LOW,
    label: 'Low',
    description: 'Delivered quietly, below normal-priority messages.',
  }),
  Object.freeze({
    value: PUSHOVER_PRIORITIES.MEDIUM,
    label: 'Normal',
    description: 'A standard Pushover notification.',
  }),
  Object.freeze({
    value: PUSHOVER_PRIORITIES.HIGH,
    label: 'High',
    description: 'Bypasses the device quiet hours setting.',
  }),
  Object.freeze({
    value: PUSHOVER_PRIORITIES.EMERGENCY,
    label: 'Emergency',
    description: 'Pushover repeats the alert until it is acknowledged or expires.',
  }),
]);
const VALID_PRIORITIES = new Set(PUSHOVER_PRIORITY_OPTIONS.map((option) => option.value));

class ReminderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReminderValidationError';
  }
}

function addUtcMonths(value, months) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('A valid date is required.');
  }

  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0
  )).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function normalizeReminderInput(input = {}, { now = new Date(), requireFuture = true } = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const scheduledFor = input.scheduledFor instanceof Date
    ? new Date(input.scheduledFor.getTime())
    : new Date(input.scheduledFor);
  const priority = typeof input.priority === 'number'
    ? input.priority
    : typeof input.priority === 'string' && input.priority.trim() !== ''
      ? Number(input.priority)
      : Number.NaN;
  const currentTime = now instanceof Date ? now : new Date(now);

  if (title.length > 250) {
    throw new ReminderValidationError('Title must be 250 characters or fewer.');
  }
  if (!message) {
    throw new ReminderValidationError('Reminder message is required.');
  }
  if (message.length > 1024) {
    throw new ReminderValidationError('Reminder message must be 1024 characters or fewer.');
  }
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new ReminderValidationError('Please choose a valid reminder date and time.');
  }
  if (Number.isNaN(currentTime.getTime())) {
    throw new TypeError('now must be a valid date.');
  }

  scheduledFor.setSeconds(0, 0);
  if (requireFuture && scheduledFor.getTime() <= currentTime.getTime()) {
    throw new ReminderValidationError('Reminder time must be in the future.');
  }
  if (!Number.isInteger(priority) || !VALID_PRIORITIES.has(priority)) {
    throw new ReminderValidationError('Please choose a valid Pushover priority.');
  }

  return {
    title: title || 'Reminder',
    message,
    scheduledFor,
    priority,
  };
}

function isValidReminderId(id) {
  return typeof id === 'string' && mongoose.isValidObjectId(id);
}

function priorityOptionFor(value) {
  return PUSHOVER_PRIORITY_OPTIONS.find((option) => option.value === Number(value))
    || PUSHOVER_PRIORITY_OPTIONS.find((option) => option.value === PUSHOVER_PRIORITIES.MEDIUM);
}

class PushoverReminderService {
  constructor({
    ReminderModel = PushoverReminder,
    notificationSender = sendPushoverNotification,
    log = logger,
  } = {}) {
    this.ReminderModel = ReminderModel;
    this.notificationSender = notificationSender;
    this.log = log;
  }

  async listUpcoming(user) {
    return this.ReminderModel.find({
      user,
      done: false,
      deliveryStatus: 'pending',
    })
      .sort({ scheduledFor: 1, createdAt: 1 })
      .lean()
      .exec();
  }

  async listHistory(user) {
    return this.ReminderModel.find({ user, done: true })
      .sort({ triggeredAt: -1, scheduledFor: -1 })
      .lean()
      .exec();
  }

  async getUpcoming(user, id) {
    if (!isValidReminderId(id)) return null;
    return this.ReminderModel.findOne({
      _id: id,
      user,
      done: false,
      deliveryStatus: 'pending',
    }).lean().exec();
  }

  async create(user, input, options = {}) {
    const values = normalizeReminderInput(input, options);
    const reminder = new this.ReminderModel({
      user,
      ...values,
      done: false,
      deliveryStatus: 'pending',
    });
    await reminder.save();
    return reminder;
  }

  async update(user, id, input, options = {}) {
    if (!isValidReminderId(id)) return null;
    const values = normalizeReminderInput(input, options);
    return this.ReminderModel.findOneAndUpdate({
      _id: id,
      user,
      done: false,
      deliveryStatus: 'pending',
    }, {
      $set: values,
    }, {
      new: true,
      runValidators: true,
    });
  }

  async remove(user, id) {
    if (!isValidReminderId(id)) return null;
    return this.ReminderModel.findOneAndDelete({
      _id: id,
      user,
      done: false,
      deliveryStatus: 'pending',
    });
  }

  async processDueReminders(now = new Date()) {
    const triggeredAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(triggeredAt.getTime())) {
      throw new TypeError('now must be a valid date.');
    }

    const summary = {
      claimed: 0,
      sent: 0,
      failed: 0,
    };

    while (true) {
      const reminder = await this.ReminderModel.findOneAndUpdate({
        done: false,
        deliveryStatus: 'pending',
        scheduledFor: { $lte: triggeredAt },
      }, {
        $set: {
          done: true,
          deliveryStatus: 'sending',
          triggeredAt,
          historyExpiresAt: addUtcMonths(triggeredAt, HISTORY_RETENTION_MONTHS),
        },
      }, {
        new: true,
        sort: { scheduledFor: 1, _id: 1 },
      });

      if (!reminder) break;
      summary.claimed += 1;

      let notificationError = null;
      try {
        await this.notificationSender({
          title: reminder.title || 'Reminder',
          message: reminder.message,
          priority: reminder.priority,
        });
      } catch (error) {
        notificationError = error;
      }

      if (!notificationError) {
        summary.sent += 1;
        try {
          await this.ReminderModel.updateOne({
            _id: reminder._id,
            done: true,
            deliveryStatus: 'sending',
          }, {
            $set: {
              deliveryStatus: 'sent',
              sentAt: triggeredAt,
              deliveryError: '',
            },
          });
        } catch (persistenceError) {
          await this.log.error('Failed to save Pushover reminder delivery result', {
            category: 'pushover_reminders',
            metadata: {
              reminderId: reminder._id?.toString() || null,
              outcome: 'sent',
              error: persistenceError.message,
            },
          });
        }
        continue;
      }

      const deliveryError = String(notificationError?.message || notificationError)
        .slice(0, MAX_DELIVERY_ERROR_LENGTH);
      summary.failed += 1;
      try {
        await this.ReminderModel.updateOne({
          _id: reminder._id,
          done: true,
          deliveryStatus: 'sending',
        }, {
          $set: {
            deliveryStatus: 'failed',
            deliveryError,
          },
        });
      } catch (persistenceError) {
        await this.log.error('Failed to save Pushover reminder delivery result', {
          category: 'pushover_reminders',
          metadata: {
            reminderId: reminder._id?.toString() || null,
            outcome: 'failed',
            error: persistenceError.message,
          },
        });
      }
      await this.log.error('Pushover reminder delivery failed', {
        category: 'pushover_reminders',
        metadata: {
          reminderId: reminder._id?.toString() || null,
          priority: reminder.priority,
          error: deliveryError,
        },
      });
    }

    return summary;
  }

  async deleteExpiredHistory(now = new Date()) {
    const cutoff = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(cutoff.getTime())) {
      throw new TypeError('now must be a valid date.');
    }
    const result = await this.ReminderModel.deleteMany({
      done: true,
      historyExpiresAt: { $lte: cutoff },
    });
    return result.deletedCount || 0;
  }
}

const pushoverReminderService = new PushoverReminderService();

module.exports = {
  HISTORY_RETENTION_MONTHS,
  PUSHOVER_PRIORITY_OPTIONS,
  PushoverReminderService,
  ReminderValidationError,
  addUtcMonths,
  normalizeReminderInput,
  priorityOptionFor,
  pushoverReminderService,
};
