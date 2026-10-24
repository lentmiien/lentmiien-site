const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { settings, renderDashboard, cardData, overviewData } = require('../fixtures/accountDashboardLayout');
let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture(payload = overviewData(), hidden = true, fetchOverride) {
  dom = new JSDOM(renderDashboard({ ...settings, hiddenSections: hidden ? settings.sections.map(s => s.id) : [] }),
    { url: 'http://localhost/mypage', runScripts: 'outside-only' });
  const win = dom.window;
  win.fetch = fetchOverride || jest.fn(async url => ({ ok: true, json: async () => url === '/mypage/api/overview' ? payload : cardData(url.split('/').at(-1)) }));
  win.eval(fs.readFileSync('public/js/account_dashboard.js', 'utf8'));
  return win;
}
test('overview is independent of hidden cards and renders a bounded preview, counts and links', async () => {
  const win = fixture(); await flush();
  expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(win.fetch.mock.calls[0][0]).toBe('/mypage/api/overview');
  expect(win.fetch.mock.calls[0][1].cache).toBe('no-store');
  const doc = win.document;
  const overview = doc.getElementById('account-overview');
  expect(overview.dataset.state).toBe('ready');
  expect(overview.querySelector('#account-customize')).not.toBeNull();
  expect(overview.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(doc.querySelector('.account-grid').contains(overview)).toBe(false);
  expect(overview.querySelectorAll('[data-overview-group]')).toHaveLength(7);
  expect(doc.querySelector('[data-overview-group="tasks"] .account-overview-count').textContent).toBe('4');
  expect(doc.querySelector('[data-overview-group="tasks"] .account-overview-more').textContent).toBe('+2 more →');
  expect(doc.querySelector('[data-overview-group="tasks"] .account-overview-rows').children).toHaveLength(2);
  expect(doc.querySelector('[data-overview-group="codex"] .account-overview-row a').pathname).toBe('/codex/sessions/synthetic');
});
test('empty, unavailable and successful sources remain distinct', async () => {
  const payload = overviewData();
  payload.groups[0] = { id: 'tasks', state: 'empty', rows: [], count: 0 };
  payload.groups[1] = { id: 'cooking', state: 'unavailable', rows: [], count: null };
  const win = fixture(payload); await flush();
  const doc = win.document;
  expect(doc.getElementById('account-overview').dataset.state).toBe('partial');
  expect(doc.querySelector('[data-overview-group="tasks"] .account-overview-state').textContent).toBe('No deadlines in the next 24 hours.');
  expect(doc.querySelector('[data-overview-group="cooking"] .account-overview-count').hidden).toBe(true);
  expect(doc.querySelector('[data-overview-group="cooking"] .account-overview-state').textContent).toContain('Unavailable');
  expect(doc.querySelector('[data-overview-group="chats"] .account-overview-row').textContent).toContain('Weekend meal planning');
});
test('text and malicious URLs remain inert; missing recipe links are plain text', async () => {
  const payload = overviewData();
  payload.groups[0].rows[0] = { title: '<img src=x onerror=alert(1)>', detail: '<script>bad()</script>', href: 'javascript:alert(1)' };
  payload.groups[1].rows[0].href = null;
  const win = fixture(payload); await flush();
  const doc = win.document;
  const tasks = doc.querySelector('[data-overview-group="tasks"]');
  expect(tasks.querySelector('img, script')).toBeNull();
  expect(tasks.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(tasks.querySelector('.account-overview-row a').hasAttribute('href')).toBe(false);
  expect(doc.querySelector('[data-overview-group="cooking"] .account-overview-row').querySelector('a')).toBeNull();
});
test('refresh cannot overlap and replaces completed/out-of-window previews after success', async () => {
  const win = fixture(); await flush();
  let answer;
  win.fetch.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const refresh = win.document.getElementById('account-overview-refresh');
  refresh.click(); refresh.click();
  expect(win.fetch).toHaveBeenCalledTimes(2);
  expect(refresh.disabled).toBe(true);
  const updated = overviewData(); updated.groups[0] = { id: 'tasks', rows: [], count: 0, state: 'empty' };
  answer({ ok: true, json: async () => updated }); await flush();
  expect(refresh.disabled).toBe(false);
  const tasks = win.document.querySelector('[data-overview-group="tasks"]');
  expect(tasks.querySelector('.account-overview-row')).toBeNull();
  expect(tasks.querySelector('.account-overview-more').hidden).toBe(true);
});
test('overview refresh shares the four-request budget with full cards', async () => {
  const pending = [];
  const fetch = jest.fn(url => new Promise(resolve => pending.push({ url, resolve })));
  const win = fixture(overviewData(), false, fetch);
  const answer = request => request.resolve({ ok: true, json: async () => request.url === '/mypage/api/overview' ? overviewData() : cardData(request.url.split('/').at(-1)) });
  expect(pending).toHaveLength(4);
  answer(pending.shift()); await flush(); // Overview finishes; the next full card starts.
  expect(pending).toHaveLength(4);
  win.document.getElementById('account-overview-refresh').click();
  expect(pending).toHaveLength(4); // The refresh waits for a free slot.
  expect(win.document.getElementById('account-overview-refresh').disabled).toBe(true);
  answer(pending.shift()); await flush();
  expect(pending).toHaveLength(4);
  expect(pending.at(-1).url).toBe('/mypage/api/overview');
  while (pending.length) { answer(pending.shift()); await flush(); }
  expect(win.document.getElementById('account-overview').dataset.state).toBe('ready');
});
test('failed refresh removes stale counts, reports failure and allows retry without breaking cards', async () => {
  const win = fixture(overviewData(), false); await flush();
  const doc = win.document;
  win.fetch.mockRejectedValueOnce(new Error('network failure'));
  doc.getElementById('account-overview-refresh').click(); await flush();
  expect(doc.getElementById('account-overview').dataset.state).toBe('error');
  expect(doc.querySelector('[data-overview-group="tasks"] .account-overview-count').hidden).toBe(true);
  expect(doc.getElementById('account-overview-refresh').disabled).toBe(false);
  expect(doc.querySelector('[data-section="chats"]').dataset.state).toBe('ready');
  doc.getElementById('account-overview-refresh').click(); await flush();
  expect(doc.getElementById('account-overview').dataset.state).toBe('ready');
});
test('Customize account opens from the overview and restores keyboard focus', async () => {
  const win = fixture(); await flush();
  const doc = win.document; const dialog = doc.getElementById('account-customizer');
  dialog.showModal = jest.fn();
  const customize = doc.getElementById('account-customize'); customize.focus(); customize.click();
  expect(dialog.showModal).toHaveBeenCalled();
  doc.getElementById('account-customize-close').focus();
  dialog.dispatchEvent(new win.Event('close'));
  expect(doc.activeElement).toBe(customize);
  expect(doc.querySelector('[data-setting-id="tasks"] [data-visible]').checked).toBe(false);
});
