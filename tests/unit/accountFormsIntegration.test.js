jest.mock('../../models/role', () => ({ findOne: jest.fn(async () => ({ permissions: ['embedding', 'scheduletask'] })) }));
jest.mock('../../models/my_life_log_entry', () => ({ create: jest.fn(async payload => ({ _id: '333333333333333333333333', ...payload })) }));
jest.mock('../../services/accountEmbeddingAdapter', () => ({ createAccountEmbeddingAdapter: jest.fn(() => ({ similaritySearch: jest.fn(async () => ({ results: [] })) })) }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const session = require('express-session');
const { createRequire } = require('module');
// jsdom includes ESM dependencies; use Node's native loader under Jest's VM modules.
const { JSDOM } = createRequire(__filename)('jsdom');
const { createAccountDashboard } = require('../../routes/accountDashboard');
const { createFormAssets } = require('../../utils/formAssets');
const accountSurfaceBody = require('../../middleware/accountSurfaceBody');
const Entry = require('../../models/my_life_log_entry');
const embedding = require('../../services/accountEmbeddingAdapter');
const logger = require('../../utils/logger');
let server; let base; let store; let userModel; let dom; let cookie; let requests; let assets; let user;
let nextOwner = 100;
const visual = { version: 1, image: '/i/img_select.jpg', canvas: { width: 200, height: 400 }, points: [{ x: 0.5, y: 0.5, radius: 8, opacity: 80, category: 'a' }] };
const until = async predicate => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Synthetic page did not reach expected state');
};
beforeEach(async () => {
  user = { _id: String(nextOwner++).padStart(24, '0'), type_user: 'admin', name: 'synthetic' };
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = user._id;
  requests = []; cookie = '';
  const app = express();
  assets = createFormAssets(); app.locals.formAssetUrl = assets.url;
  app.set('view engine', 'pug'); app.set('views', 'views');
  store = new session.MemoryStore();
  app.use(session({ secret: 'synthetic-integration-session-secret', store, resave: false, saveUninitialized: false }));
  app.use(accountSurfaceBody);
  app.use((req, res, next) => {
    req.user = user; req.isAuthenticated = () => true;
    Object.assign(res.locals, { loggedIn: true, bookmarks: [], htmlPaths: [] }); next();
  });
  app.get('/assets/forms/:revision/:filename', assets.serve);
  userModel = { updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
  app.use('/mypage/embedding-search', require('../../routes/accountEmbedding'));
  app.use('/mypage', createAccountDashboard({ userModel, data: {
    load: jest.fn(async () => ({ rows: [], reminders: [], state: 'empty', fetchedAt: new Date().toISOString() })),
    read: jest.fn(async () => [{ _id: '333333333333333333333333', type: 'visual_log', label: 'body_map', timestamp: new Date(), v_log_data: JSON.stringify(visual) }]),
  } }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  dom?.window.close(); dom = null;
  await new Promise(resolve => server.close(resolve));
  delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID;
});
async function browserFetch(url, options = {}) {
  const response = await fetch(new URL(url, base), { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  requests.push({ url: new URL(url, base).pathname, options, status: response.status });
  return response;
}
async function page({ missingToken = false, failScript = false } = {}) {
  const response = await browserFetch('/mypage');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  dom = new JSDOM(await response.text(), { url: base + '/mypage', runScripts: 'outside-only' });
  const { window } = dom; const doc = window.document;
  if (missingToken) delete doc.getElementById('account-dashboard').dataset.csrfToken;
  // Keep the actual Life Log card and native embedding form; unrelated cards need no providers.
  doc.querySelectorAll('[data-section]').forEach(card => { card.hidden = !['life', 'embedding'].includes(card.dataset.section); });
  doc.querySelector('[data-section="life"] .account-card-content').hidden = false;
  window.fetch = browserFetch;
  window.AbortController = AbortController;
  const originalAppend = doc.body.append.bind(doc.body);
  doc.body.append = (...nodes) => {
    originalAppend(...nodes);
    for (const script of nodes.filter(n => n.tagName === 'SCRIPT' && n.src)) {
      void (async () => {
        if (failScript) { failScript = false; script.onerror(); return; }
        const scriptResponse = await browserFetch(script.src);
        expect(scriptResponse.status).toBe(200);
        window.eval(await scriptResponse.text());
        script.onload();
      })();
    }
  };
  const dashboardScript = [...doc.scripts].find(s => s.src.endsWith('/account_dashboard.js'));
  expect(dashboardScript.getAttribute('src')).toMatch(/^\/assets\/forms\/[a-f0-9]{64}\/account_dashboard.js$/);
  window.eval(await (await browserFetch(dashboardScript.src)).text());
  await until(() => doc.querySelector('[data-section="life"]').dataset.state === 'error' || doc.querySelector('.account-card-data[data-panel-loaded]'));
  // Settle the initial GET before tests deliberately remove session state; a later
  // safe GET is allowed to issue a fresh token and would change the expected cause.
  if (doc.getElementById('life-log-form')?.dataset.lifeLogInitialized === 'true') {
    await until(() => doc.querySelector('#llv-followups-list button'));
  }
  return doc;
}
function fill(doc, type = 'basic') {
  doc.getElementById('life-log-type').value = type;
  doc.getElementById('life-log-type').dispatchEvent(new dom.window.Event('change'));
  doc.getElementById('life-log-label').value = 'Synthetic';
  doc.getElementById('life-log-value').value = '1';
  doc.getElementById('life-log-text').value = 'Synthetic diary';
}
function submit(doc) {
  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  doc.getElementById('life-log-form').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
async function changeSession(change) {
  const all = await new Promise((resolve, reject) => store.all((error, sessions) => error ? reject(error) : resolve(sessions)));
  const [id, saved] = Object.entries(all)[0]; change(saved);
  await new Promise((resolve, reject) => store.set(id, saved, error => error ? reject(error) : resolve()));
}
const writes = () => requests.filter(r => r.url.endsWith('/entry') && r.options.method === 'POST');

test.each(['basic', 'medical', 'diary'])('rendered dashboard, fragment and actual %s submit send the session token', async type => {
  const doc = await page(); fill(doc, type); submit(doc);
  await until(() => doc.getElementById('life-log-status').textContent === 'Saved.');
  expect(Entry.create).toHaveBeenCalledTimes(1);
  expect(Entry.create).toHaveBeenCalledWith(expect.objectContaining({ type }));
  expect(writes()).toHaveLength(1);
  expect(writes()[0].status).toBe(200);
  expect(writes()[0].options.headers['X-CSRF-Token']).toBe(doc.getElementById('account-dashboard').dataset.csrfToken);
  const payload = JSON.parse(writes()[0].options.body);
  expect(payload).not.toHaveProperty('_csrf');
  expect(payload.timestamp).toMatch(/Z$/);
  expect(doc.getElementById('life-log-label').value).toBe('');
});

test('body-map save and generated follow-up send the rendered token without duplicate handlers', async () => {
  const doc = await page();
  const hitbox = doc.getElementById('llv-img-hitbox');
  doc.getElementById('llv-img-wrap').getBoundingClientRect = () => ({ width: 200, height: 400, left: 0, top: 0 });
  hitbox.dispatchEvent(new dom.window.MouseEvent('click', { clientX: 100, clientY: 200 }));
  doc.getElementById('llv-save').click();
  await until(() => doc.getElementById('llv-status').textContent === 'Saved.');
  await until(() => doc.querySelector('#llv-followups-list button'));
  doc.querySelector('#llv-followups-list button').click();
  await until(() => doc.getElementById('llv-followups-status').textContent === 'Saved follow-up.' || writes().length === 2);
  expect(Entry.create).toHaveBeenCalledTimes(2);
  for (const write of writes()) {
    expect(write.status).toBe(200);
    expect(write.options.headers['X-CSRF-Token']).toBe(doc.getElementById('account-dashboard').dataset.csrfToken);
  }
  expect(JSON.parse(writes()[1].options.body)).not.toHaveProperty('timestamp');
  // Re-evaluating the exact same script must not attach duplicate submit listeners.
  dom.window.eval(await (await browserFetch(assets.url('my_life_log.js'))).text());
  fill(doc); submit(doc);
  await until(() => doc.getElementById('life-log-status').textContent === 'Saved.');
  expect(Entry.create).toHaveBeenCalledTimes(3);
});

test.each(['basic', 'medical', 'diary', 'visual', 'followup'])('missing DOM token blocks %s locally and preserves inputs', async variant => {
  const doc = await page({ missingToken: true }); fill(doc, variant === 'diary' ? 'diary' : 'basic');
  let status = doc.getElementById('life-log-status');
  if (variant === 'visual') {
    doc.getElementById('llv-img-wrap').getBoundingClientRect = () => ({ width: 200, height: 400, left: 0, top: 0 });
    doc.getElementById('llv-img-hitbox').dispatchEvent(new dom.window.MouseEvent('click', { clientX: 100, clientY: 200 }));
    doc.getElementById('llv-save').click(); status = doc.getElementById('llv-status');
  } else if (variant === 'followup') {
    await until(() => doc.querySelector('#llv-followups-list button'));
    doc.querySelector('#llv-followups-list input').value = '15';
    doc.querySelector('#llv-followups-list button').click(); status = doc.getElementById('llv-followups-status');
  } else { doc.getElementById('life-log-type').value = variant; submit(doc); }
  await until(() => status.textContent.includes('before reloading'));
  expect(Entry.create).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  expect(doc.getElementById('life-log-label').value).toBe('Synthetic');
  expect(doc.getElementById('life-log-text').value).toBe('Synthetic diary');
  if (variant === 'visual') expect(doc.querySelectorAll('#llv-points-overlay .point')).toHaveLength(1);
  if (variant === 'followup') {
    expect(doc.querySelector('#llv-followups-list input').value).toBe('15');
    expect(doc.querySelector('#llv-followups-list button').disabled).toBe(false);
  }
});

test.each(['missing', 'mismatch', 'origin'])('server %s rejection has no writes/replay and retains diary', async reason => {
  const doc = await page(); fill(doc, 'diary');
  if (reason === 'origin') dom.window.fetch = (url, options) => browserFetch(url, { ...options, headers: { ...options?.headers, Origin: 'https://untrusted.invalid' } });
  else await changeSession(saved => { if (reason === 'missing') delete saved.csrfToken; else saved.csrfToken = 'b'.repeat(43); });
  submit(doc); await until(() => doc.getElementById('life-log-status').textContent.includes('before reloading'));
  expect(writes()).toHaveLength(1); expect(writes()[0].status).toBe(403);
  expect(Entry.create).not.toHaveBeenCalled();
  expect(doc.getElementById('life-log-text').value).toBe('Synthetic diary');
  if (reason !== 'origin') expect(logger.warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ metadata: expect.objectContaining({ tokenStatus: reason === 'missing' ? 'missing_session_token' : 'token_mismatch' }) }));
});

test('failed script load prevents native submission and refresh initializes the same fragment once', async () => {
  const doc = await page({ failScript: true }); fill(doc, 'diary');
  const form = doc.getElementById('life-log-form');
  expect(form.method).toBe('post'); submit(doc); expect(writes()).toHaveLength(0);
  doc.querySelector('[data-section="life"] .account-refresh').click();
  await until(() => form.dataset.lifeLogInitialized === 'true');
  expect(doc.getElementById('life-log-form')).toBe(form);
  expect(doc.getElementById('life-log-text').value).toBe('Synthetic diary');
  submit(doc); await until(() => doc.getElementById('life-log-status').textContent === 'Saved.');
  expect(Entry.create).toHaveBeenCalledTimes(1);
  doc.querySelector('[data-section="life"] .account-refresh').click();
  await until(() => doc.querySelector('[data-section="life"]').getAttribute('aria-busy') === null);
  expect(requests.filter(r => r.url.endsWith('/my_life_log.js'))).toHaveLength(1);
});

test.each(['/mypage', '/mypage/embedding-search'])('native embedding form rendered at %s posts its own hidden token', async path => {
  const response = await browserFetch(path);
  dom = new JSDOM(await response.text(), { url: base + path });
  const form = dom.window.document.querySelector('form[action="/mypage/embedding-search"]');
  expect(form).not.toBeNull(); expect(form.method).toBe('post');
  form.querySelector('[name="search_text"]').value = 'Synthetic search';
  const body = new URLSearchParams([...new dom.window.FormData(form).entries()]);
  const result = await browserFetch(form.action, { method: form.method.toUpperCase(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  expect(result.status).toBe(200); expect(embedding.createAccountEmbeddingAdapter).toHaveBeenCalledTimes(1);
  const resultDom = new JSDOM(await result.text());
  expect(resultDom.window.document.querySelector('[name="_csrf"]').value).toBe(form.querySelector('[name="_csrf"]').value);
  resultDom.window.close();
});

test('native pre-redesign embedding form without token is rejected before searching', async () => {
  await browserFetch('/mypage/embedding-search');
  const response = await browserFetch('/mypage/embedding-search', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ search_text: 'Synthetic' }) });
  expect(response.status).toBe(403); expect(embedding.createAccountEmbeddingAdapter).not.toHaveBeenCalled();
});

test.each(['', 'bad', 'b'.repeat(43)])('legacy/malformed/mismatched header %# reproduces the generic rejection before writes', async supplied => {
  await browserFetch('/mypage');
  const response = await browserFetch('/mypage/api/life/entry', { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(supplied ? { 'X-CSRF-Token': supplied } : {}),
  }, body: JSON.stringify({ type: 'basic', label: 'Synthetic', value: '1' }) });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ ok: false, code: 'CSRF_REJECTED', error: 'The form expired or came from an untrusted page. Reload and try again.' });
  expect(Entry.create).not.toHaveBeenCalled();
});

test.each(['visual', 'followup'])('session rejection retains %s points and controls without retrying the write', async variant => {
  const doc = await page();
  await until(() => doc.querySelector('#llv-followups-list button'));
  await changeSession(saved => { delete saved.csrfToken; });
  let status;
  if (variant === 'visual') {
    doc.getElementById('llv-img-wrap').getBoundingClientRect = () => ({ width: 200, height: 400, left: 0, top: 0 });
    doc.getElementById('llv-img-hitbox').dispatchEvent(new dom.window.MouseEvent('click', { clientX: 100, clientY: 200 }));
    doc.getElementById('llv-save').click(); status = doc.getElementById('llv-status');
  } else {
    doc.querySelector('#llv-followups-list input').value = '15';
    doc.querySelector('#llv-followups-list button').click(); status = doc.getElementById('llv-followups-status');
  }
  await until(() => status.textContent.includes('before reloading'));
  expect(Entry.create).not.toHaveBeenCalled(); expect(writes()).toHaveLength(1); expect(writes()[0].status).toBe(403);
  if (variant === 'visual') expect(doc.querySelectorAll('#llv-points-overlay .point')).toHaveLength(1);
  else {
    expect(doc.querySelector('#llv-followups-list input').value).toBe('15');
    expect(doc.querySelector('#llv-followups-list button').disabled).toBe(false);
  }
});

test.each(['account-save', 'nav-save'])('actual %s sends rendered token and preserves choices on CSRF failure', async id => {
  const doc = await page(); await changeSession(saved => { delete saved.csrfToken; });
  const input = doc.querySelector('[data-setting-id="life"] [data-visible]'); input.checked = false;
  doc.getElementById(id).click();
  const status = doc.getElementById(id === 'account-save' ? 'account-save-status' : 'nav-save-status');
  await until(() => status.textContent.includes('before reloading'));
  const request = requests.find(r => r.options.method === 'POST');
  expect(request.status).toBe(403);
  expect(request.options.headers['X-CSRF-Token']).toBe(doc.getElementById('account-dashboard').dataset.csrfToken);
  expect(userModel.updateOne).not.toHaveBeenCalled(); expect(input.checked).toBe(false);
});
