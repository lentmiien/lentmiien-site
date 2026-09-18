const fs = require('fs');
const { JSDOM } = require('jsdom');
const { dashboardFixture } = require('../fixtures/codexDashboard');
let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function setup() {
  const fixture = dashboardFixture();
  dom = new JSDOM(fixture.html, { url: 'http://localhost/codex', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const intervals = new Map();
  win.setInterval = (callback, delay) => { intervals.set(delay, callback); return delay; };
  win.CSS = { escape: (value) => value };
  let historyResponder = (url) => fixture.history(url);
  win.fetch = jest.fn(async (url) => {
    let payload = {};
    if (url.includes('/session-history')) payload = await historyResponder(url);
    else if (url.includes('/queue')) payload = fixture.state;
    else if (url.includes('/stats')) payload = { stats: fixture.state.stats };
    else if (url.includes('/events')) payload = { events: [], lastSeq: 0 };
    return { ok: true, text: async () => JSON.stringify(payload) };
  });
  win.eval(fs.readFileSync('public/js/codex-dashboard.js', 'utf8'));
  win.eval(fs.readFileSync('public/js/codex.js', 'utf8'));
  const get = (name) => win.document.querySelector(`[data-codex-history-${name}]`);
  return { fixture, win, get, intervals, responder(fn) { historyResponder = fn; } };
}

test('disclosures default closed, links named, active controls and metric details remain', async () => {
  const { win } = setup(); await flush();
  const doc = win.document;
  expect(doc.querySelector('#codex-new-request-panel').open).toBe(false);
  expect([...doc.querySelectorAll('details')].find((node) => node.textContent.includes('Token Prices')).open).toBe(false);
  expect([...doc.querySelectorAll('.codex-dashboard-nav [aria-label]')].map((node) => node.getAttribute('aria-label'))).toEqual(['Prompt Library', 'Profiles', 'Workspaces', 'Health']);
  expect(doc.querySelectorAll('.codex-active-work [data-action="cancel-turn"]')).toHaveLength(2);
  doc.getElementById('codex-new-request-maximize').click();
  expect(doc.getElementById('codex-new-request-panel').open).toBe(true);
  expect(doc.getElementById('codex-new-request-maximize').getAttribute('aria-pressed')).toBe('true');
  expect(doc.querySelector('[data-codex-monthly-body]').rows[0].cells).toHaveLength(9);
  expect(doc.querySelector('[data-codex-workspace-body]').rows[0].cells).toHaveLength(11);
});

test('older-page navigation loads real rows and polling preserves page and filters', async () => {
  const { win, get, intervals } = setup(); await flush();
  expect(get('status').textContent).toBe('1–12 of 37 sessions');
  get('next').click(); await flush();
  expect(get('status').textContent).toBe('13–24 of 37 sessions');
  expect(get('results').textContent).toContain('Historical session 13');
  expect(get('results').textContent).not.toContain('Historical session 25');
  const historyCalls = () => win.fetch.mock.calls.filter(([url]) => url.includes('/session-history')).length;
  const before = historyCalls();
  intervals.get(10000)(); await flush();
  expect(historyCalls()).toBe(before);
  expect(get('page').textContent).toBe('Page 2 of 4');
  expect(win.document.querySelector('[data-codex-running-count]').textContent).toBe('1');
  expect(get('live').hidden).toBe(false);
  get('filters').elements.search.value = 'session 37';
  get('filters').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await flush();
  expect(get('page').textContent).toBe('Page 1 of 1');
  expect(get('status').textContent).toBe('1–1 of 1 sessions');
  intervals.get(10000)(); await flush();
  expect(win.fetch.mock.calls.filter(([url]) => url.includes('/session-history')).at(-1)[0]).toContain('search=session+37');
});

test('last, empty and failure states retain rows and retry the failed navigation', async () => {
  const { fixture, get, responder, win } = setup(); await flush();
  responder(() => { throw new Error('Network unavailable'); });
  get('next').click(); await flush();
  expect(get('results').getAttribute('aria-busy')).toBe('false');
  expect(get('page').textContent).toBe('Page 1 of 4');
  expect(get('refresh').textContent).toBe('Retry');
  responder((url) => fixture.history(url));
  get('refresh').click(); await flush();
  expect(get('page').textContent).toBe('Page 2 of 4');
  get('next').click(); await flush(); get('next').click(); await flush();
  expect(get('status').textContent).toBe('37–37 of 37 sessions');
  expect(get('next').disabled).toBe(true);
  get('filters').elements.status.value = 'archived';
  get('filters').dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
  expect(get('status').textContent).toBe('No sessions match these filters.');
  expect(get('next').disabled).toBe(true);
});

test('slow responses cannot overwrite a newer filter, and text payloads remain inert', async () => {
  const { fixture, get, responder, win } = setup(); await flush();
  let resolveOld;
  responder(() => new Promise((resolve) => { resolveOld = resolve; }));
  get('next').click(); await flush();
  responder(() => ({ sessions: [{ ...fixture.sessions[0], title: '<img src=x onerror=alert(1)>' }], pagination: { page: 1, limit: 12, total: 1, pages: 1, hasNext: false } }));
  get('filters').dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
  resolveOld(fixture.history('/?page=2')); await flush();
  expect(get('page').textContent).toBe('Page 1 of 1');
  expect(get('results').textContent).toContain('<img src=x onerror=alert(1)>');
  expect(get('results').querySelector('img')).toBeNull();
});

test('charts expose exact labeled metrics and sensible zero states', async () => {
  const { win } = setup(); await flush();
  const container = win.document.querySelector('[data-codex-charts]');
  expect(container.querySelectorAll('figure')).toHaveLength(2);
  expect(container.textContent).toContain('40,000 tokens');
  expect(container.textContent).toContain('Succeeded30 turns');
  win.CodexDashboard.renderCharts(container, {});
  expect(container.textContent).toContain('No tokens recorded');
  expect(container.textContent).toContain('No turns recorded');
});


test('automatic history refresh preserves keyboard focus while browsing session links', async () => {
  const { win, get, intervals } = setup(); await flush();
  const link = get('results').querySelector('a');
  link.focus();
  const calls = () => win.fetch.mock.calls.filter(([url]) => url.includes('/session-history')).length;
  const before = calls();
  intervals.get(10000)(); await flush();
  expect(calls()).toBe(before);
  expect(win.document.activeElement).toBe(link);
  link.blur();
  intervals.get(10000)(); await flush();
  expect(calls()).toBe(before + 1);
});
