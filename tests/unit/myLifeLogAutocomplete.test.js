const fs = require('node:fs');
const pug = require('pug');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(__filename)('jsdom');
const script = fs.readFileSync('public/js/my_life_log.js', 'utf8');
let dom;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(() => dom?.window.close());
function fixture(labels = [' Mood ', 'mood', 'Work', 'Walk', 'Vitamin C', 'Water', 'Reading', 'Sleep'], account = true) {
  const html = pug.renderFile('views/partials/account_life_log.pug', {
    lifeLogSuggestions: { all: labels, top: ['Work'] }, lifeLogPath: '/admin/life_log',
    lifeLogReminders: [], lifeLogReminderCount: 0,
  });
  dom = new JSDOM(`<main id="account-dashboard" class="account-dashboard" data-csrf-token="${'s'.repeat(43)}">${html}</main>`, { url: 'http://localhost/mypage', runScripts: 'outside-only' });
  const win = dom.window;
  win.LIFE_LOG_BASE_PATH = account ? '/mypage/api/life' : '/admin/life_log';
  win.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) }));
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
  return { win, doc, input, list, form, type, key, options };
}
const writes = win => win.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');

test('focus offers bounded recent labels, trimmed/case-insensitive deduplication, accessible names and no fetch', () => {
  const { win, input, list, options } = fixture();
  const requests = win.fetch.mock.calls.length;
  input.focus();
  expect(options()).toEqual(['Mood', 'Work', 'Walk', 'Vitamin C', 'Water']);
  expect(input.labels[0].textContent).toBe('Label');
  expect(input.getAttribute('role')).toBe('combobox');
  expect(input.getAttribute('aria-controls')).toBe(list.id);
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(input.hasAttribute('list')).toBe(false);
  expect(list.getAttribute('role')).toBe('listbox');
  expect([...list.children].every(el => el.getAttribute('role') === 'option' && el.tabIndex === -1 && el.type === 'button')).toBe(true);
  expect(win.fetch).toHaveBeenCalledTimes(requests);
});

test('typing filters substrings without rewriting new text, and no matches close the list', () => {
  const { doc, input, list, type, options } = fixture();
  input.focus(); type('  aT  ');
  expect(options()).toEqual(['Water']); expect(input.value).toBe('  aT  ');
  type('Brand NEW Label');
  expect(input.value).toBe('Brand NEW Label'); expect(list.hidden).toBe(true);
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(doc.getElementById('life-log-label-announcement').textContent).toContain('No matching');
  type(''); expect(options()).toHaveLength(5);
});

test.each([{ labels: [] }, { labels: ['', ' ', '\t'] }])('empty suggestions keep free text and native Enter behavior ($labels)', ({ labels }) => {
  const { input, list, key, type } = fixture(labels);
  input.focus(); expect(list.hidden).toBe(true);
  type('New'); expect(key('Enter').defaultPrevented).toBe(false);
  expect(key('ArrowDown').defaultPrevented).toBe(false);
  expect(input.value).toBe('New');
});

test('arrows announce active option; only explicit Enter selection prevents submit; Escape and Tab never change text', () => {
  const { input, list, key, win } = fixture();
  input.focus();
  expect(key('Enter').defaultPrevented).toBe(false);
  expect(key('ArrowDown').defaultPrevented).toBe(true);
  expect(input.getAttribute('aria-activedescendant')).toBe(list.children[0].id);
  expect(list.children[0].getAttribute('aria-selected')).toBe('true');
  key('ArrowDown'); expect(list.children[0].getAttribute('aria-selected')).toBe('false');
  expect(key('Enter').defaultPrevented).toBe(true);
  expect(input.value).toBe('Work'); expect(list.hidden).toBe(true);
  expect(writes(win)).toHaveLength(0);
  expect(key('Enter').defaultPrevented).toBe(false);
  expect(key('Escape').defaultPrevented).toBe(false);
  key('ArrowUp'); expect(list.children[0].getAttribute('aria-selected')).toBe('true');
  expect(key('Escape').defaultPrevented).toBe(true); expect(input.value).toBe('Work');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  input.click(); expect(list.hidden).toBe(false);
  key('ArrowDown'); expect(key('Tab').defaultPrevented).toBe(false);
  expect(input.value).toBe('Work'); expect(list.hidden).toBe(true);
});

test('typing after arrow navigation clears active selection and preserves free-text Enter', () => {
  const { input, type, key } = fixture();
  input.focus(); key('ArrowDown'); type('Wo');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(key('Enter').defaultPrevented).toBe(false); expect(input.value).toBe('Wo');
});

test('touch press keeps focus, selection waits for completed tap, and click never submits', () => {
  const { win, input, list, doc } = fixture(); input.focus();
  const option = list.children[1];
  const down = new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  option.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true); expect(input.value).toBe('');
  expect(doc.activeElement).toBe(input);
  option.dispatchEvent(new win.Event('pointerup', { bubbles: true }));
  option.click();
  expect(input.value).toBe('Work'); expect(list.hidden).toBe(true);
  expect(doc.activeElement).toBe(input); expect(writes(win)).toHaveLength(0);
});

test('fallback focus transfer to option survives blur before click; outside focus closes without selection', () => {
  const { input, list, doc, win } = fixture(); input.focus();
  const option = list.children[2];
  option.focus(); // Browser/accessibility activation that transfers focus before click.
  expect(list.hidden).toBe(false);
  option.click(); expect(input.value).toBe('Walk'); expect(doc.activeElement).toBe(input);
  input.value = ''; input.click();
  doc.getElementById('life-log-value').focus();
  expect(list.hidden).toBe(true); expect(input.value).toBe(''); expect(writes(win)).toHaveLength(0);
});

test('cancelled touch gesture does not select or intercept touchmove', () => {
  const { win, input, list } = fixture(); input.focus();
  const option = list.children[0];
  option.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  const move = new win.Event('touchmove', { bubbles: true, cancelable: true }); option.dispatchEvent(move);
  option.dispatchEvent(new win.Event('pointercancel', { bubbles: true }));
  expect(move.defaultPrevented).toBe(false); expect(input.value).toBe(''); expect(writes(win)).toHaveLength(0);
});

test('composition Enter cannot select or prevent IME confirmation', () => {
  const { win, input, list, key, type } = fixture(['日本語', '日本']); input.focus();
  key('ArrowDown'); input.dispatchEvent(new win.Event('compositionstart')); type('日');
  expect(list.hidden).toBe(true); expect(key('Enter', { isComposing: true }).defaultPrevented).toBe(false);
  expect(input.value).toBe('日'); input.dispatchEvent(new win.Event('compositionend'));
  expect(list.children).toHaveLength(2); expect(input.hasAttribute('aria-activedescendant')).toBe(false);
});

test('untrusted labels render as text and never create executable markup or selector IDs', () => {
  const malicious = '<img src=x onerror="window.injected=1"><script>bad()</script>';
  const { win, input, list, options } = fixture([malicious, '" autofocus onfocus="bad()']); input.focus();
  expect(options()).toContain(malicious); expect(list.querySelector('img, script')).toBeNull();
  expect(win.injected).toBeUndefined(); expect(list.children[0].id).toBe('life-log-label-options-0');
  list.children[0].click(); expect(input.value).toBe(malicious);
});

test('successful save adds a new label only once, resets popup, and keeps payload casing/trim/CSRF', async () => {
  const { win, input, form, doc, type, options, list } = fixture();
  input.focus(); type('  NEW Label  '); doc.getElementById('life-log-value').value = '1';
  form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await flush();
  expect(writes(win)).toHaveLength(1);
  const [, request] = writes(win)[0];
  expect(JSON.parse(request.body).label).toBe('NEW Label');
  expect(request.headers['X-CSRF-Token']).toBe('s'.repeat(43));
  expect(input.value).toBe(''); expect(list.hidden).toBe(true);
  input.click(); expect(options()[0]).toBe('NEW Label');
  type('new label'); form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
  type('new'); expect(options()).toEqual(['new label']);
});

test('failed asynchronous save neither caches a label nor clears typed input', async () => {
  const { win, input, form, type, options } = fixture();
  let resolve; win.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  input.focus(); type('Unsaved label'); form.dispatchEvent(new win.Event('submit', { cancelable: true }));
  type('Wo'); resolve({ ok: false, json: async () => ({ error: 'Synthetic failure' }) }); await flush();
  expect(input.value).toBe('Wo'); expect(options()).toEqual(['Work']);
  type('Unsaved'); expect(options()).toEqual([]);
});

test('native reset, chip fill, script reevaluation and replacement form initialize cleanly', async () => {
  const { win, doc, input, list, form, options } = fixture();
  input.focus(); form.reset(); expect(list.hidden).toBe(true);
  doc.querySelector('.life-log-chip').click(); expect(input.value).toBe('Work'); expect(options()).toEqual(['Work']);
  win.eval(script); expect(doc.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  let events = 0; input.addEventListener('input', () => events++);
  list.children[0].click(); expect(events).toBe(1);
  form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush(); expect(writes(win)).toHaveLength(1);
  const replacement = form.cloneNode(true); replacement.removeAttribute('data-life-log-initialized');
  form.replaceWith(replacement); win.eval(script);
  const fresh = doc.getElementById('life-log-label'); fresh.focus();
  expect(doc.getElementById('life-log-label-options').hidden).toBe(false);
  replacement.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush(); expect(writes(win)).toHaveLength(2);
});

test('non-dashboard mode retains the native datalist contract', () => {
  const { input, list } = fixture(['Work'], false); input.focus();
  expect(input.getAttribute('list')).toBe('life-log-labels');
  expect(input.hasAttribute('role')).toBe(false); expect(list.hidden).toBe(true);
});
