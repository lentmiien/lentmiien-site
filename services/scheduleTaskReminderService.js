const PushoverReminder = require('../models/pushover_reminder');
const logger = require('../utils/logger');
const {
  ReminderValidationError,
  normalizeReminderInput,
} = require('./pushoverReminderService');

const MAX_TASK_REMINDERS = 5;
const MAX_OFFSET_HOURS = 23;
const MAX_OFFSET_MINUTES = 59;
const TASK_REMINDER_SOURCE = 'schedule-task';
const TASK_TYPES = new Set(['todo', 'tobuy']);

class TaskReminderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskReminderValidationError';
    this.status = 400;
  }
}

function taskIdString(taskOrId) {
  const value = taskOrId && typeof taskOrId === 'object' && taskOrId._id
    ? taskOrId._id
    : taskOrId;
  return value && typeof value.toString === 'function' ? value.toString() : String(value || '');
}

function normalizeOffsetComponent(value, fieldName, maximum, reminderNumber) {
  const rawValue = value === undefined || value === null || value === '' ? 0 : value;
  const number = typeof rawValue === 'number' ? rawValue : Number(rawValue);

  if (!Number.isSafeInteger(number) || number < 0 || (maximum !== null && number > maximum)) {
    const range = maximum === null ? '0 or greater' : `from 0 to ${maximum}`;
    throw new TaskReminderValidationError(
      `Reminder ${reminderNumber} ${fieldName} must be a whole number ${range}.`
    );
  }
  return number;
}

function readOffsetValue(input, name) {
  return input[name]
    ?? input[`${name}_before`]
    ?? input[`${name}Before`];
}

function normalizeAnchor(value, reminderNumber) {
  const anchor = String(value || '').trim().toLowerCase();
  if (anchor === 'start') return 'start';
  if (anchor === 'deadline' || anchor === 'end') return 'deadline';
  throw new TaskReminderValidationError(
    `Reminder ${reminderNumber} must be anchored to the task start or deadline.`
  );
}

function notificationTitleForTask(task) {
  return task.type === 'tobuy' ? 'To-buy task reminder' : 'Todo task reminder';
}

function isTaskLinkedReminder(reminder) {
  return reminder?.source === TASK_REMINDER_SOURCE;
}

function serializeTaskReminder(reminder) {
  const scheduledFor = reminder?.scheduledFor instanceof Date
    ? reminder.scheduledFor
    : new Date(reminder?.scheduledFor);
  const metadata = reminder?.metadata || {};
  return {
    id: reminder?._id?.toString?.() || reminder?.id?.toString?.() || '',
    scheduledFor: Number.isNaN(scheduledFor.getTime()) ? null : scheduledFor.toISOString(),
    priority: Number(reminder?.priority),
    anchor: metadata.anchor || null,
    offset: metadata.offset || { days: 0, hours: 0, minutes: 0 },
  };
}

class ScheduleTaskReminderService {
  constructor({ ReminderModel = PushoverReminder, log = logger } = {}) {
    this.ReminderModel = ReminderModel;
    this.log = log;
  }

  buildReminderRecords(task, inputs = [], { now = new Date() } = {}) {
    if (inputs === undefined || inputs === null) inputs = [];
    if (!Array.isArray(inputs)) {
      throw new TaskReminderValidationError('reminders must be an array.');
    }
    if (inputs.length > MAX_TASK_REMINDERS) {
      throw new TaskReminderValidationError(`A task can have at most ${MAX_TASK_REMINDERS} reminders.`);
    }
    if (!inputs.length) return [];
    if (!task || !TASK_TYPES.has(task.type)) {
      throw new TaskReminderValidationError('Pushover reminders are only available for todo and to-buy tasks.');
    }

    const user = String(task.userId || '').trim();
    const taskId = taskIdString(task);
    const taskTitle = String(task.title || '').trim();
    if (!user || !taskId) {
      throw new TaskReminderValidationError('The task must have a user and task id before reminders can be created.');
    }

    return inputs.map((input, index) => {
      const reminderNumber = index + 1;
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TaskReminderValidationError(`Reminder ${reminderNumber} must be an object.`);
      }

      const anchor = normalizeAnchor(input.anchor, reminderNumber);
      const anchorValue = anchor === 'start' ? task.start : task.end;
      const anchorDate = anchorValue instanceof Date
        ? new Date(anchorValue.getTime())
        : new Date(anchorValue);
      if (!anchorValue || Number.isNaN(anchorDate.getTime())) {
        const label = anchor === 'start' ? 'start date' : 'deadline';
        throw new TaskReminderValidationError(
          `Reminder ${reminderNumber} is anchored to the ${label}, but this task has no ${label}.`
        );
      }

      const days = normalizeOffsetComponent(
        readOffsetValue(input, 'days'),
        'days',
        null,
        reminderNumber
      );
      const hours = normalizeOffsetComponent(
        readOffsetValue(input, 'hours'),
        'hours',
        MAX_OFFSET_HOURS,
        reminderNumber
      );
      const minutes = normalizeOffsetComponent(
        readOffsetValue(input, 'minutes'),
        'minutes',
        MAX_OFFSET_MINUTES,
        reminderNumber
      );
      const offsetMinutes = ((days * 24 + hours) * 60) + minutes;
      const scheduledFor = new Date(anchorDate.getTime() - offsetMinutes * 60 * 1000);

      let values;
      try {
        values = normalizeReminderInput({
          title: notificationTitleForTask(task),
          message: taskTitle,
          scheduledFor,
          priority: input.priority ?? 0,
        }, { now });
      } catch (error) {
        if (!(error instanceof ReminderValidationError)) throw error;
        throw new TaskReminderValidationError(`Reminder ${reminderNumber}: ${error.message}`);
      }

      return {
        user,
        ...values,
        source: TASK_REMINDER_SOURCE,
        metadata: {
          origin: TASK_REMINDER_SOURCE,
          taskId,
          taskType: task.type,
          taskTitle,
          anchor,
          anchorAt: anchorDate.toISOString(),
          offset: { days, hours, minutes },
        },
        done: false,
        deliveryStatus: 'pending',
      };
    });
  }

  async saveTaskWithReminders(task, inputs = [], options = {}) {
    const reminderRecords = this.buildReminderRecords(task, inputs, options);
    await task.save();
    if (!reminderRecords.length) {
      return { task, reminders: [] };
    }

    try {
      const reminders = await this.ReminderModel.insertMany(reminderRecords, { ordered: true });
      return { task, reminders };
    } catch (error) {
      const taskId = taskIdString(task);
      const rollbackResults = await Promise.allSettled([
        this.ReminderModel.deleteMany({
          user: String(task.userId || '').trim(),
          source: TASK_REMINDER_SOURCE,
          'metadata.taskId': taskId,
        }),
        typeof task.deleteOne === 'function'
          ? task.deleteOne()
          : Promise.reject(new Error('Task document does not support rollback deletion.')),
      ]);
      const rollbackErrors = rollbackResults
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason?.message || String(result.reason));

      try {
        await this.log.error('Failed to create task-linked Pushover reminders', {
          category: 'schedule_task_reminders',
          metadata: {
            taskId,
            reminderCount: reminderRecords.length,
            error: error.message,
            rollbackErrors,
          },
        });
      } catch (_) {
        // Preserve the reminder persistence error even if operational logging is unavailable.
      }
      error.taskReminderPersistenceLogged = true;
      throw error;
    }
  }

  async deletePendingForTask(user, taskOrId) {
    const taskId = taskIdString(taskOrId);
    if (!taskId) return 0;
    const result = await this.ReminderModel.deleteMany({
      user: String(user || '').trim(),
      source: TASK_REMINDER_SOURCE,
      'metadata.taskId': taskId,
      done: false,
      deliveryStatus: 'pending',
    });
    return result.deletedCount || 0;
  }
}

const scheduleTaskReminderService = new ScheduleTaskReminderService();

module.exports = {
  MAX_OFFSET_HOURS,
  MAX_OFFSET_MINUTES,
  MAX_TASK_REMINDERS,
  ScheduleTaskReminderService,
  TASK_REMINDER_SOURCE,
  TaskReminderValidationError,
  isTaskLinkedReminder,
  scheduleTaskReminderService,
  serializeTaskReminder,
};
