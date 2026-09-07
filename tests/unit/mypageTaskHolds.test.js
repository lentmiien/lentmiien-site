const { initTaskHolds, HOLD_MS } = require('../../public/js/mypage_tasks');

// Small DOM/event harness: the actual client handles all gestures and request state.
function element(parent = null, dataset = {}) {
  const listeners = new Map();
  const classes = new Set();
  const properties = new Map();
  return {
    parent, dataset, hidden: false, textContent: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key), getPropertyValue: (key) => properties.get(key) },
    addEventListener: (name, listener, capture) => {
      listeners.set(name, [...(listeners.get(name) || []), { listener, capture }]);
    },
    emit(name, fields = {}) {
      const event = { target: this, pointerId: 1, isPrimary: true, button: 0, clientX: 30, clientY: 30, detail: 1,
        preventDefault: jest.fn(), stopImmediatePropagation: jest.fn(), ...fields };
      (listeners.get(name) || []).forEach(({ listener }) => listener(event));
      return event;
    },
    contains(other) { return Boolean(other && (other === this || this.contains(other.parent))); },
    closest() { return this.dataset.taskId ? this : this.parent?.closest(); },
    setAttribute: jest.fn(), removeAttribute: jest.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 60 }),
    remove() { this.removed = true; },
    focus: jest.fn(),
  };
}

let doc;
let win;
let section;
let status;
let first;
let second;
let child;
let empty;
let settle;
let reject;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  doc = element();
  win = element();
  section = element(doc, { csrfToken: 'fixture-token' });
  first = element(section, { taskId: 'todo-id' });
  second = element(section, { taskId: 'tobuy-id' });
  child = element(first);
  empty = element(section);
  empty.hidden = true;
  status = element(doc);
  section.querySelector = (selector) => selector === '[data-task-id]'
    ? [first, second].find((item) => !item.removed) : empty;
  doc.getElementById = (id) => id === 'mypage-tasks' ? section : status;
  Object.assign(win, {
    PointerEvent: function PointerEvent() {}, AbortController,
    performance: { now: () => Date.now() },
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 10),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout, clearTimeout,
    fetch: jest.fn(() => new Promise((resolve, fail) => { settle = resolve; reject = fail; })),
  });
  initTaskHolds(doc, win);
});

afterEach(() => jest.useRealTimers());
function down(fields = {}) { return doc.emit('pointerdown', { target: child, ...fields }); }
function up(fields = {}) { return doc.emit('pointerup', { target: child, ...fields }); }
function click(fields = {}) { return doc.emit('click', { target: child, ...fields }); }
function hold() { down(); jest.advanceTimersByTime(HOLD_MS); }
function success() { settle({ ok: true, json: async () => ({ ok: true, done: true }) }); }

test('normal item/section/keyboard and modified clicks keep navigation', () => {
  down();
  jest.advanceTimersByTime(100);
  up();
  expect(click().preventDefault).not.toHaveBeenCalled();
  expect(click({ target: section }).preventDefault).not.toHaveBeenCalled();
  expect(click({ detail: 0 }).preventDefault).not.toHaveBeenCalled();
  down({ ctrlKey: true });
  jest.advanceTimersByTime(HOLD_MS);
  up();
  expect(click().preventDefault).not.toHaveBeenCalled();
  expect(win.fetch).not.toHaveBeenCalled();
});

test('fills progress for 900 ms, then sends exactly that task with CSRF, retaining it until success', async () => {
  expect(HOLD_MS).toBe(900);
  down();
  jest.advanceTimersByTime(450);
  expect(first.classList.contains('is-holding')).toBe(true);
  expect(Number(first.style.getPropertyValue('--hold-progress'))).toBeCloseTo(0.5);
  expect(win.fetch).not.toHaveBeenCalled();
  jest.advanceTimersByTime(450);
  expect(first.classList.contains('is-saving')).toBe(true);
  expect(first.removed).not.toBe(true);
  expect(win.fetch).toHaveBeenCalledWith('/mypage/api/tasks/todo-id/done', expect.objectContaining({
    method: 'PATCH', credentials: 'same-origin', body: '{"done":true}',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'fixture-token' }),
  }));
  success(); await flush();
  expect(first.removed).toBe(true);
  expect(second.removed).not.toBe(true);
  expect(status.textContent).toBe('Task completed.');
  expect(empty.hidden).toBe(true);
});

test.each(['release', 'move', 'outside', 'cancel', 'lostcapture', 'leave', 'scroll', 'blur', 'hidden', 'escape', 'second-pointer', 'drag'])('cancels on %s without hiding or requesting', (mode) => {
  down({ pointerType: 'touch' });
  jest.advanceTimersByTime(450);
  if (mode === 'release') up();
  if (mode === 'move') doc.emit('pointermove', { clientX: 41 });
  if (mode === 'outside') {
    first.getBoundingClientRect = () => ({ left: 29, right: 35, top: 0, bottom: 60 });
    doc.emit('pointermove', { clientX: 36 });
  }
  if (mode === 'cancel') doc.emit('pointercancel');
  if (mode === 'lostcapture') doc.emit('lostpointercapture');
  if (mode === 'leave') doc.emit('pointerout', { relatedTarget: section });
  if (mode === 'scroll') doc.emit('scroll', { target: child });
  if (mode === 'blur') win.emit('blur');
  if (mode === 'hidden') { doc.hidden = true; doc.emit('visibilitychange'); }
  if (mode === 'escape') doc.emit('keydown', { key: 'Escape' });
  if (mode === 'second-pointer') down({ pointerId: 2, isPrimary: false });
  if (mode === 'drag') section.emit('dragstart', { target: child });
  jest.advanceTimersByTime(1000);
  expect(win.fetch).not.toHaveBeenCalled();
  expect(first.removed).not.toBe(true);
  expect(first.classList.contains('is-holding')).toBe(false);
  expect(first.style.getPropertyValue('--hold-progress')).toBeUndefined();
  if (mode === 'release') expect(click().preventDefault).not.toHaveBeenCalled();
  else expect(click().preventDefault).toHaveBeenCalled();
});

test('small jitter and movement between title children do not cancel', () => {
  down();
  doc.emit('pointermove', { clientX: 34 });
  doc.emit('pointerout', { relatedTarget: first });
  doc.emit('pointerup', { pointerId: 2 });
  jest.advanceTimersByTime(HOLD_MS);
  expect(win.fetch).toHaveBeenCalledTimes(1);
});

test('suppresses release click even after removal retargets it to section/document', async () => {
  hold(); success(); await flush();
  up({ target: section });
  const event = click({ target: doc });
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopImmediatePropagation).toHaveBeenCalled();
  down({ target: second }); up({ target: second });
  expect(click({ target: second }).preventDefault).not.toHaveBeenCalled();
});

test('does not duplicate requests while pending, including another task hold', () => {
  hold(); up(); click();
  down({ target: second });
  jest.advanceTimersByTime(3000);
  up({ target: second });
  expect(click({ target: second }).preventDefault).toHaveBeenCalled();
  expect(win.fetch).toHaveBeenCalledTimes(1);
});

test.each(['network', 'http', 'redirect', 'invalid-json', 'not-done'])('restores item and reports %s failure without navigating', async (failure) => {
  hold();
  if (failure === 'network') reject(new Error('offline'));
  else settle({ ok: failure !== 'http', redirected: failure === 'redirect', json: async () => {
    if (failure === 'invalid-json') throw new Error('bad JSON');
    return { ok: true, done: failure !== 'not-done' };
  } });
  await flush();
  up();
  expect(click().preventDefault).toHaveBeenCalled();
  expect(first.removed).not.toBe(true);
  expect(first.classList.contains('is-saving')).toBe(false);
  expect(first.style.getPropertyValue('--hold-progress')).toBeUndefined();
  expect(status.classList.contains('is-error')).toBe(true);
  expect(status.textContent).toContain('Reload before trying again');
  hold();
  expect(win.fetch).toHaveBeenCalledTimes(2);
});

test('times out without hiding and leaves keyboard navigation available', async () => {
  win.fetch.mockImplementation((_url, options) => new Promise((_resolve, fail) => {
    options.signal.addEventListener('abort', () => fail(new Error('aborted')));
  }));
  hold();
  jest.advanceTimersByTime(15000); await flush();
  expect(first.removed).not.toBe(true);
  expect(status.classList.contains('is-error')).toBe(true);
  expect(click({ detail: 0 }).preventDefault).not.toHaveBeenCalled();
});

test('last task success shows empty link and restores focus', async () => {
  second.removed = true;
  doc.activeElement = first;
  hold(); success(); await flush();
  expect(empty.hidden).toBe(false);
  expect(empty.focus).toHaveBeenCalled();
  expect(status.textContent).toContain('No tasks left');
});

test('suppresses touch callouts only during hold, retaining ordinary context menus', () => {
  expect(section.emit('contextmenu').preventDefault).not.toHaveBeenCalled();
  down();
  expect(section.emit('contextmenu').preventDefault).toHaveBeenCalled();
  up();
  expect(section.emit('contextmenu').preventDefault).not.toHaveBeenCalled();
});
