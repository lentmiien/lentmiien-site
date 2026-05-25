const logger = require('../utils/logger');
const myLifeLogService = require('../services/myLifeLogService');
const myLifeLogReminderService = require('../services/myLifeLogReminderService');
const {
  REMINDER_TYPES,
  WEEKDAY_NAMES,
  TYPE_LABELS,
  buildScheduleLabel,
} = require('../services/myLifeLogReminderService');

const parseArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const parseBoolean = (value) => {
  const values = parseArray(value);
  const last = values.length ? values[values.length - 1] : value;
  if (typeof last === 'boolean') return last;
  if (typeof last === 'string') {
    return ['true', '1', 'yes', 'on'].includes(last.toLowerCase());
  }
  return false;
};

const numberList = (value) => parseArray(value)
  .map((item) => Number.parseInt(item, 10))
  .filter((item) => Number.isInteger(item));

const buildBlankForm = () => ({
  id: '',
  type: 'basic',
  label: '',
  enabled: true,
  scheduleType: 'interval',
  intervalDays: 1,
  weekdays: [],
  monthDates: [],
});

const buildFormFromReminder = (reminder) => {
  if (!reminder) return buildBlankForm();
  return {
    id: reminder._id?.toString() || reminder.id || '',
    type: reminder.type || 'basic',
    label: reminder.label || '',
    enabled: reminder.enabled !== false,
    scheduleType: reminder.scheduleType || 'interval',
    intervalDays: reminder.intervalDays || 1,
    weekdays: Array.isArray(reminder.weekdays) ? reminder.weekdays : [],
    monthDates: Array.isArray(reminder.monthDates) ? reminder.monthDates : [],
  };
};

const buildFormFromBody = (body = {}) => ({
  id: typeof body.id === 'string' ? body.id : '',
  type: typeof body.type === 'string' ? body.type : 'basic',
  label: typeof body.label === 'string' ? body.label : '',
  enabled: parseBoolean(body.enabled),
  scheduleType: typeof body.schedule_type === 'string' ? body.schedule_type : 'interval',
  intervalDays: Number.parseInt(body.interval_days, 10) || 1,
  weekdays: numberList(body.weekdays),
  monthDates: numberList(body.month_dates),
});

const getLifeLogBasePath = (req) => req.baseUrl || '/admin/life_log';

const decorateReminder = (reminder) => ({
  ...reminder,
  id: reminder._id?.toString() || reminder.id || '',
  typeLabel: TYPE_LABELS[reminder.type] || reminder.type,
  scheduleLabel: buildScheduleLabel(reminder),
});

const renderReminderPage = async (req, res, {
  form = null,
  error = null,
  statusCode = 200,
} = {}) => {
  const reminders = await myLifeLogReminderService.listTriggers();
  const labels = myLifeLogService.getLabelSuggestions(new Date()).all;
  res.status(statusCode).render('my_life_log_reminders', {
    reminders: reminders.map(decorateReminder),
    form: form || buildBlankForm(),
    error,
    lifeLogBasePath: getLifeLogBasePath(req),
    labelOptions: labels,
    typeOptions: REMINDER_TYPES.map((type) => ({
      value: type,
      label: TYPE_LABELS[type] || type,
    })),
    weekdays: WEEKDAY_NAMES.map((label, value) => ({ value, label })),
    monthDates: Array.from({ length: 28 }, (_, index) => index + 1),
  });
};

exports.life_log_reminders_page = async (req, res) => {
  try {
    const editId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
    const editReminder = editId ? await myLifeLogReminderService.getTrigger(editId) : null;
    if (editId && !editReminder) {
      return renderReminderPage(req, res, {
        error: 'Reminder trigger not found.',
        statusCode: 404,
      });
    }
    return renderReminderPage(req, res, {
      form: buildFormFromReminder(editReminder),
    });
  } catch (error) {
    logger.error('Failed to render life log reminder page', {
      category: 'life_log_reminders',
      metadata: { message: error?.message || error },
    });
    return res.status(500).render('error_page', { error: 'Unable to load life log reminders right now.' });
  }
};

exports.life_log_save_reminder = async (req, res) => {
  const form = buildFormFromBody(req.body || {});
  try {
    await myLifeLogReminderService.saveTrigger({
      id: form.id,
      type: form.type,
      label: form.label,
      enabled: form.enabled,
      scheduleType: form.scheduleType,
      intervalDays: form.intervalDays,
      weekdays: form.weekdays,
      monthDates: form.monthDates,
    });
    return res.redirect(`${getLifeLogBasePath(req)}/reminders`);
  } catch (error) {
    logger.warning('Invalid life log reminder trigger', {
      category: 'life_log_reminders',
      metadata: { message: error?.message || error },
    });
    return renderReminderPage(req, res, {
      form,
      error: error?.message || 'Unable to save reminder trigger.',
      statusCode: 400,
    });
  }
};

exports.life_log_delete_reminder = async (req, res) => {
  try {
    await myLifeLogReminderService.deleteTrigger(req.params.id);
    return res.redirect(`${getLifeLogBasePath(req)}/reminders`);
  } catch (error) {
    logger.error('Failed to delete life log reminder trigger', {
      category: 'life_log_reminders',
      metadata: { message: error?.message || error },
    });
    return res.status(500).render('error_page', { error: 'Unable to delete life log reminder trigger.' });
  }
};
