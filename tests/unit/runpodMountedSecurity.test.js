jest.mock('../../database', () => ({ RoleModel: { findOne: jest.fn().mockResolvedValue(null) } }));
jest.mock('../../controllers/runpodAdminController', () => ({ index: jest.fn((req, res) => res.json({ ok: true })) }));
jest.mock('../../controllers/runpodPodAdminController', () => new Proxy({}, {
  get: (object, key) => {
    if (!object[key]) object[key] = jest.fn((req, res) => res.json({ action: key }));
    return object[key];
  },
}));
const http = require('http');
const express = require('express');
const { RoleModel } = require('../../database');
const { RUNPOD_READ_CAPABILITIES } = require('../../utils/runpodAuthorizationPolicy');
const controller = require('../../controllers/runpodPodAdminController');
const router = require('../../routes/runpodAdmin');
const token = 'a'.repeat(43);
let server;
let origin;
let principal;

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((req, res, next) => {
    req.user = principal;
    req.session = { csrfToken: token };
    res.render = (view, model) => res.json({ view, message: model.message });
    next();
  });
  app.use('/admin/runpod', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  principal = { name: 'admin', type_user: 'admin' };
  RoleModel.findOne.mockResolvedValue(null);
});
const post = (path, csrf = token, requestOrigin = origin) => fetch(`${origin}/admin/runpod${path}`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: requestOrigin },
  body: new URLSearchParams({ _csrf: csrf }),
});

describe('mounted Runpod routes retain capability and CSRF checks', () => {
  test.each([null, { name: 'family', type_user: 'family' }, { name: 'user', type_user: 'user' }])('denies dashboard and mutations for %j', async (user) => {
    principal = user;
    expect((await fetch(`${origin}/admin/runpod/`)).status).toBe(403);
    expect((await post('/pods/test/stop')).status).toBe(403);
    expect(controller.stopPod).not.toHaveBeenCalled();
  });
  test.each(['/pods/test/start', '/pods/test/stop', '/pods', '/network-volumes'])('rejects missing CSRF on %s', async (path) => {
    const response = await post(path, '');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  test('rejects an untrusted origin despite a valid token', async () => {
    expect((await post('/pods/test/stop', token, 'https://attacker.invalid')).status).toBe(403);
    expect(controller.stopPod).not.toHaveBeenCalled();
  });
  test('read capabilities alone cannot stop a pod', async () => {
    principal = { name: 'reader', type_user: 'user' };
    RoleModel.findOne.mockResolvedValue({ permissions: RUNPOD_READ_CAPABILITIES });
    expect((await fetch(`${origin}/admin/runpod/`)).status).toBe(200);
    expect((await post('/pods/test/stop')).status).toBe(403);
    expect(controller.stopPod).not.toHaveBeenCalled();
  });
  test('allows an explicitly authorized mutation with valid CSRF, using the session principal', async () => {
    const response = await post('/pods/test/stop');
    expect(response.status).toBe(200);
    expect(controller.stopPod).toHaveBeenCalledTimes(1);
    expect(controller.stopPod.mock.calls[0][0].user).toBe(principal);
  });
  test('GET cannot trigger a mutation', async () => {
    expect((await fetch(`${origin}/admin/runpod/pods/test/stop`)).status).toBe(404);
    expect(controller.stopPod).not.toHaveBeenCalled();
  });
});
