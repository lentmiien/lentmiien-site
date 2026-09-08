const ScheduleTaskService = require('../services/scheduleTaskService');
const ScheduleTaskStatsService = require('../services/scheduleTaskStatsService');
const {
  PUSHOVER_PRIORITY_OPTIONS,
} = require('../services/pushoverReminderService');
const {
  MAX_TASK_REMINDERS,
  TaskReminderValidationError,
  scheduleTaskReminderService,
} = require('../services/scheduleTaskReminderService');
const { Task, Palette } = require('../database');
const logger = require('../utils/logger');
const { taskDates, taskMonth, formatTaskDate } = require('../utils/scheduleTaskDates');

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function taskReminderRowsFromBody(body = {}) {
  const anchors = asArray(body.reminder_anchor);
  const days = asArray(body.reminder_days);
  const hours = asArray(body.reminder_hours);
  const minutes = asArray(body.reminder_minutes);
  const priorities = asArray(body.reminder_priority);
  const count = Math.max(
    anchors.length,
    days.length,
    hours.length,
    minutes.length,
    priorities.length
  );

  return Array.from({ length: count }, (_, index) => ({
    anchor: anchors[index] ?? '',
    days: days[index] ?? '0',
    hours: hours[index] ?? '0',
    minutes: minutes[index] ?? '0',
    priority: priorities[index] ?? '0',
  }));
}

function taskFormLocals(body = {}, { error = null, prefillStart = '' } = {}) {
  return {
    error,
    form: {
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : '',
      type: body.type === 'tobuy' ? 'tobuy' : 'todo',
      start: typeof body.start === 'string' ? body.start : prefillStart,
      end: typeof body.end === 'string' ? body.end : '',
    },
    reminderRows: taskReminderRowsFromBody(body),
    maxTaskReminders: MAX_TASK_REMINDERS,
    priorityOptions: PUSHOVER_PRIORITY_OPTIONS,
  };
}

async function deletePendingTaskReminders(task, operation) {
  try {
    return await scheduleTaskReminderService.deletePendingForTask(task.userId, task._id);
  } catch (error) {
    await logger.error('Failed to delete pending Pushover reminders for a task', {
      category: 'schedule_task_reminders',
      metadata: {
        operation,
        taskId: task._id?.toString() || null,
        error: error.message,
      },
    });
    throw error;
  }
}

/**
 * GET /calendar - Main calendar page
 */
exports.renderCalendarPage = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const today = ScheduleTaskService.roundToSlot(new Date());
    // Display 3-day window; you can derive from query or use today
    const from = today;
    const to = new Date(from.getTime() + 3 * 24 * 60 * 60 * 1000);
    const { presences, tasks } = await ScheduleTaskService.getTasksForWindow(userId, from, to);
    const palette = await ScheduleTaskService.getPalette();
    res.render('scheduleTask/calendar', { from, to, presences, tasks, palette });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/tasks - List tasks for date window
 */
exports.listTasksApi = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to   = req.query.to   ? new Date(req.query.to)   : new Date(Date.now() + 3*24*60*60*1000);
    const { presences, tasks } = await ScheduleTaskService.getTasksForWindow(userId, from, to);
    res.json({ presences, tasks });
  } catch(err) {
    next(err);
  }
};

/**
 * POST /api/tasks - Create new task or presence
 */
exports.createTaskApi = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const { type, title, description, location, purpose,
            start, end } = req.body;
    // Server-side validation, further checks can be moved to middleware/Joi
    let doc = new Task({
      userId, type, title, description,
      location, purpose,
      start: start ? new Date(start) : null,
      end:   end ? new Date(end) : null,
      done: false
    });
    if(type === 'presence') {
      // Check for overlap
      const conflicts = await ScheduleTaskService.detectPresenceConflict(
        userId, doc.start, doc.end
      );
      if(conflicts.length > 0) {
        return res.status(409).json({
          message: 'Presence overlaps with existing schedule',
          conflicts: conflicts.map(c => ({
            _id: c._id, title: c.title, start: c.start, end: c.end
          }))
        });
      }
    }
    await doc.save();
    res.status(201).json({ ok: true, id: doc._id });
  } catch(err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation Error', errors: err.errors });
    }
    next(err);
  }
};

/**
 * PATCH /api/tasks/:id - Update task
 */
exports.updateTaskApi = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const id = req.params.id;
    let patch = req.body;
    if(patch.start) patch.start = new Date(patch.start);
    if(patch.end) patch.end = new Date(patch.end);
    // First load document
    let doc = await Task.findOne({ _id: id, userId });
    if(!doc) return res.status(404).json({ message: 'Not found' });
    Object.assign(doc, patch);

    // If type or start/end has changed and task is presence, check overlap
    if(doc.type === 'presence' && (patch.start || patch.end)) {
      const conflicts = await ScheduleTaskService.detectPresenceConflict(
        userId, doc.start, doc.end, doc._id
      );
      if(conflicts.length > 0) {
        return res.status(409).json({
          message: 'Presence overlaps with existing schedule',
          conflicts: conflicts.map(c => ({
            _id: c._id, title: c.title, start: c.start, end: c.end
          }))
        });
      }
    }
    const completesTask = Object.prototype.hasOwnProperty.call(patch, 'done') && doc.done;
    if (completesTask && typeof doc.validate === 'function') {
      await doc.validate();
    }
    const deletedReminders = completesTask
      ? await deletePendingTaskReminders(doc, 'api-update-completed')
      : 0;
    await doc.save();
    res.json({ ok: true, deletedReminders });
  } catch(err) {
    next(err);
  }
};

/**
 * PATCH /api/tasks/:id/done - Mark as (un)done
 */
exports.toggleDoneApi = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const id = req.params.id;
    // Optional: allow explicitly passing done=true/false for flexibility
    const task = await Task.findOne({ _id: id, userId });
    if(!task) return res.status(404).json({ message: 'Not found' });
    let done = req.body.done;
    if (done === undefined) done = true;
    const deletedReminders = await saveTaskCompletion(task, done);
    res.json({ ok: true, done: task.done, deletedReminders });
  } catch(err) {
    next(err);
  }
};

// Shared with the My Page shortcut so reminder and document semantics stay aligned.
async function saveTaskCompletion(task, done, { skipUnchangedSave = false } = {}) {
  const unchanged = task.done === done;
  task.done = done;
  const deletedReminders = task.done
    ? await deletePendingTaskReminders(task, 'mark-completed')
    : 0;
  if (!skipUnchangedSave || !unchanged) await task.save();
  return deletedReminders;
}

exports.completeMypageTaskApi = async function(req, res) {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)
    || Object.keys(req.query || {}).length
    || !req.body || Array.isArray(req.body)
    || Object.keys(req.body).length !== 1 || req.body.done !== true) {
    return res.status(400).json({ ok: false, error: 'Invalid task completion request.' });
  }
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      userId: req.user.name,
      type: { $in: ['todo', 'tobuy'] },
    });
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found.' });
    // Repeating an acknowledged completion must not change its completion timestamp.
    const deletedReminders = await saveTaskCompletion(task, true, { skipUnchangedSave: true });
    return res.json({ ok: true, done: true, deletedReminders });
  } catch (error) {
    logger.error('Failed to complete a task from My Page', {
      category: 'schedule_task',
      metadata: { errorName: error?.name || 'Error' },
    });
    return res.status(500).json({ ok: false, error: 'Unable to complete task. Reload and try again.' });
  }
};

/**
 * GET /api/palette - Get palette
 */
exports.paletteApi = async function(req, res, next) {
  try {
    const palette = await ScheduleTaskService.getPalette();
    res.json(palette);
  } catch(err) {
    next(err);
  }
};

exports.renderPresenceForm = (req, res) => {
  const prefill = req.query.prefill ? new Date(req.query.prefill) : null;
  res.render('scheduleTask/formPresence', { error: null, prefillStart: prefill ? prefill.toISOString().slice(0,16) : ''});
};

exports.savePresence = async (req, res, next) => {
  const userId = req.user.name;
  try {
    const { title, location, purpose, start, end } = req.body;
    let doc = new Task({
      userId,
      title,
      type: 'presence',
      location,
      purpose,
      start: ScheduleTaskService.roundToSlot(new Date(start)),
      end:   ScheduleTaskService.roundToSlot(new Date(end)),
    });
    // Check for overlap
    const conflicts = await ScheduleTaskService.detectPresenceConflict(
      userId, doc.start, doc.end
    );
    if (conflicts.length > 0) {
      return res.render('scheduleTask/formPresence', {
        error: 'Presence overlaps with existing schedule',
        conflicts,
        ...req.body
      });
    }
    await doc.save();
    return res.redirect('/scheduleTask/calendar');
  } catch(err) {
    res.render('scheduleTask/formPresence', { error: err.message, ...req.body });
  }
};

exports.renderTaskForm = (req, res) => {
  const prefill = req.query.prefill ? new Date(req.query.prefill) : null;
  const prefillStart = prefill && !Number.isNaN(prefill.getTime())
    ? prefill.toISOString().slice(0, 16)
    : '';
  res.render('scheduleTask/formTask', taskFormLocals({}, { prefillStart }));
};

exports.saveTask = async (req, res, next) => {
  const userId = req.user.name;
  try {
    const { title, description, type, start, end } = req.body;
    let doc = new Task({
      userId,
      type,
      title,
      description,
      start: start ? ScheduleTaskService.roundToSlot(new Date(start)) : null,
      end: end ? ScheduleTaskService.roundToSlot(new Date(end)) : null,
      done: false,
    });
    const reminderRows = taskReminderRowsFromBody(req.body);
    await scheduleTaskReminderService.saveTaskWithReminders(doc, reminderRows);
    res.redirect('/scheduleTask/calendar');
  } catch(err) {
    const isValidationError = err instanceof TaskReminderValidationError
      || err.name === 'ValidationError';
    if (!isValidationError && !err.taskReminderPersistenceLogged) {
      await logger.error('Failed to create schedule task', {
        category: 'schedule_task_reminders',
        metadata: { error: err.message },
      });
    }
    res.status(isValidationError ? 400 : 500).render('scheduleTask/formTask', taskFormLocals(req.body, {
      error: err.message,
    }));
  }
};

exports.deleteTask = async (req, res, next) => {
  const userId = req.user.name;
  try {
    const task = await Task.findOne({ _id: req.params.id, userId });
    if (!task) return res.status(404).send('Not found');
    await deletePendingTaskReminders(task, 'task-deleted');
    await task.deleteOne();
    return res.redirect('/scheduleTask/upcoming');
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /edit/:id - Render edit form for an existing task
 */
exports.renderEditForm = async (req, res, next) => {
  try {
    const userId = req.user.name;
    const id = req.params.id;
    const doc = await Task.findOne({ _id: id, userId }).lean();
    if (!doc) return res.status(404).send('Not found');
    res.render('scheduleTask/edit', {
      doc,
      isPresence: doc.type === 'presence',
      error: null
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /edit/:id - Update an existing task from form submit
 */
exports.saveEdit = async (req, res, next) => {
  const userId = req.user.name;
  const id = req.params.id;
  try {
    const doc = await Task.findOne({ _id: id, userId });
    if (!doc) return res.status(404).send('Not found');

    // Common fields
    if (typeof req.body.title === 'string') doc.title = req.body.title;

    if (doc.type === 'presence') {
      // Presence-specific fields
      if (typeof req.body.location === 'string') doc.location = req.body.location;
      if (typeof req.body.purpose === 'string') doc.purpose = req.body.purpose;

      if (req.body.start) doc.start = ScheduleTaskService.roundToSlot(new Date(req.body.start));
      if (req.body.end)   doc.end   = ScheduleTaskService.roundToSlot(new Date(req.body.end));

      // Validate and check overlap (exclude self)
      const conflicts = await ScheduleTaskService.detectPresenceConflict(
        userId, doc.start, doc.end, doc._id
      );
      if (conflicts.length > 0) {
        return res.render('scheduleTask/edit', {
          doc: { ...doc.toObject(), start: doc.start, end: doc.end },
          isPresence: true,
          error: 'Presence overlaps with existing schedule',
          conflicts
        });
      }
    } else {
      // Task (todo/tobuy)
      if (typeof req.body.description === 'string') doc.description = req.body.description;
      if (req.body.start) doc.start = ScheduleTaskService.roundToSlot(new Date(req.body.start));
      if (req.body.end)   doc.end   = ScheduleTaskService.roundToSlot(new Date(req.body.end));
    }

    await doc.save();
    return res.redirect('/scheduleTask/calendar');
  } catch (err) {
    // Re-render with error
    try {
      const leanDoc = await Task.findOne({ _id: id, userId }).lean();
      if (!leanDoc) return res.status(404).send('Not found');
      res.render('scheduleTask/edit', {
        doc: leanDoc,
        isPresence: leanDoc.type === 'presence',
        error: err.message
      });
    } catch (e) {
      next(err);
    }
  }
};

/**
 * GET /upcoming - Upcoming tasks grouped by month
 * - Only non-completed tasks (type in ['todo','tobuy'])
 * - Overdue first, then all planning months, without a start horizon.
 * - Only a deadline can be overdue; available undated tasks use the current month.
 */
exports.renderUpcomingTasksPage = async function(req, res, next) {
  try {
    const today = new Date();
    const raw = await Task.find({
      userId: req.user.name,
      done: false,
      type: { $in: ['todo', 'tobuy'] }
    }).lean();
    const tasks = raw.map(t => ({ ...t, ...taskDates(t, today) }))
      .sort((a, b) => a.planningDate - b.planningDate || String(a._id).localeCompare(String(b._id)));
    const overdueTasks = [];
    const months = new Map();
    for (const task of tasks) {
      if (task.status === 'Overdue') {
        overdueTasks.push(task);
        continue;
      }
      const { key, label } = taskMonth(task.planningDate);
      if (!months.has(key)) months.set(key, { key, label, items: [] });
      months.get(key).items.push(task);
    }
    // Page-specific locals cannot be shadowed by the layout's navigation groups.
    const taskGroups = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    res.render('scheduleTask/upcoming', { overdueTasks, taskGroups, formatTaskDate });
  } catch (err) {
    logger.error('Failed to load upcoming tasks', {
      category: 'schedule_task', metadata: { errorName: err.name },
    });
    next(err);
  }
};

/**
 * GET /statistics - Schedule task statistics and leaderboards
 */
exports.renderStatisticsPage = async function(req, res, next) {
  try {
    const currentUserId = req.user.name;
    const stats = await ScheduleTaskStatsService.getDashboardData({ currentUserId });

    res.render('scheduleTask/statistics', {
      ...stats
    });
  } catch (err) {
    next(err);
  }
};

exports._test = {
  taskFormLocals,
  taskReminderRowsFromBody,
};
