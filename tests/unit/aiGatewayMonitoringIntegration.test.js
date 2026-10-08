jest.mock('../../database', () => ({ RoleModel: { findOne: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { RoleModel } = require('../../database');
const { createMonitoringService } = require('../../services/aiGatewayMonitoringService');
const logger = require('../../utils/logger');
let server, base, http, controller;
const raw = {
  health: { ok: false, status: 'degraded', failures: [{ kind: 'container', id: 'voicevox', detail: 'SECRET' }], upstreams: { voicevox: { ok: false, error: 'SECRET' } } },
  containers: { containers: [{ id: 'voicevox', state: 'exited', running: false, default_state: 'running', gpu_role: 'none' }] },
  queue: { running: true, active: null }, reservation: { active: false },
};
function loadController() {
  http = { get: jest.fn(async url => {
    const paths = { '/health': 'health', '/containers': 'containers', '/gpu/queue': 'queue', '/gpu/reservation': 'reservation' };
    return { data: raw[paths[new URL(url).pathname]] || {} };
  }), post: jest.fn(), delete: jest.fn() };
  const context = { exports: {}, __dirname: path.resolve('controllers'), process: { env: {} }, console, setTimeout, require: name => {
    if (name === 'axios') return http;
    if (name === '../utils/logger') return logger;
    if (name === '../utils/apiDebugLogger') return { createApiDebugLogger: jest.fn() };
    if (name === '../services/aiGatewayMonitoringService') return { createMonitoringService: options => createMonitoringService({ ...options, http, log: logger }) };
    if (name === '../services/musicGatewayService') return require('../../services/musicGatewayService');
    if (name.startsWith('../utils/') && !name.includes('OpenAI')) return require(path.resolve('controllers', name));
    if (name.startsWith('../services/')) return class {};
    if (['fs', 'path', 'crypto'].includes(name)) return require(name);
    return {};
  } };
  vm.runInNewContext(fs.readFileSync('controllers/admincontroller.js', 'utf8'), context);
  return context.exports;
}
beforeAll(async () => {
  controller = loadController();
  const router = express.Router();
  // Execute real route declarations and the matching real middleware in order;
  // unrelated admin feature handlers are excluded from this focused harness.
  const registration = new Proxy({}, { get: (_target, method) => (...args) => {
    if (method === 'use' && args[0]?.test?.('/ai-gateway/monitoring')) router.use(new RegExp(args[0].source, args[0].flags), ...args.slice(1));
    if (method === 'get' && args[0] === '/ai-gateway/monitoring') router.get(...args);
  } });
  vm.runInNewContext(fs.readFileSync('routes/admin.js', 'utf8'), {
    module: { exports: {} }, __dirname: path.resolve('routes'), process: { env: {} }, require: name => {
      if (name === 'express') return { Router: () => registration, json: express.json, urlencoded: express.urlencoded };
      if (name === 'express-rate-limit') return { rateLimit: () => (_req, _res, next) => next() };
      if (name === '../controllers/admincontroller') return controller;
      if (['../middleware/musicAccess', '../middleware/requireCapabilities', '../middleware/sessionCsrf', '../database', '../utils/logger'].includes(name)) return require(path.resolve('routes', name));
      if (['fs', 'path', 'crypto', 'multer'].includes(name)) return require(name);
      return {};
    },
  });
  const app = express();
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    if (role) req.user = { _id: 'test-id', name: 'tester', type_user: role };
    req.isAuthenticated = () => Boolean(req.user);
    req.session = {};
    res.render = (_view, locals) => res.json({ message: locals.message });
    next();
  });
  app.use('/admin', router);
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server ? server.close(resolve) : resolve()));
beforeEach(() => RoleModel.findOne.mockResolvedValue({ permissions: [] }));
const request = (role, options = {}) => fetch(base + '/admin/ai-gateway/monitoring', { ...options, headers: role ? { 'x-test-role': role } : {} });
test.each(['', 'family', 'user'])('rejects anonymous/ungranted %s before Gateway calls', async role => {
  const result = await request(role);
  expect(result.status).toBe(role ? 403 : 401);
  expect(result.headers.get('cache-control')).toContain('private, no-store');
  expect(http.get).not.toHaveBeenCalled();
});
test('legacy music grant alone does not grant the new monitoring capability', async () => {
  RoleModel.findOne.mockResolvedValue({ permissions: ['music.gateway.manage'] });
  expect((await request('user')).status).toBe(403);
  expect(http.get).not.toHaveBeenCalled();
});
test('admin bundle permits sanitized read-only observation', async () => {
  const result = await request('admin');
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toContain('private, no-store');
  const data = await result.json();
  expect(data.services[0].availability).toBe('Unavailable — expected running');
  expect(JSON.stringify(data)).not.toContain('SECRET');
  expect(http.get).toHaveBeenCalledTimes(4);
  expect(http.post).not.toHaveBeenCalled(); expect(http.delete).not.toHaveBeenCalled();
});
test('explicit capability grants work at this middleware layer and lookup failures fail closed', async () => {
  // The outer /admin role gate is intentionally unchanged and still restricts the real app to admins.
  RoleModel.findOne.mockResolvedValue({ permissions: ['music.gateway.manage', 'ai_gateway.monitor.read'] });
  expect((await request('user')).status).toBe(200);
  RoleModel.findOne.mockRejectedValue(new Error('SECRET'));
  const result = await request('admin');
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('SECRET');
});
test('dashboard reuses existing snapshots for monitoring without additional calls', async () => {
  const res = { set: jest.fn().mockReturnThis(), render: jest.fn() };
  await controller.ai_gateway_dashboard({}, res);
  const data = res.render.mock.calls[0][1].dashboard;
  expect(data.monitoring.services[0].guidance).toBe('voicevox');
  expect(data.monitoring.complete).toBe(true);
  const monitoringPaths = ['/health', '/containers', '/gpu/queue', '/gpu/reservation'];
  for (const endpoint of monitoringPaths) expect(http.get.mock.calls.filter(([url]) => new URL(url).pathname === endpoint)).toHaveLength(1);
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
});
