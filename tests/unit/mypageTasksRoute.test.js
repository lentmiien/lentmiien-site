jest.mock('../../database', () => ({ Task: { findOne: jest.fn() }, Palette: {} }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../services/scheduleTaskStatsService', () => ({}));
jest.mock('../../services/pushoverReminderService', () => ({ PUSHOVER_PRIORITY_OPTIONS: [] }));
jest.mock('../../services/scheduleTaskReminderService', () => ({
  scheduleTaskReminderService: { deletePendingForTask: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));

const express = require('express');
const { Task } = require('../../database');
const Role = require('../../models/role');
const logger = require('../../utils/logger');
const { scheduleTaskReminderService: reminders } = require('../../services/scheduleTaskReminderService');
const { router, prepareTaskShortcut } = require('../../routes/mypageTasks');

const id = '1234567890abcdef12345678';
const token = 'a'.repeat(43);
let server;
let base;
let principal;
let authenticated;
let task;

beforeEach(async () => {
  principal = { name: 'owner', type_user: 'user' };
  authenticated = true;
  task = { _id: id, userId: 'owner', type: 'todo', done: false, meta: { recurrence: 'untouched' }, save: jest.fn() };
  Task.findOne.mockImplementation(async (query) => (
    task && query._id === task._id && query.userId === task.userId
    && query.type.$in.includes(task.type) ? task : null
  ));
  Role.findOne.mockResolvedValue(null);
  reminders.deletePendingForTask.mockResolvedValue(2);
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => {
    req.user = principal;
    req.isAuthenticated = () => authenticated;
    req.session = { csrfToken: token };
    res.render = (_view, locals) => res.json({ message: locals.message });
    next();
  });
  app.get('/mypage', prepareTaskShortcut, (_req, res) => res.json(res.locals));
  app.use('/mypage/api/tasks', router);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

function complete({ taskId = id, body = { done: true }, headers = {}, method = 'PATCH', query = '' } = {}) {
  return fetch(`${base}/mypage/api/tasks/${taskId}/done${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}

test.each(['admin', 'family', 'user', 'explicit-grant'])('allows %s only within owner scope', async (role) => {
  principal.type_user = role;
  if (role === 'explicit-grant') Role.findOne.mockResolvedValue({ permissions: ['schedule.task.complete'] });
  const response = await complete();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toEqual({ ok: true, done: true, deletedReminders: 2 });
  expect(Task.findOne).toHaveBeenCalledWith({ _id: id, userId: 'owner', type: { $in: ['todo', 'tobuy'] } });
  expect(task.done).toBe(true);
  expect(task.save).toHaveBeenCalledTimes(1);
  expect(reminders.deletePendingForTask).toHaveBeenCalledWith('owner', id);
  expect(task.meta).toEqual({ recurrence: 'untouched' });
});

test.each(['todo', 'tobuy'])('completes exactly one %s and repeated completion does not save again', async (type) => {
  task.type = type;
  expect((await complete()).status).toBe(200);
  expect((await complete()).status).toBe(200);
  expect(task.save).toHaveBeenCalledTimes(1);
  expect(reminders.deletePendingForTask).toHaveBeenCalledTimes(2);
});

test.each(['anonymous', 'incomplete', 'ungranted'])('denies %s before accessing tasks', async (mode) => {
  if (mode === 'anonymous') { principal = null; authenticated = false; }
  if (mode === 'incomplete') principal.name = '';
  if (mode === 'ungranted') principal.type_user = 'other';
  expect((await complete()).status).toBe(mode === 'anonymous' ? 401 : 403);
  expect(Task.findOne).not.toHaveBeenCalled();
});

test.each(['missing', 'foreign', 'presence', 'foreign-admin'])('does not disclose or complete a %s task', async (mode) => {
  if (mode === 'missing') task = null;
  if (mode.startsWith('foreign')) task.userId = 'someone-else';
  if (mode === 'foreign-admin') principal.type_user = 'admin';
  if (mode === 'presence') task.type = 'presence';
  const response = await complete();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: 'Task not found.' });
  expect(reminders.deletePendingForTask).not.toHaveBeenCalled();
});

test.each([
  { headers: { 'X-CSRF-Token': '' } },
  { headers: { 'X-CSRF-Token': 'b'.repeat(43) } },
  { headers: { Origin: 'https://untrusted.invalid' } },
])('rejects forged browser requests: %j', async (options) => {
  expect((await complete(options)).status).toBe(403);
  expect(Task.findOne).not.toHaveBeenCalled();
});

test('accepts a valid token and same-origin request', async () => {
  expect((await complete({ headers: { Origin: base } })).status).toBe(200);
});

test.each([
  { taskId: 'invalid' }, { taskId: 'f'.repeat(25) }, { body: {} },
  { body: [] }, { body: { done: 'true' } }, { body: { done: false } },
  { body: { done: true, userId: 'someone-else' } },
  { body: { done: true, meta: 'x'.repeat(10000) } },
  { query: '?userId=someone-else' },
])('rejects invalid input before work: %#', async (options) => {
  expect((await complete(options)).status).toBe(400);
  expect(Task.findOne).not.toHaveBeenCalled();
});

test('GET cannot complete a task', async () => {
  expect((await complete({ method: 'GET' })).status).toBe(404);
  expect(Task.findOne).not.toHaveBeenCalled();
});

test.each(['lookup', 'reminders', 'save'])('logs and returns a generic error on %s failure', async (operation) => {
  const error = new Error('private diagnostic payload');
  if (operation === 'lookup') Task.findOne.mockRejectedValue(error);
  if (operation === 'reminders') reminders.deletePendingForTask.mockRejectedValue(error);
  if (operation === 'save') task.save.mockRejectedValue(error);
  const response = await complete();
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('private diagnostic');
  expect(logger.error).toHaveBeenCalledWith('Failed to complete a task from My Page', {
    category: 'schedule_task', metadata: { errorName: 'Error' },
  });
  if (operation === 'reminders') expect(task.save).not.toHaveBeenCalled();
});

test('issues the shared token and disables page analytics and caching', async () => {
  const response = await fetch(`${base}/mypage`);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toMatchObject({ csrfToken: token, gtag: false, canCompleteMypageTask: true });
});

test('capability lookup failure fails closed', async () => {
  principal.type_user = 'custom';
  Role.findOne.mockRejectedValue(new Error('unavailable'));
  expect((await complete()).status).toBe(503);
  expect(Task.findOne).not.toHaveBeenCalled();
});

test.each([
  { start: null, end: new Date('2020-01-01T00:00:00Z') },
  { start: new Date('2020-01-01T00:00:00Z'), end: null },
  { start: null, end: null },
])('date availability never prevents authorized completion: %#', async dates => {
  Object.assign(task, dates);
  expect((await complete()).status).toBe(200);
  expect(task.done).toBe(true);
  expect(task.save).toHaveBeenCalledTimes(1);
});
