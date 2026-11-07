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
  win.Date.now = () => Date.parse('2026-09-08T01:00:00Z');
  let acknowledge;
  win.fetch = jest.fn((url, options) => options?.method === 'PATCH'
    ? new Promise(resolve => { acknowledge = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ ok: true, state: 'ready', fetchedAt: '2026-09-08T01:00:00Z', rows: [
      { taskId: 'one', type: 'todo', title: '<img src=x onerror=alert(1)>', detail: 'To do · Upcoming', group: 'Upcoming', href: '/scheduleTask/upcoming',
        canComplete: true, start: '2026-09-09T01:00:00Z', end: '2026-09-10T02:00:00Z' },
      { taskId: 'two', type: 'tobuy', title: 'Synthetic available', detail: 'Buy · Ongoing', group: 'Ongoing', href: '/scheduleTask/upcoming', canComplete: true, start: null, end: null },
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
  expect(second.querySelector('.account-task-dates')).toBeNull();
  expect(second.textContent).not.toMatch(/Available anytime|No deadline/);
  expect(first.dataset.taskType).toBe('todo');
  expect(first.dataset.taskState).toBe('upcoming');
  expect(second.dataset.taskType).toBe('tobuy');
  expect(second.dataset.taskState).toBe('ongoing');
  expect(first.querySelector('.visually-hidden').textContent).toContain('To do · Upcoming');
  expect(first.querySelector('small')).toBeNull();
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

test('compact task dates hide started and missing dates, warn at exact deadline boundaries, and preserve automatic instructions', async () => {
  const now = Date.parse('2026-09-08T01:00:00Z');
  const iso = offset => new Date(now + offset).toISOString();
  const html = pug.renderFile('views/mypage.pug', { formAssetUrl, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], csrfToken: 'fixture-token',
    dashboard: { sections: SECTIONS.filter(s => s.id === 'tasks'), hiddenSections: [], collapsedSections: [], jobs: {} } });
  dom = new JSDOM(html, { url: 'http://localhost/mypage', runScripts: 'outside-only' });
  const win = dom.window;
  win.Date.now = () => now;
  const rows = [
    { start: iso(-1), end: iso(-1) },
    { start: iso(0), end: iso(0) },
    { start: null, end: iso(1) },
    { end: iso(86400000) },
    { start: iso(1), end: iso(86400001) },
    { start: 'invalid', end: 'invalid' },
  ].map((dates, i) => ({ taskId: String(i), type: i % 2 ? 'tobuy' : 'todo', title: `Task ${i}`, group: 'Ongoing',
    href: '/scheduleTask/upcoming', canComplete: true, ...dates }));
  rows.push({ title: 'Review balances', detail: 'Review and confirm before saving.', group: 'Automatic accounting', href: '/budget' });
  win.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, state: 'ready', fetchedAt: iso(0), rows }) }));
  win.eval(fs.readFileSync('public/js/account_dashboard.js', 'utf8'));
  await flush();
  const links = [...win.document.querySelectorAll('.account-task-row a')];
  expect(links.map(link => link.dataset.deadline)).toEqual(['overdue', 'overdue', 'soon', 'soon', '', '', undefined]);
  expect(links.slice(0, 4).every(link => !link.querySelector('.account-task-start'))).toBe(true);
  expect(links[0].querySelector('.account-task-end').textContent).toContain('Overdue');
  expect(links[3].querySelector('.account-task-end').textContent).toContain('Due soon');
  expect(links[4].querySelectorAll('time')).toHaveLength(2);
  expect(links[4].textContent).not.toMatch(/Due soon|Overdue/);
  expect(links[5].querySelector('.account-task-dates')).toBeNull();
  expect(links[6].textContent).toContain('Review and confirm before saving.');
  expect(links[6].hasAttribute('data-task-id')).toBe(false);
  // Refresh after the future start and deadline have passed.
  win.Date.now = () => now + 86400002;
  win.document.querySelector('[data-section="tasks"] .account-refresh').click();
  await flush();
  const refreshed = win.document.querySelector('[data-task-id="4"]');
  expect(refreshed.querySelector('.account-task-start')).toBeNull();
  expect(refreshed.dataset.taskState).toBe('ongoing');
  expect(refreshed.dataset.deadline).toBe('overdue');
});
