jest.mock('../../controllers/chat5controller', () => new Proxy({}, {
  get: (target, key) => {
    if (!target[key]) target[key] = jest.fn((req, res) => res.json({ user: req.user.name, analytics: res.locals.gtag }));
    return target[key];
  },
}));
jest.mock('../../controllers/chat5DocumentController', () => ({ uploadPdf: jest.fn(), getJob: jest.fn(), deleteJob: jest.fn() }));
jest.mock('../../controllers/chat5QuickSettingsController', () => ({ list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() }));
jest.mock('../../controllers/trainingDataController', () => ({ createEntry: jest.fn(), deleteEntry: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));


jest.mock('../../models/useraccount', () => ({ findById: jest.fn() }));
const express = require('express');
const router = require('../../routes/chat5');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const controller = require('../../controllers/chat5controller');
let server, base, principal, authenticated;
const session = {};
const messageAction = `/chat5/chat/${'a'.repeat(24)}/messages/${'b'.repeat(24)}/remove`;

beforeEach(async () => {
  delete session.csrfToken;
  authenticated = true;
  principal = { _id: 'a'.repeat(24), name: 'validated-owner', type_user: 'admin' };
  User.findById.mockImplementation(() => ({ select: () => ({ lean: async () => principal }) }));
  Role.findOne.mockResolvedValue(null);
  const app = express();
  app.use((req, res, next) => {
    req.user = { _id: 'a'.repeat(24), name: 'stale-session-name', type_user: 'admin' };
    req.isAuthenticated = () => authenticated;
    req.session = session;
    res.render = (_view, locals) => res.json({ error: locals.message });
    next();
  });
  app.use('/chat5', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/chat5/top`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

test.each(['anonymous', 'family', 'user', 'deleted'])('list rejects %s before reading conversations or cards', async role => {
  if (role === 'anonymous') authenticated = false;
  else if (role === 'deleted') principal = null;
  else principal.type_user = role;
  const response = await fetch(base);
  expect(response.status).toBe(role === 'anonymous' ? 401 : 403);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(controller.view_chat5_top).not.toHaveBeenCalled();
});

test.each(['admin', 'family', 'user'])('list allows %s with read capability using refreshed identity', async role => {
  principal.type_user = role;
  if (role !== 'admin') Role.findOne.mockResolvedValue({ permissions: ['chat.conversation.read'] });
  const response = await fetch(`${base}?user=foreign`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ user: 'validated-owner', analytics: false });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(controller.view_chat5_top).toHaveBeenCalledTimes(1);
});

test.each(['anonymous', 'read-only', 'missing token', 'foreign origin', 'GET'])('denies message action for %s', async condition => {
  session.csrfToken = 'x'.repeat(43);
  if (condition === 'anonymous') authenticated = false;
  if (condition === 'read-only') {
    principal.type_user = 'user';
    Role.findOne.mockResolvedValue({ permissions: ['chat.conversation.read'] });
  }
  const headers = { Accept: 'application/json', 'X-CSRF-Token': session.csrfToken };
  if (condition === 'missing token') delete headers['X-CSRF-Token'];
  if (condition === 'foreign origin') headers.Origin = 'https://other.invalid';
  const response = await fetch(new URL(messageAction, base), { method: condition === 'GET' ? 'GET' : 'POST', headers });
  expect(response.status).toBe(condition === 'anonymous' ? 401 : condition === 'GET' ? 404 : 403);
  expect(controller.changeChatMessage).not.toHaveBeenCalled();
});

test.each(['admin', 'family', 'user'])('message action for authorized %s uses the refreshed identity and issued token', async role => {
  principal.type_user = role;
  Role.findOne.mockResolvedValue({ permissions: ['chat.conversation.read', 'chat.conversation.write'] });
  await fetch(new URL('/chat5/chat/NEW', base));
  expect(session.csrfToken).toHaveLength(43);
  const response = await fetch(new URL(messageAction, base), {
    method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken },
  });
  expect(await response.json()).toEqual({ user: 'validated-owner', analytics: false });
  expect(response.headers.get('cache-control')).toContain('no-store');
});
