const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const pug = require('pug');
const { createTaricAdminRouter } = require('../../routes/taricAdmin');
const controller = require('../../controllers/taricHistoryGuideController');
const historyService = require('../../services/taric/history');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));

let server, base, service, history;
beforeEach(async () => {
  history = { detail: jest.fn(), list: jest.fn(), review: jest.fn(), preview: jest.fn(), download: jest.fn() };
  jest.spyOn(historyService, 'createHistory').mockReturnValue(history);
  service = { adminPrincipal: jest.fn(), transport: { adapters: jest.fn() }, readiness: jest.fn() };
  const app = express();
  app.set('views', path.join(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.use((req, res, next) => {
    const role = req.headers['x-synthetic-role'];
    req.user = role ? { _id: 'a'.repeat(24), type_user: role, name: req.headers['x-synthetic-grant'] ? 'synthetic-granted' : 'synthetic' } : null;
    req.isAuthenticated = () => Boolean(req.user);
    req.session = {};
    // Keep denied responses independent of the site's unrelated shared layout.
    const render = res.render.bind(res);
    res.render = (view, locals) => view === 'accessDenied' ? res.send('Access denied') : render(view, locals);
    next();
  });
  app.use('/admin/taric', createTaricAdminRouter(service, { roleModel: { findOne: jest.fn(async query => query.type === 'user' && query.name === 'synthetic-granted' ? { permissions: ['taric.tool.manage'] } : null) } }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  jest.restoreAllMocks();
});

test('static guide passes capability guards and never reaches :id, history, DB or provider operations', async () => {
  for (const [role, grant, status] of [[null, false, 401], ['user', false, 403], ['family', false, 403],
    ['admin', false, 200], ['user', true, 200]]) {
    const response = await fetch(`${base}/admin/taric/history/guide`, { headers: {
      ...(role ? { 'x-synthetic-role': role } : {}), ...(grant ? { 'x-synthetic-grant': 'yes' } : {}),
    } });
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    if (status === 200) {
      const html = await response.text();
      expect(html).toContain('balanced-recent');
      expect(html).toContain('taric_dataset_converter.py');
      expect(html).toContain('/css/color-theme.css');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
  }
  for (const method of Object.values(history)) expect(method).not.toHaveBeenCalled();
  expect(service.adminPrincipal).not.toHaveBeenCalled();
  expect(service.readiness).not.toHaveBeenCalled();
  expect(service.transport.adapters).not.toHaveBeenCalled();
});

test('sanitizes markup and active/external links; navigation is standard keyboard-accessible links', () => {
  const rendered = controller.renderMarkdown('<script>alert(1)</script><img src="https://tracker.test/x"><a href="javascript:alert(1)" onclick="x()">bad</a>\n\n[external](https://tracker.test) [local](/admin/taric/history)');
  expect(rendered).not.toMatch(/script|img|onclick|javascript:|https:/);
  expect(rendered).toContain('href="/admin/taric/history"');
  const html = pug.renderFile(path.join(__dirname, '../../views/admin_taric_history.pug'), { csrfToken: 'synthetic' });
  expect(html).toContain('href="/admin/taric/history/guide"');
  const page = pug.renderFile(path.join(__dirname, '../../views/admin_taric_history_guide.pug'), { guideHtml: rendered });
  expect(page).toContain('href="/admin/taric/history"');
  expect(page).not.toContain('tabindex="-1"');
});

test('guide read failure is logged without content and returns a controlled error', async () => {
  jest.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('PRIVATE failure content'));
  const res = { status: jest.fn().mockReturnThis(), type: jest.fn().mockReturnThis(), send: jest.fn() };
  await controller.render({}, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(require('../../utils/logger').error).toHaveBeenCalledWith(expect.stringContaining('could not be rendered'), { category: 'taric' });
  expect(JSON.stringify(res.send.mock.calls)).not.toContain('PRIVATE');
});
