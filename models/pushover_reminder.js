const mongoose = require('mongoose');

const PUSHOVER_REMINDER_PRIORITIES = [-2, -1, 0, 1, 2];
const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed'];
const REMINDER_SOURCES = ['manual', 'schedule-task'];

const PushoverReminderSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160,
    index: true,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 250,
    default: 'Reminder',
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1024,
  },
  scheduledFor: {
    type: Date,
    required: true,
    index: true,
  },
  priority: {
    type: Number,
    required: true,
    enum: PUSHOVER_REMINDER_PRIORITIES,
    default: 0,
  },
  source: {
    type: String,
    enum: REMINDER_SOURCES,
    default: 'manual',
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  done: {
    type: Boolean,
    default: false,
    index: true,
  },
  deliveryStatus: {
    type: String,
    enum: DELIVERY_STATUSES,
    default: 'pending',
    index: true,
  },
  triggeredAt: {
    type: Date,
    default: null,
  },
  sentAt: {
    type: Date,
    default: null,
  },
  deliveryError: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: '',
  },
  historyExpiresAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'pushover_reminders',
});

PushoverReminderSchema.index({ done: 1, deliveryStatus: 1, scheduledFor: 1 });
PushoverReminderSchema.index({ user: 1, done: 1, scheduledFor: 1 });
PushoverReminderSchema.index({ user: 1, done: 1, triggeredAt: -1 });
PushoverReminderSchema.index({
  user: 1,
  source: 1,
  'metadata.taskId': 1,
  done: 1,
  deliveryStatus: 1,
});
PushoverReminderSchema.index({ historyExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PushoverReminder', PushoverReminderSchema);
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
module.exports.PUSHOVER_REMINDER_PRIORITIES = PUSHOVER_REMINDER_PRIORITIES;
module.exports.REMINDER_SOURCES = REMINDER_SOURCES;
