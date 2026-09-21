const fs = require('node:fs');
const pug = require('pug');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(__filename)('jsdom');
const script = fs.readFileSync('public/js/my_life_log.js', 'utf8');
let dom;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const settle = async () => { await jest.advanceTimersByTimeAsync(260); await flush(); };
beforeEach(() => jest.useFakeTimers());
afterEach(() => { dom?.window.close(); jest.useRealTimers(); });
function fixture(labels = [' Mood ', 'mood', 'Work', 'Walk', 'Vitamin C', 'Water', 'Reading', 'Sleep'], account = true) {
  const html = pug.renderFile('views/partials/account_life_log.pug', {
    lifeLogSuggestions: { all: [], top: ['Work'] }, lifeLogPath: '/admin/life_log', lifeLogReminders: [], lifeLogReminderCount: 0,
  });
  dom = new JSDOM(`<main id="account-dashboard" data-csrf-token="${'s'.repeat(43)}">${html}</main>`, { url: 'http://localhost/mypage', runScripts: 'outside-only' });
  const win = dom.window;
  win.LIFE_LOG_BASE_PATH = account ? '/mypage/api/life' : '/admin/life_log';
  win.fetch = jest.fn(async url => {
    const seen = new Set();
    const q = new URL(url, win.location).searchParams.get('q')?.toLowerCase() || '';
    return { ok: true, json: async () => url.includes('/labels?') ? { labels: labels.map(l => l.trim()).filter(l => {
      const key = l.toLowerCase();
      if (!l || !key.includes(q) || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 5) } : { entries: [] } };
  });
  win.eval(script);
  const doc = win.document;
  const input = doc.getElementById('life-log-label');
  const list = doc.getElementById('life-log-label-options');
  const form = doc.getElementById('life-log-form');
  const type = value => { input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const key = (value, options = {}) => {
    const event = new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event); return event;
  };
  const options = () => Array.from(list.children, option => option.textContent);
  const announcement = () => doc.getElementById('life-log-label-announcement').textContent;
  return { win, doc, input, list, form, type, key, options, announcement };
}
const searches = win => win.fetch.mock.calls.filter(([url]) => url.includes('/labels?'));
const writes = win => win.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');

test('debounced full-history search returns five accessible options and safely encodes input', async () => {
  const { win, input, list, options, type, announcement } = fixture();
  input.focus(); expect(announcement()).toContain('Searching'); expect(searches(win)).toHaveLength(0);
  await settle();
  expect(options()).toEqual(['Mood', 'Work', 'Walk', 'Vitamin C', 'Water']);
  expect(input.labels[0].textContent).toBe('Label');
  expect(input.getAttribute('role')).toBe('combobox');
  expect(input.getAttribute('aria-controls')).toBe(list.id);
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(input.hasAttribute('list')).toBe(false);
  expect([...list.children].every(el => el.getAttribute('role') === 'option' && el.tabIndex === -1 && el.type === 'button')).toBe(true);
  type('r'); type('re'); type('reading'); await settle();
  expect(searches(win)).toHaveLength(2); expect(options()).toEqual(['Reading']);
  type('a&?+#日'); await settle();
  expect(searches(win).at(-1)[0]).toContain('q=a%26%3F%2B%23%E6%97%A5');
  expect(searches(win).at(-1)[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
});

test('substring filtering preserves free text, no matches and overlong input never block Enter', async () => {
  const { win, input, list, type, options, key, announcement } = fixture();
  input.focus(); type('  aT  '); await settle();
  expect(options()).toEqual(['Water']); expect(input.value).toBe('  aT  ');
  type('Brand NEW Label'); await settle();
  expect(input.value).toBe('Brand NEW Label'); expect(list.hidden).toBe(true);
  expect(announcement()).toContain('No matching'); expect(key('Enter').defaultPrevented).toBe(false);
  const count = searches(win).length;
  type('x'.repeat(161)); await settle(); expect(searches(win)).toHaveLength(count);
  expect(announcement()).toContain('160'); expect(key('Enter').defaultPrevented).toBe(false);
  type(''); await settle(); expect(options()).toHaveLength(5);
});

test('arrow/Enter selection, typing, Escape, Tab and IME retain accessible keyboard behavior', async () => {
  const { win, input, list, key, type } = fixture(); input.focus(); await settle();
  expect(key('Enter').defaultPrevented).toBe(false);
  expect(key('ArrowDown').defaultPrevented).toBe(true);
  expect(input.getAttribute('aria-activedescendant')).toBe(list.children[0].id);
  key('ArrowDown'); expect(list.children[1].getAttribute('aria-selected')).toBe('true');
  expect(key('Enter').defaultPrevented).toBe(true); expect(input.value).toBe('Work'); expect(list.hidden).toBe(true);
  await settle(); expect(list.hidden).toBe(true); expect(writes(win)).toHaveLength(0);
  key('ArrowUp'); await settle(); key('ArrowUp');
  expect(key('Escape').defaultPrevented).toBe(true); expect(input.value).toBe('Work');
  input.click(); await settle(); key('ArrowDown'); type('Wo');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false); expect(key('Enter').defaultPrevented).toBe(false);
  await settle(); expect(key('Tab').defaultPrevented).toBe(false); expect(list.hidden).toBe(true);
  input.dispatchEvent(new win.Event('compositionstart')); type('日');
  expect(list.hidden).toBe(true); expect(key('Enter', { isComposing: true }).defaultPrevented).toBe(false);
  const count = searches(win).length; await settle(); expect(searches(win)).toHaveLength(count);
  input.dispatchEvent(new win.Event('compositionend')); await settle(); expect(searches(win)).toHaveLength(count + 1);
});

test('touch press retains focus, completed tap selects; cancelled swipe and outside focus do not', async () => {
  const { win, input, list, doc } = fixture(); input.focus(); await settle();
  const option = list.children[1];
  const down = new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }); option.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true); expect(doc.activeElement).toBe(input); expect(input.value).toBe('');
  const move = new win.Event('touchmove', { bubbles: true, cancelable: true }); option.dispatchEvent(move);
  option.dispatchEvent(new win.Event('pointercancel', { bubbles: true }));
  expect(move.defaultPrevented).toBe(false); expect(input.value).toBe('');
  option.focus(); expect(list.hidden).toBe(false); option.click();
  expect(input.value).toBe('Work'); expect(list.hidden).toBe(true); expect(doc.activeElement).toBe(input);
  input.click(); doc.getElementById('life-log-value').focus(); await settle();
  expect(list.hidden).toBe(true); expect(writes(win)).toHaveLength(0);
});

test('untrusted server labels render only as text', async () => {
  const malicious = '<img src=x onerror="window.injected=true">';
  const { win, input, list, options } = fixture([malicious, '" autofocus onfocus="bad()']); input.focus(); await settle();
  expect(options()).toContain(malicious); expect(list.querySelector('img, script')).toBeNull(); expect(win.injected).toBeUndefined();
  list.children[0].click(); expect(input.value).toBe(malicious);
});

test('successful save remembers label immediately, preserves payload/CSRF and resets; failed save never remembers', async () => {
  const { win, input, form, doc, type, options, list } = fixture();
  input.focus(); type('  NEW Label  '); doc.getElementById('life-log-value').value = '1';
  form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await flush();
  expect(JSON.parse(writes(win)[0][1].body).label).toBe('NEW Label');
  expect(writes(win)[0][1].headers['X-CSRF-Token']).toBe('s'.repeat(43));
  expect(input.value).toBe(''); expect(list.hidden).toBe(true);
  input.click(); expect(options()[0]).toBe('NEW Label'); await settle(); expect(options()[0]).toBe('NEW Label');
  type('new label'); form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
  type('new'); expect(options()).toEqual(['new label']);
  win.fetch.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'Synthetic failure' }) }));
  type('Unsaved'); form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
  expect(input.value).toBe('Unsaved'); expect(options()).toEqual([]);
});

test.each(['blur', 'reset', 'escape', 'replace'])('pending response cannot reopen after %s', async action => {
  const { win, input, form, doc, list, key } = fixture(); await flush();
  let resolve;
  win.fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  input.focus(); await settle();
  if (action === 'blur') doc.getElementById('life-log-value').focus();
  if (action === 'reset') form.reset();
  if (action === 'escape') key('Escape');
  if (action === 'replace') { const replacement = form.cloneNode(true); replacement.removeAttribute('data-life-log-initialized'); form.replaceWith(replacement); win.eval(script); }
  resolve({ ok: true, json: async () => ({ labels: ['Late'] }) }); await flush();
  expect(list.hidden).toBe(true); expect(doc.querySelectorAll('[role="listbox"]')).toHaveLength(1);
});

test('stale responses cannot replace newer matches; repeated initialization has one search listener', async () => {
  const { win, input, type, options } = fixture(); await flush();
  const pending = [];
  win.fetch.mockImplementation((url, opts) => new Promise(resolve => pending.push({ resolve, opts })));
  input.focus(); type('Old'); await settle();
  win.eval(script); type('New'); await settle(); expect(pending).toHaveLength(2); expect(pending[0].opts.signal.aborted).toBe(true);
  pending[1].resolve({ ok: true, json: async () => ({ labels: ['New match'] }) }); await flush();
  pending[0].resolve({ ok: true, json: async () => ({ labels: ['Old match'] }) }); await flush();
  expect(options()).toEqual(['New match']); expect(input.value).toBe('New');
});

test.each(['network', 'http', 'redirect', 'malformed', 'timeout'])('search %s failure allows free-text save', async failure => {
  const { win, input, type, key, announcement, form } = fixture(); await flush();
  win.fetch.mockImplementationOnce((_url, opts) => {
    if (failure === 'network') return Promise.reject(new Error('offline'));
    if (failure === 'timeout') return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('timeout'))));
    return Promise.resolve({ ok: failure !== 'http', redirected: failure === 'redirect', json: async () => ({ labels: null }) });
  });
  input.focus(); type('Free text'); await settle(); if (failure === 'timeout') await jest.advanceTimersByTimeAsync(4000);
  expect(announcement()).toContain('unavailable'); expect(input.value).toBe('Free text'); expect(key('Enter').defaultPrevented).toBe(false);
  form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush(); expect(writes(win)).toHaveLength(1);
});

test('standalone native datalist is unchanged and never searches', async () => {
  const { win, input, list } = fixture(['Work'], false); input.focus(); await settle();
  expect(input.getAttribute('list')).toBe('life-log-labels'); expect(input.hasAttribute('role')).toBe(false);
  expect(list.hidden).toBe(true); expect(searches(win)).toHaveLength(0);
});

test('a pending refresh keeps the active keyboard label and cannot replace a pressed touch option', async () => {
  const { win, input, type, key, list } = fixture(); input.focus(); await settle();
  let resolve;
  win.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  type('wo'); key('ArrowDown'); await settle();
  resolve({ ok: true, json: async () => ({ labels: ['Work'] }) }); await flush();
  expect(list.children[0].getAttribute('aria-selected')).toBe('true');
  expect(key('Enter').defaultPrevented).toBe(true); expect(input.value).toBe('Work');
  win.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  input.click(); await settle();
  const option = list.children[0];
  option.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  resolve({ ok: true, json: async () => ({ labels: ['Working'] }) }); await flush();
  expect(list.children[0]).toBe(option); option.click(); expect(input.value).toBe('Work');
});

test('chip fill searches its label and a replacement form initializes independently', async () => {
  const { win, doc, input, form, list, options } = fixture();
  doc.querySelector('.life-log-chip').click(); await settle(); expect(input.value).toBe('Work'); expect(options()).toEqual(['Work']);
  form.reset(); expect(list.hidden).toBe(true);
  const replacement = form.cloneNode(true); replacement.removeAttribute('data-life-log-initialized'); form.replaceWith(replacement);
  win.eval(script); const fresh = doc.getElementById('life-log-label'); fresh.focus(); await settle();
  expect(doc.getElementById('life-log-label-options').hidden).toBe(false);
  const count = searches(win).length; win.eval(script); fresh.dispatchEvent(new win.Event('input')); await settle();
  expect(searches(win)).toHaveLength(count + 1);
});
