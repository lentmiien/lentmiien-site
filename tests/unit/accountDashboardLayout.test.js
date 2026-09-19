const fs = require('node:fs');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(__filename)('jsdom');
const { settings, renderDashboard, cardData, renderLifePanel, lifeEntries } = require('../fixtures/accountDashboardLayout');
let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function fixture() {
  dom = new JSDOM(renderDashboard(), { url: 'http://localhost/mypage', runScripts: 'outside-only' });
  const { window: win } = dom;
  for (const file of ['color-theme', 'style', 'nav', 'brand', 'account_dashboard', 'mypage_tasks', 'account_life_log']) {
    const style = win.document.createElement('style');
    style.textContent = fs.readFileSync(`public/css/${file}.css`, 'utf8');
    win.document.head.append(style);
  }
  win.fetch = jest.fn(async url => ({ ok: true, json: async () => url.includes('/entries?') ? lifeEntries() : cardData(url.split('/').at(-1)) }));
  win.eval(fs.readFileSync('public/js/account_dashboard.js', 'utf8'));
  return win;
}
function expectNaturalContent(win, selector) {
  for (const el of win.document.querySelectorAll(selector)) {
    const style = win.getComputedStyle(el);
    expect(['', 'none']).toContain(style.maxHeight);
    expect(['', 'auto']).toContain(style.height);
    expect(['', 'visible']).toContain(style.overflow);
    expect(['', 'visible']).toContain(style.overflowY);
    expect(['', 'auto']).toContain(style.overscrollBehavior);
  }
}
test('all rendered lists remain uncapped initially, after refresh and after expansion', async () => {
  const win = fixture(); await flush();
  const doc = win.document;
  const selectors = '.account-card, .account-card-content, .account-card-data, .account-rows, .account-task-list';
  expectNaturalContent(win, selectors);
  for (const section of settings.sections.filter(s => !['models', 'gateway', 'life'].includes(s.id))) {
    const card = doc.querySelector(`[data-section="${section.id}"]`);
    expect(card.querySelectorAll('.account-row, .account-task-row')).toHaveLength(12);
    card.querySelector('.account-refresh').click(); await flush();
    expect(card.querySelectorAll('.account-row, .account-task-row')).toHaveLength(12);
  }
  const gateway = doc.querySelector('[data-section="gateway"]');
  expect(gateway.querySelector('.account-card-content').hidden).toBe(true);
  expect(win.fetch.mock.calls.some(([url]) => url.endsWith('/gateway'))).toBe(false);
  gateway.querySelector('.account-collapse').click(); await flush();
  expect(gateway.querySelectorAll('.account-row')).toHaveLength(12);
  gateway.querySelector('.account-collapse').click();
  expect(gateway.querySelector('.account-card-content').hidden).toBe(true);
  expect(gateway.querySelector('.account-collapse').getAttribute('aria-expanded')).toBe('false');
  expect(doc.querySelector('[data-section="models"]').hidden).toBe(true);
  expectNaturalContent(win, selectors);
});
test('lazy Life log point list expands only on the dashboard and map touches remain native', async () => {
  const win = fixture(); await flush();
  const target = win.document.querySelector('[data-section="life"] .account-card-data');
  target.innerHTML = renderLifePanel();
  win.LIFE_LOG_BASE_PATH = '/mypage/api/life';
  win.eval(fs.readFileSync('public/js/my_life_log.js', 'utf8')); await flush();
  expectNaturalContent(win, '.life-log-point-list, .life-log-followups-list, .life-log-reminder-list');
  const hitbox = win.document.getElementById('llv-img-hitbox');
  const touch = new win.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(touch, 'touches', { value: [{ clientX: 10, clientY: 10 }] });
  hitbox.dispatchEvent(touch);
  expect(touch.defaultPrevented).toBe(false);
  expect(win.document.querySelectorAll('.point-item')).toHaveLength(0);
  win.document.getElementById('llv-img-wrap').getBoundingClientRect = () => ({ width: 300, height: 200, left: 0, top: 0 });
  hitbox.click();
  expect(win.document.querySelectorAll('.point-item')).toHaveLength(1);
  const standalone = win.document.createElement('div'); standalone.className = 'life-log-point-list';
  win.document.body.append(standalone);
  expect(win.getComputedStyle(standalone).maxHeight).toBe('180px');
  expect(win.getComputedStyle(standalone).overflow).toBe('auto');
  expect(win.getComputedStyle(win.document.getElementById('account-customizer')).maxHeight).toContain('100dvh');
});
