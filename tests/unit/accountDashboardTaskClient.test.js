const fs = require('fs');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');
const { SECTIONS } = require('../../services/accountSurfacePolicy');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('real task shell renders dates, inert titles and groups without buttons; Space removes acknowledged rows and empty groups', async () => {
  const html = pug.renderFile('views/mypage.pug', { formAssetUrl, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], csrfToken: 'fixture-token',
    dashboard: { sections: SECTIONS.filter(s => s.id === 'tasks'), hiddenSections: [], collapsedSections: [], jobs: {} } });
  dom = new JSDOM(html, { url: 'http://localhost/mypage', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  let acknowledge;
  win.fetch = jest.fn((url, options) => options?.method === 'PATCH'
    ? new Promise(resolve => { acknowledge = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ ok: true, state: 'ready', fetchedAt: '2026-09-08T01:00:00Z', rows: [
      { taskId: 'one', title: '<img src=x onerror=alert(1)>', detail: 'To do · Upcoming', group: 'Upcoming', href: '/scheduleTask/upcoming',
        canComplete: true, start: '2026-09-09T01:00:00Z', end: '2026-09-10T02:00:00Z' },
      { taskId: 'two', title: 'Synthetic available', detail: 'Buy · Ongoing', group: 'Ongoing', href: '/scheduleTask/upcoming', canComplete: true, start: null, end: null },
    ] }) }));
  for (const file of ['mypage_tasks.js', 'account_dashboard.js']) win.eval(fs.readFileSync(`public/js/${file}`, 'utf8'));
  await flush();
  const list = doc.querySelector('.account-task-list');
  expect(list.querySelector('button, img')).toBeNull();
  expect(list.querySelectorAll('[data-task-group]')).toHaveLength(2);
  const first = list.querySelector('[data-task-id="one"]');
  expect(first.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(first.textContent).toMatch(/Start: Sep 9, 2026.*10:00 AM/);
  expect(first.textContent).toMatch(/Deadline: Sep 10, 2026.*11:00 AM/);
  expect([...first.querySelectorAll('time')].map(t => t.dateTime)).toEqual(['2026-09-09T01:00:00Z', '2026-09-10T02:00:00Z']);
  expect(first.getAttribute('aria-keyshortcuts')).toBe('Space');
  expect(first.getAttribute('aria-describedby')).toBe('mypage-task-hint');
  const second = list.querySelector('[data-task-id="two"]');
  expect(second.textContent).toContain('Available anytimeNo deadline');
  const complete = item => {
    item.focus();
    for (const type of ['keydown', 'keyup']) item.dispatchEvent(new win.KeyboardEvent(type, { key: ' ', bubbles: true, cancelable: true }));
  };
  complete(first);
  expect(first.isConnected).toBe(true);
  expect(win.fetch).toHaveBeenLastCalledWith('/mypage/api/tasks/one/done', expect.objectContaining({ method: 'PATCH',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'fixture-token' }), body: '{"done":true}' }));
  acknowledge({ ok: true, json: async () => ({ ok: true, done: true }) }); await flush();
  expect(first.isConnected).toBe(false);
  expect(list.querySelector('[data-task-group="Upcoming"]')).toBeNull();
  expect(doc.activeElement).toBe(second);
  complete(second);
  acknowledge({ ok: true, json: async () => ({ ok: true, done: true }) }); await flush();
  expect(list.children).toHaveLength(0);
  expect(doc.activeElement).toBe(doc.querySelector('.schedule-task-pill--empty'));
});
