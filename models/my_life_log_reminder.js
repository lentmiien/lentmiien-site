const mongoose = require('mongoose');

const { Schema } = mongoose;

const REMINDER_TYPES = ['basic', 'medical', 'diary'];
const REMINDER_SCHEDULE_TYPES = ['interval', 'weekdays', 'month_dates'];

const uniqueSortedNumbers = (values, min, max) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= min && value <= max)
)).sort((a, b) => a - b);

const MyLifeLogReminderSchema = new Schema({
  type: { type: String, required: true, enum: REMINDER_TYPES },
  label: { type: String, required: true, trim: true, maxlength: 160 },
  labelKey: { type: String, required: true, trim: true, lowercase: true },
  enabled: { type: Boolean, default: true, index: true },
  scheduleType: { type: String, required: true, enum: REMINDER_SCHEDULE_TYPES },
  intervalDays: { type: Number, min: 1, max: 366, default: null },
  weekdays: { type: [Number], default: [] },
  monthDates: { type: [Number], default: [] },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

MyLifeLogReminderSchema.pre('validate', function normalizeReminder(next) {
  this.label = typeof this.label === 'string' ? this.label.trim() : '';
  this.labelKey = this.label.toLowerCase();
  this.weekdays = uniqueSortedNumbers(this.weekdays, 0, 6);
  this.monthDates = uniqueSortedNumbers(this.monthDates, 1, 28);

  if (this.scheduleType !== 'interval') {
    this.intervalDays = null;
  }
  if (this.scheduleType !== 'weekdays') {
    this.weekdays = [];
  }
  if (this.scheduleType !== 'month_dates') {
    this.monthDates = [];
  }

  next();
});

MyLifeLogReminderSchema.index({ enabled: 1, type: 1, labelKey: 1 });
MyLifeLogReminderSchema.index({ type: 1, labelKey: 1, createdAt: 1 });

module.exports = mongoose.model('my_life_log_reminder', MyLifeLogReminderSchema);
module.exports.REMINDER_TYPES = REMINDER_TYPES;
module.exports.REMINDER_SCHEDULE_TYPES = REMINDER_SCHEDULE_TYPES;
