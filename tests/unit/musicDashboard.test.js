const fs = require('fs');
const vm = require('vm');
const path = require('path');
const pug = require('pug');
const { parseLosslessJson } = require('../../utils/losslessJson');
function fixture() {
  const axios = { post: jest.fn().mockResolvedValue({ data: {} }), get: jest.fn().mockResolvedValue({ data: { containers: [] } }) };
  const logger = { warning: jest.fn(), notice: jest.fn() };
  const context = { exports: {}, __dirname: path.resolve('controllers'), process: { env: { AI_GATEWAY_BASE_URL: 'http://private-gateway.invalid', LLM_ADMIN_TOKEN: 'PRIVATE_ADMIN_TOKEN' } }, console, setTimeout,
    require: name => {
      if (name === 'axios') return axios;
      if (name === '../utils/logger') return logger;
      if (name === '../utils/apiDebugLogger') return { createApiDebugLogger: jest.fn() };
      if (name === '../services/musicGatewayService') return require('../../services/musicGatewayService');
      if (name.startsWith('../utils/') && !name.includes('OpenAI')) return require(path.resolve('controllers', name));
      if (name.startsWith('../services/')) return class {};
      if (['fs', 'path', 'crypto'].includes(name)) return require(name);
      return {};
    },
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('controllers/admincontroller.js', 'utf8'), context);
  return { context, axios, logger };
}
function render(dashboard) { return pug.renderFile('views/admin_ai_gateway.pug', { dashboard, loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [], csrfToken: 'A'.repeat(43) }); }
test.each(['models.json', 'models-legacy.json'])('%s: registered YuE2 stays dynamic and startable, music limits and mixed stats render', file => {
  const catalog = parseLosslessJson(fs.readFileSync(`tests/fixtures/music/${file}`, 'utf8'));
  const f = fixture();
  const dashboard = f.context.buildAiGatewayDashboard({ errors: {}, musicModels: catalog, containers: { containers: [{ id: 'yue2', name: 'yue2-standalone', state: 'exited', running: false, gpu_reservable: true }] }, limits: { music: { default_model: catalog.default_model, models: Object.fromEntries(catalog.models.map(m => [m.id, m])) } }, logsRaw: [JSON.stringify({ route: 'music_generate', model: 'yue2-3b', provider: 'yue2', status_code: 200, duration_sec: 80 }), JSON.stringify({ route: 'music_acestep15_generate', status_code: 200, duration_sec: 60 })].join('\n') });
  expect(dashboard.containers).toHaveLength(1); expect(dashboard.containers[0].id).toBe('yue2');
  expect(dashboard.musicCatalog.models[1].usable).toBe(true);
  expect(dashboard.logInsights.music.sampleCount).toBe(2);
  expect(dashboard.logInsights.music.models).toEqual([{ model: 'yue2-3b', count: 1 }, { model: 'unknown (historical)', count: 1 }]);
  const html = render(dashboard); expect(html).toContain('Music capabilities'); expect(html).toContain('State: startable'); expect(html).toContain('data-container-id="yue2"');
  expect(html).toContain('data-container-action="start"'); expect(html).toContain('9223372036854775807');
  expect(html).toContain('Recent /music/generate and legacy /music/acestep15/generate requests across models');
  expect(html).not.toContain('PRIVATE_ADMIN_TOKEN'); expect(html).not.toContain('private-gateway.invalid');
});
test('missing discovery gives old-release note and never fabricates a container', () => {
  const f = fixture(); const dashboard = f.context.buildAiGatewayDashboard({ errors: { musicModels: '404 Not Found' }, containers: { containers: [] } });
  expect(dashboard.containers).toHaveLength(0); expect(dashboard.musicCatalog).toBeNull();
  const html = render(dashboard); expect(html).toContain('Older Gateway release'); expect(html).not.toContain('data-container-id="yue2"');
});
test.each(['start', 'restart', 'stop'])('generic %s lifecycle has bounded operation budget and server-only token', async action => {
  const f = fixture(); const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await f.context.exports.ai_gateway_container_action({ params: { id: 'yue2', action }, body: {}, user: {} }, res);
  const [url, body, options] = f.axios.post.mock.calls[0];
  expect(url).toContain('/containers/yue2/' + action); expect(options.timeout).toBe(action === 'stop' ? 120000 : 900000);
  expect(options.headers).toEqual({ 'X-Admin-Token': 'PRIVATE_ADMIN_TOKEN' }); expect(options.maxRedirects).toBe(0);
  expect(f.axios.post).toHaveBeenCalledTimes(1); expect(JSON.stringify(res.json.mock.calls)).not.toContain('PRIVATE_ADMIN_TOKEN');
});
test('uncertain lifecycle timeout does not retry or expose provider details', async () => {
  const f = fixture(); f.axios.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'SECRET' }); const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await f.context.exports.ai_gateway_container_action({ params: { id: 'yue2', action: 'start' }, body: {}, user: {} }, res);
  expect(f.axios.post).toHaveBeenCalledTimes(1); expect(JSON.stringify(res.json.mock.calls)).toContain('uncertain'); expect(JSON.stringify(res.json.mock.calls)).not.toContain('SECRET');
});

test('registered dashboard safety middleware covers case/trailing-slash variants without capturing unrelated subfeatures', () => {
  const uses = [];
  const router = new Proxy({}, { get: (_target, name) => (...args) => { if (name === 'use') uses.push(args); } });
  const noop = (_req, _res, next) => next();
  vm.runInNewContext(fs.readFileSync('routes/admin.js', 'utf8'), {
    module: { exports: {} }, __dirname: path.resolve('routes'), process: { env: {} },
    require: name => {
      if (name === 'express') return { Router: () => router, json: () => noop, urlencoded: () => noop };
      if (name === 'express-rate-limit') return { rateLimit: () => noop };
      if (name === '../middleware/musicAccess') return { requireMusic: () => noop, CAPABILITIES: {}, csrf: { issueToken: noop, requireToken: noop } };
      if (name === '../middleware/sessionCsrf') return { createSessionCsrf: () => ({ issueToken: noop, requireToken: noop }) };
      if (['fs', 'path', 'crypto', 'multer'].includes(name)) return require(name);
      return {};
    },
  });
  const [pattern, capability, issue, mutationGuard] = uses.find(([pattern]) => pattern && typeof pattern.test === 'function');
  for (const path of ['/ai-gateway', '/ai-gateway/', '/AI-GATEWAY/reservation/', '/ai-gateway/containers/yue2/start/']) expect(pattern.test(path)).toBe(true);
  expect(pattern.test('/ai-gateway/modular-llm')).toBe(false);
  expect(typeof capability).toBe('function'); expect(typeof issue).toBe('function'); expect(typeof mutationGuard).toBe('function');
});
