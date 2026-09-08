jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({
  listTools: jest.fn(async () => [{ _id: '333333333333333333333333', name: 'synthetic', displayName: 'Synthetic', enabled: true, tags: [] }]),
  getRegisteredHandlerKeys: jest.fn(() => []),
})));
jest.mock('../../services/data/toolSeeds', () => []);
const express = require('express');
const session = require('express-session');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');
const { createSessionCsrf } = require('../../middleware/sessionCsrf');
const { createFormAssets } = require('../../utils/formAssets');
let server; let dom;
afterEach(async () => { dom?.window.close(); if (server) await new Promise(resolve => server.close(resolve)); });
test('rendered Tool Manager tester uses the revisioned script and session header; native forms never default to GET', async () => {
  const app = express(); app.set('view engine', 'pug'); app.set('views', 'views');
  const assets = createFormAssets(); app.locals.formAssetUrl = assets.url;
  app.use(session({ secret: 'synthetic-tool-form-secret', resave: false, saveUninitialized: false }));
  app.use(express.json()); const csrf = createSessionCsrf(); app.use(csrf.issueToken);
  app.get('/assets/forms/:revision/:filename', assets.serve);
  Object.assign(app.locals, { bookmarks: [], htmlPaths: [] });
  app.get('/admin/tools', require('../../controllers/toolManagerController').index);
  const execute = jest.fn((req, res) => res.json({ ok: true, result: 'Synthetic' }));
  app.post('/admin/tools/test', csrf.requireToken, execute);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/admin/tools'); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  dom = new JSDOM(await response.text(), { url: base + '/admin/tools', runScripts: 'outside-only' });
  const doc = dom.window.document;
  for (const form of doc.forms) expect(form.method).toBe('post');
  const script = [...doc.scripts].find(s => s.src.endsWith('/tool_manager.js'));
  expect(script.getAttribute('src')).toBe(assets.url('tool_manager.js'));
  let completed; const done = new Promise(resolve => { completed = resolve; });
  dom.window.fetch = async (url, options) => {
    expect(options.headers['X-CSRF-Token']).toBe(JSON.parse(doc.getElementById('toolManagerPageConfig').textContent).csrfToken);
    const result = await fetch(base + url, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: base } });
    expect(result.status).toBe(200); completed(); return result;
  };
  dom.window.eval(await (await fetch(script.src)).text());
  doc.getElementById('toolTesterName').value = 'synthetic';
  doc.getElementById('toolTesterArguments').value = '{}';
  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  doc.getElementById('toolTesterForm').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await done; expect(execute).toHaveBeenCalledTimes(1);
});
