const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pug = require('pug');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const script = read('public/js/nav.js');

function fixture({ resizeObserver = true, mutationObserver = true, topbarPresent = true, fonts = true } = {}) {
  const element = () => ({
    handlers: {}, isConnected: true,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    setAttribute: jest.fn(),
  });
  const elements = Object.fromEntries(['navbar', 'tools-toggle', 'tools-close', 'tools-search', 'tools-search-status'].map(id => [id, element()]));
  const topbar = { height: 54, getBoundingClientRect: jest.fn(() => ({ height: topbar.height })) };
  const style = { setProperty: jest.fn() };
  const document = {
    getElementById: id => elements[id],
    querySelector: jest.fn(() => topbarPresent ? topbar : null),
    querySelectorAll: () => [],
    documentElement: { style },
    body: { classList: { add: jest.fn(), remove: jest.fn() } },
    activeElement: null,
  };
  Object.values(elements).forEach(el => { el.focus = jest.fn(() => { document.activeElement = el; }); });
  const dialog = elements.navbar;
  dialog.showModal = jest.fn(() => { dialog.open = true; });
  dialog.close = jest.fn(() => { dialog.open = false; dialog.handlers.close(); });
  const links = [
    { dataset: { toolSearch: 'Chat Writing', toolId: 'chat' }, hidden: false },
    { dataset: { toolSearch: 'Garden Home', toolId: 'garden' }, hidden: false },
    { dataset: { toolSearch: 'Chat Writing' }, hidden: false }, // Shortcut duplicate.
  ];
  const groups = links.slice(0, 2).map(link => ({ querySelector: () => link.hidden ? null : link }));
  dialog.querySelectorAll = selector => selector === '[data-tool-search]' ? links : groups;
  const window = element();
  const observers = {};
  for (const [name, enabled] of [['ResizeObserver', resizeObserver], ['MutationObserver', mutationObserver]]) {
    if (enabled) window[name] = class {
      constructor(callback) { this.callback = callback; this.observe = jest.fn(); observers[name] = this; }
    };
  }
  let fontsReady;
  if (fonts) document.fonts = { ready: new Promise(resolve => { fontsReady = resolve; }) };
  vm.runInNewContext(script, { document, window });
  return { document, window, elements, links, groups, style, topbar, observers, fontsReady };
}

test('navigation alone owns the spacer and shares clearance with document scrolling', () => {
  const nav = read('public/css/nav.css');
  const layout = read('views/layout.pug');
  expect(layout.indexOf('/css/nav.css')).toBeLessThan(layout.indexOf('/css/brand.css'));
  expect(nav).toMatch(/--nav-clearance:\s*calc\(4rem \+ env\(safe-area-inset-top, 0px\)\)/);
  expect(nav).toMatch(/\.nav-placeholder\s*\{\s*height:\s*var\(--nav-clearance\)/);
  expect(nav).toMatch(/html\s*\{\s*scroll-padding-top:\s*var\(--nav-clearance\)/);
  for (const file of fs.readdirSync(path.join(__dirname, '../../public/css')).filter(file => file.endsWith('.css') && file !== 'nav.css')) {
    const css = read(`public/css/${file}`);
    expect(css).not.toMatch(/\.nav-placeholder\b/);
    expect(css).not.toMatch(/--nav-clearance\s*:/);
  }
  const bar = nav.match(/\.account-topbar\s*\{([^}]+)\}/)[1];
  expect(bar).toMatch(/position:\s*fixed/);
  expect(bar).toMatch(/min-height:/);
  expect(bar).not.toMatch(/(?:^|;)\s*height:/);
  expect(bar).not.toContain('--nav-clearance'); // Prevent measurement feedback.
  expect(bar).toContain('flex-wrap: wrap');
  for (const side of ['top', 'left', 'right']) expect(bar).toContain(`safe-area-inset-${side}`);
  expect(nav).toMatch(/@media \(max-width: 640px\)/);
});

test('document sticky controls share clearance while the nested event feed retains its own scrolling', () => {
  expect(read('public/css/brand.css')).toMatch(/\.chat5-bucket-header\s*\{[^}]*top:\s*var\(--nav-clearance, 0px\)/);
  const codex = read('public/css/codex.css');
  expect(codex).toMatch(/\.codex-process-main > \.codex-new-updates-button\s*\{[^}]*top:\s*calc\(var\(--nav-clearance, 0px\) \+ 8px\)/);
  expect(codex).toMatch(/\.codex-process-sidebar\s*\{[^}]*max-height:\s*calc\(100vh - var\(--nav-clearance, 0px\) - 24px\)/);
  expect(codex).toMatch(/\.codex-process-panel \.codex-events\s*\{[^}]*overflow-y: auto/);
  expect(codex).toMatch(/\.codex-events\[data-event-view-mode='focused'\] \.codex-event--todo-list\s*\{[^}]*bottom: 10px/);
});

test('measures only the persistent bar and follows growth, shrinking and fractional heights', () => {
  const f = fixture();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '64px');
  expect(f.observers.ResizeObserver.observe).toHaveBeenCalledWith(f.topbar, { box: 'border-box' });
  expect(f.observers.MutationObserver).toBeUndefined();
  for (const [height, clearance] of [[112.25, '123px'], [54, '64px']]) {
    f.topbar.height = height;
    f.observers.ResizeObserver.callback();
    expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', clearance);
  }
  const count = f.style.setProperty.mock.calls.length;
  for (const height of [54, 0, NaN, Infinity, -1]) {
    f.topbar.height = height;
    f.observers.ResizeObserver.callback();
  }
  expect(f.style.setProperty).toHaveBeenCalledTimes(count);
});

test('fallback follows action label mutations, viewport changes, load and late fonts', async () => {
  const f = fixture({ resizeObserver: false });
  expect(f.observers.MutationObserver.observe).toHaveBeenCalledWith(f.topbar, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
  f.topbar.height = 100;
  f.observers.MutationObserver.callback();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '110px');
  f.topbar.height = 80;
  f.window.handlers.resize();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '90px');
  f.topbar.height = 90;
  f.window.handlers.load();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '100px');
  f.topbar.height = 120;
  f.fontsReady();
  await Promise.resolve();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '130px');
});

test('missing optional APIs or topbar do not break legacy navigation', () => {
  const f = fixture({ resizeObserver: false, mutationObserver: false, fonts: false });
  f.topbar.height = 70;
  f.window.handlers.resize();
  expect(f.style.setProperty).toHaveBeenLastCalledWith('--nav-clearance', '80px');
  const missing = fixture({ topbarPresent: false });
  expect(missing.style.setProperty).not.toHaveBeenCalled();
  expect(missing.window.toggleNavbar).toEqual(expect.any(Function));
});

test('Tools keeps search, modal focus and close restoration without altering clearance', () => {
  const f = fixture();
  const toggle = f.elements['tools-toggle'];
  const search = f.elements['tools-search'];
  toggle.focus();
  toggle.handlers.click();
  expect(f.elements.navbar.showModal).toHaveBeenCalledTimes(1);
  expect(f.document.activeElement).toBe(search);
  expect(toggle.setAttribute).toHaveBeenLastCalledWith('aria-expanded', 'true');
  search.value = '  CHAT  ';
  search.handlers.input();
  expect(f.links.map(link => link.hidden)).toEqual([false, true, false]);
  expect(f.groups.map(group => group.hidden)).toEqual([false, true]);
  expect(f.groups[0].open).toBe(true);
  expect(f.elements['tools-search-status'].textContent).toBe('1 tools found');
  search.value = '';
  search.handlers.input();
  expect(f.links.every(link => !link.hidden)).toBe(true);
  // Native Escape closes the dialog and emits this same close event.
  f.elements.navbar.close();
  expect(f.document.activeElement).toBe(toggle);
  expect(toggle.setAttribute).toHaveBeenLastCalledWith('aria-expanded', 'false');
  expect(f.document.body.classList.remove).toHaveBeenCalledWith('no-scroll');
  f.window.toggleNavbar();
  f.elements['tools-close'].handlers.click();
  expect(f.elements.navbar.open).toBe(false);
  expect(f.style.setProperty).toHaveBeenCalledTimes(1);
});

test('shared layout preserves the modal and legacy page hooks', () => {
  const html = pug.renderFile(path.join(__dirname, '../../views/layout.pug'), {
    loggedIn: true, chatmode: true, permissions: [], bookmarks: [], htmlPaths: [],
  });
  for (const id of ['actionBtn', 'goTopPageBtn', 'history_list', 'head_list']) expect(html).toContain(`id="${id}"`);
  expect(html).toContain('<header class="account-topbar">');
  expect(html).toContain('<dialog class="account-tools" id="navbar"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('<script src="/js/nav.js" defer>');
});
