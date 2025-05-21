const ScheduleTaskService = require('../services/scheduleTaskService');
const { Task, Palette } = require('../database');

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
    await doc.save();
    res.json({ ok: true });
  } catch(err) {
    next(err);
  }
};

/**
 * PATCH /api/tasks/:id/done - Mark as (un)done
 */
exports.toggleDoneApi = async function(req, res, next) {
  console.log(req.user.name, req.params.id, req.body.done);
  try {
    const userId = req.user.name;
    const id = req.params.id;
    // Optional: allow explicitly passing done=true/false for flexibility
    let done = req.body.done;
    if (done === undefined) done = true;
    const task = await Task.findOneAndUpdate(
      { _id: id, userId },
      { $set: { done: done } },
      { new: true }
    );
    if(!task) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true, done: task.done });
  } catch(err) {
    next(err);
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
  res.render('scheduleTask/formPresence', { error: null });
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
  res.render('scheduleTask/formTask', { error: null });
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
    await doc.save();
    res.redirect('/scheduleTask/calendar');
  } catch(err) {
    res.render('scheduleTask/formTask', { error: err.message, ...req.body });
  }
};

