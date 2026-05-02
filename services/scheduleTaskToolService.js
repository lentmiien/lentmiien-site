const { Task } = require('../database');
const ScheduleTaskService = require('./scheduleTaskService');

const FIXED_USER_ID = 'Lennart';

function createInputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title) {
    throw createInputError('title is required.');
  }
  return title;
}

function normalizeDescription(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function parseDateValue(value, fieldName, { required = false, roundToSlot = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw createInputError(`${fieldName} is required.`);
    }
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createInputError(`${fieldName} must be a valid date or datetime string.`);
  }

  return roundToSlot ? ScheduleTaskService.roundToSlot(date) : date;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function serializeTask(task) {
  return {
    id: task && task._id ? task._id.toString() : '',
    userId: task && task.userId ? task.userId : FIXED_USER_ID,
    type: task && task.type ? task.type : '',
    title: task && task.title ? task.title : '',
    description: task && task.description ? task.description : '',
    start: toIsoString(task ? task.start : null),
    end: toIsoString(task ? task.end : null),
    done: Boolean(task && task.done),
    meta: task && task.meta ? task.meta : null,
    createdAt: toIsoString(task ? task.createdAt : null),
    updatedAt: toIsoString(task ? task.updatedAt : null),
  };
}

function buildToolCreationMeta(context = {}) {
  return {
    createdByToolCall: true,
    toolName: context.toolName || null,
    handlerKey: context.handlerKey || null,
    toolCallId: context.toolCallId || context.callId || null,
    createdBy: context.createdBy || 'Tool',
    source: context.source || 'tool-call',
    createdAt: new Date().toISOString(),
  };
}

function getEffectiveDateString(task) {
  return task.end || task.start || task.createdAt || task.updatedAt || null;
}

function compareTasksByEffectiveDate(left, right) {
  const leftDate = getEffectiveDateString(left);
  const rightDate = getEffectiveDateString(right);

  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  if (leftDate && !rightDate) {
    return -1;
  }
  if (!leftDate && rightDate) {
    return 1;
  }

  return (left.title || '').localeCompare(right.title || '');
}

class ScheduleTaskToolService {
  async createTodo(args = {}, context = {}) {
    return this.createTask(args, context, 'todo');
  }

  async createTobuy(args = {}, context = {}) {
    return this.createTask(args, context, 'tobuy');
  }

  async fetchTodos(args = {}, context = {}) {
    return this.fetchTasks(args, context, 'todo');
  }

  async fetchTobuys(args = {}, context = {}) {
    return this.fetchTasks(args, context, 'tobuy');
  }

  async createTask(args = {}, context = {}, type) {
    const title = normalizeTitle(args.title);
    const description = normalizeDescription(args.description);
    const start = parseDateValue(args.start, 'start', { roundToSlot: true });
    const end = parseDateValue(args.end, 'end', { roundToSlot: true });

    if (start && end && end < start) {
      throw createInputError('end must be the same as or after start.');
    }

    const doc = new Task({
      userId: FIXED_USER_ID,
      type,
      title,
      description,
      start,
      end,
      done: false,
      meta: buildToolCreationMeta(context),
    });

    await doc.save();

    return {
      ok: true,
      userId: FIXED_USER_ID,
      taskType: type,
      task: serializeTask(doc),
    };
  }

  async fetchTasks(args = {}, _context = {}, type) {
    const from = parseDateValue(args.from ?? args.start, 'from', { required: true });
    const to = parseDateValue(args.to ?? args.end, 'to', { required: true });

    if (to < from) {
      throw createInputError('to must be the same as or after from.');
    }

    const docs = await Task.find({
      userId: FIXED_USER_ID,
      type,
      done: false,
      $and: [
        { $or: [{ start: null }, { start: { $lte: to } }] },
        { $or: [{ end: null }, { end: { $gte: from } }] },
      ],
    }).lean();

    const tasks = (docs || [])
      .map((doc) => serializeTask(doc))
      .sort(compareTasksByEffectiveDate);

    return {
      ok: true,
      userId: FIXED_USER_ID,
      taskType: type,
      from: from.toISOString(),
      to: to.toISOString(),
      count: tasks.length,
      tasks,
    };
  }
}

module.exports = ScheduleTaskToolService;
