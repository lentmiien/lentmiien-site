jest.mock('../../controllers/chat5controller', () => new Proxy({}, {
  get: (target, key) => {
    if (!target[key]) target[key] = jest.fn((req, res) => res.json({ csrfToken: res.locals.csrfToken }));
    return target[key];
  },
}));
jest.mock('../../controllers/chat5DocumentController', () => ({ uploadPdf: jest.fn(), getJob: jest.fn(), deleteJob: jest.fn() }));
jest.mock('../../controllers/chat5QuickSettingsController', () => ({ list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() }));
jest.mock('../../controllers/trainingDataController', () => ({ createEntry: jest.fn(), deleteEntry: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));

const express = require('express');
const router = require('../../routes/chat5');
const controller = require('../../controllers/chat5controller');
const Role = require('../../models/role');
let server, base, principal, session, authenticated;
const mutationPaths = ['/add_model_card', '/ai_model_cards/card-1', '/ai_model_cards/card-1/tokens', '/ai_model_cards/card-1/deprecation-date', '/ai_model_cards/card-1/delete'];

beforeEach(async () => {
  principal = { name: 'manager', type_user: 'admin' };
  session = {};
  authenticated = true;
  Role.findOne.mockResolvedValue(null);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.user = principal;
    req.session = session;
    req.isAuthenticated = () => authenticated;
    res.render = (_view, locals) => res.json({ error: locals.message });
    next();
  });
  app.use('/chat5', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/chat5`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

test.each(['anonymous', 'family', 'user'])('denies %s access to model-card reads and writes', async (role) => {
  if (role === 'anonymous') authenticated = false;
  else principal.type_user = role;
  for (const path of ['/ai_model_cards', ...mutationPaths]) {
    const response = await fetch(base + path, { method: path === '/ai_model_cards' ? 'GET' : 'POST' });
    expect(response.status).toBe(role === 'anonymous' ? 401 : 403);
    expect(response.headers.get('cache-control')).toContain('no-store');
  }
  expect(controller.ai_model_cards).not.toHaveBeenCalled();
  expect(controller.add_model_card).not.toHaveBeenCalled();
  expect(controller.update_model_card).not.toHaveBeenCalled();
});

test('admin and explicitly delegated managers receive private forms and can save with CSRF protection', async () => {
  for (const role of ['admin', 'user']) {
    principal.type_user = role;
    Role.findOne.mockImplementation(async filter => filter.type === 'user' ? { permissions: ['ai.model_cards.manage'] } : null);
    const page = await fetch(base + '/ai_model_cards');
    expect(page.status).toBe(200);
    const { csrfToken } = await page.json();
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const path of mutationPaths) {
      const response = await fetch(base + path, {
        method: 'POST', body: new URLSearchParams({ _csrf: csrfToken, is_thinking: 'true' }),
      });
      expect(response.status).toBe(200);
    }
  }
});

test.each(['missing', 'invalid', 'cross-origin'])('rejects %s CSRF before mutations', async (mode) => {
  await fetch(base + '/ai_model_cards');
  for (const path of mutationPaths) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: mode === 'cross-origin' ? { origin: 'https://untrusted.example' } : {},
      body: new URLSearchParams({ _csrf: mode === 'missing' ? '' : mode === 'invalid' ? 'invalid' : session.csrfToken }),
    });
    expect(response.status).toBe(403);
  }
  expect(controller.add_model_card).not.toHaveBeenCalled();
  expect(controller.update_model_card).not.toHaveBeenCalled();
});

test('GET cannot mutate model cards', async () => {
  for (const path of mutationPaths) expect((await fetch(base + path)).status).toBe(404);
  expect(controller.add_model_card).not.toHaveBeenCalled();
  expect(controller.update_model_card).not.toHaveBeenCalled();
});
