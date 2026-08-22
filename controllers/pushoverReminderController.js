const logger = require('../utils/logger');
const {
  PUSHOVER_PRIORITY_OPTIONS,
  ReminderValidationError,
  priorityOptionFor,
  pushoverReminderService,
} = require('../services/pushoverReminderService');

const REMINDER_BASE_PATH = '/reminders';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTimeLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplayDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function defaultScheduledFor(now = new Date()) {
  const value = new Date(now.getTime() + 10 * 60 * 1000);
  value.setSeconds(0, 0);
  return value;
}

function blankForm(now = new Date()) {
  const scheduledFor = defaultScheduledFor(now);
  return {
    id: '',
    title: '',
    message: '',
    priority: 0,
    scheduledForLocal: formatDateTimeLocal(scheduledFor),
    scheduledForIso: scheduledFor.toISOString(),
  };
}

function formFromReminder(reminder) {
  const scheduledFor = new Date(reminder.scheduledFor);
  return {
    id: reminder._id?.toString() || reminder.id || '',
    title: reminder.title === 'Reminder' ? '' : reminder.title || '',
    message: reminder.message || '',
    priority: Number(reminder.priority),
    scheduledForLocal: formatDateTimeLocal(scheduledFor),
    scheduledForIso: Number.isNaN(scheduledFor.getTime()) ? '' : scheduledFor.toISOString(),
  };
}

function formFromBody(body = {}, id = '') {
  const parsedPriority = Number.parseInt(body.priority, 10);
  return {
    id,
    title: typeof body.title === 'string' ? body.title : '',
    message: typeof body.message === 'string' ? body.message : '',
    priority: Number.isInteger(parsedPriority) ? parsedPriority : 0,
    scheduledForLocal: typeof body.scheduled_for === 'string' ? body.scheduled_for : '',
    scheduledForIso: typeof body.scheduled_for_iso === 'string' ? body.scheduled_for_iso : '',
  };
}

function inputFromBody(body = {}) {
  return {
    title: body.title,
    message: body.message,
    priority: body.priority,
    scheduledFor: body.scheduled_for_iso || body.scheduled_for,
  };
}

function decorateReminder(reminder) {
  const scheduledFor = new Date(reminder.scheduledFor);
  const triggeredAt = reminder.triggeredAt ? new Date(reminder.triggeredAt) : null;
  const priority = priorityOptionFor(reminder.priority);
  const deliveryStatusLabels = {
    sending: 'Delivery started',
    sent: 'Sent',
    failed: 'Delivery failed',
  };

  return {
    ...reminder,
    id: reminder._id?.toString() || reminder.id || '',
    title: reminder.title || 'Reminder',
    scheduledForIso: Number.isNaN(scheduledFor.getTime()) ? '' : scheduledFor.toISOString(),
    scheduledForLabel: formatDisplayDate(scheduledFor),
    triggeredAtIso: triggeredAt && !Number.isNaN(triggeredAt.getTime())
      ? triggeredAt.toISOString()
      : '',
    triggeredAtLabel: triggeredAt ? formatDisplayDate(triggeredAt) : 'Unknown time',
    priorityLabel: priority.label,
    deliveryStatusLabel: deliveryStatusLabels[reminder.deliveryStatus] || 'Completed',
  };
}

function redirectWithMessage(res, key, message) {
  const params = new URLSearchParams({ [key]: message });
  return res.redirect(`${REMINDER_BASE_PATH}?${params.toString()}`);
}

async function renderIndex(res, {
  user,
  form = null,
  errorMessage = null,
  successMessage = null,
  statusCode = 200,
} = {}) {
  const upcoming = await pushoverReminderService.listUpcoming(user);
  return res.status(statusCode).render('pushover_reminders/index', {
    pageTitle: form?.id ? 'Edit Pushover reminder' : 'Pushover reminders',
    upcoming: upcoming.map(decorateReminder),
    form: form || blankForm(),
    priorityOptions: PUSHOVER_PRIORITY_OPTIONS,
    errorMessage,
    successMessage,
  });
}

exports.index = async (req, res, next) => {
  try {
    return await renderIndex(res, {
      user: req.user.name,
      successMessage: req.query.success || null,
      errorMessage: req.query.error || null,
    });
  } catch (error) {
    await logger.error('Failed to render Pushover reminders', {
      category: 'pushover_reminders',
      metadata: { error: error.message },
    });
    return next(error);
  }
};

exports.edit = async (req, res, next) => {
  try {
    const reminder = await pushoverReminderService.getUpcoming(req.user.name, req.params.id);
    if (!reminder) {
      return redirectWithMessage(res, 'error', 'Upcoming reminder not found.');
    }
    return await renderIndex(res, {
      user: req.user.name,
      form: formFromReminder(reminder),
    });
  } catch (error) {
    await logger.error('Failed to load Pushover reminder for editing', {
      category: 'pushover_reminders',
      metadata: { reminderId: req.params.id, error: error.message },
    });
    return next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    await pushoverReminderService.create(req.user.name, inputFromBody(req.body));
    return redirectWithMessage(res, 'success', 'Reminder scheduled.');
  } catch (error) {
    if (error instanceof ReminderValidationError) {
      return renderIndex(res, {
        user: req.user.name,
        form: formFromBody(req.body),
        errorMessage: error.message,
        statusCode: 400,
      });
    }
    await logger.error('Failed to create Pushover reminder', {
      category: 'pushover_reminders',
      metadata: { error: error.message },
    });
    return next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const reminder = await pushoverReminderService.update(
      req.user.name,
      req.params.id,
      inputFromBody(req.body)
    );
    if (!reminder) {
      return redirectWithMessage(res, 'error', 'Upcoming reminder not found.');
    }
    return redirectWithMessage(res, 'success', 'Reminder updated.');
  } catch (error) {
    if (error instanceof ReminderValidationError) {
      return renderIndex(res, {
        user: req.user.name,
        form: formFromBody(req.body, req.params.id),
        errorMessage: error.message,
        statusCode: 400,
      });
    }
    await logger.error('Failed to update Pushover reminder', {
      category: 'pushover_reminders',
      metadata: { reminderId: req.params.id, error: error.message },
    });
    return next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const reminder = await pushoverReminderService.remove(req.user.name, req.params.id);
    if (!reminder) {
      return redirectWithMessage(res, 'error', 'Upcoming reminder not found.');
    }
    return redirectWithMessage(res, 'success', 'Reminder deleted.');
  } catch (error) {
    await logger.error('Failed to delete Pushover reminder', {
      category: 'pushover_reminders',
      metadata: { reminderId: req.params.id, error: error.message },
    });
    return next(error);
  }
};

exports.history = async (req, res, next) => {
  try {
    const history = await pushoverReminderService.listHistory(req.user.name);
    return res.render('pushover_reminders/history', {
      pageTitle: 'Pushover reminder history',
      history: history.map(decorateReminder),
    });
  } catch (error) {
    await logger.error('Failed to render Pushover reminder history', {
      category: 'pushover_reminders',
      metadata: { error: error.message },
    });
    return next(error);
  }
};

exports._test = {
  blankForm,
  decorateReminder,
  defaultScheduledFor,
  formatDateTimeLocal,
  inputFromBody,
};
