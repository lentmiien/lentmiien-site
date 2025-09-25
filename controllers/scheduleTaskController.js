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
  res.render('scheduleTask/formTask', { error: null, prefillStart: prefill ? prefill.toISOString().slice(0,16) : '' });
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
 * - Sections: Expired, then current month, then future months that have tasks
 * - Effective date = end || start || today
 */
exports.renderUpcomingTasksPage = async function(req, res, next) {
  try {
    const userId = req.user.name;
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const raw = await Task.find({
      userId,
      done: false,
      type: { $in: ['todo', 'tobuy'] }
    }).lean();

    const tasks = raw.map(t => {
      const eff = t.end ? new Date(t.end) : (t.start ? new Date(t.start) : new Date(today));
      return { ...t, effectiveDate: eff };
    }).sort((a, b) => a.effectiveDate - b.effectiveDate);

    const expired = [];
    const futureMap = new Map(); // key: 'YYYY-MM' -> { label, items: [] }

    for (const t of tasks) {
      const d = t.effectiveDate;
      if (d < startOfToday) {
        expired.push(t);
        continue;
      }
      const y = d.getFullYear();
      const m = d.getMonth(); // 0-based
      const key = `${y}-${String(m+1).padStart(2, '0')}`;
      const label = `${d.toLocaleString('en-US', { month: 'long' })} - ${y}`;
      if (!futureMap.has(key)) futureMap.set(key, { key, label, items: [] });
      futureMap.get(key).items.push(t);
    }

    const groups = Array.from(futureMap.values()).sort((a, b) => a.key.localeCompare(b.key));

    res.render('scheduleTask/upcoming', {
      expired,
      groups,
      today
    });
  } catch (err) {
    next(err);
  }
};

