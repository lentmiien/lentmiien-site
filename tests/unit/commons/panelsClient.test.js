const fs = require('fs');
const vm = require('vm');
let JSDOM, dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup(request) {
  dom = new JSDOM('<section id="private-panel" hidden></section>', { runScripts: 'outside-only' });
  dom.window.CommonsWorld = require('../../../public/commons/world');
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  vm.runInContext(fs.readFileSync('public/commons/panels.js', 'utf8'), dom.getInternalVMContext());
  const panels = dom.window.CommonsPanels({ request, toast: jest.fn() }); panels.identify('owner-session-a');
  const root = dom.window.document.getElementById('private-panel');
  const click = async text => { [...root.querySelectorAll('button')].find(n => n.textContent === text).click(); await settle(); };
  const edit = text => { const node = root.querySelector('[aria-label="Diary text"]'); node.value = text; node.dispatchEvent(new dom.window.Event('input')); };
  return { panels, root, click, edit };
}
const entry = (date, text = '', revision = 0, today = date) => ({ today, entry: { date, text, revision } });
test('Tokyo midnight retains yesterday draft, disables stale save and loads today without backdating', async () => {
  let today = '2026-10-09';
  const request = jest.fn(async (_path, body) => body ? { error: 'DAY_CHANGED' } : entry(today));
  const h = setup(request); await h.panels.open('diary'); h.edit('Private synthetic draft'); today = '2026-10-10';
  await h.click('Save today’s page');
  expect(h.root.textContent).toContain('Tokyo’s date changed'); expect(h.root.querySelector('[aria-label="Diary text"]').value).toBe('Private synthetic draft');
  await h.click('Load today');
  expect(h.root.querySelector('[aria-label="Diary text"]').value).toBe('');
  expect(h.root.querySelector('[aria-label="Retained draft 2026-10-09"]').value).toBe('Private synthetic draft');
  expect(request.mock.calls.filter(c => c[1]).map(c => c[1].date)).toEqual(['2026-10-09']);
});
test('disconnect clears visible data; same owner session restores draft; account switch clears it', async () => {
  const h = setup(async () => entry('2026-10-09')); await h.panels.open('diary'); h.edit('<script>private synthetic</script>');
  h.panels.reset(); expect(h.root.textContent).toBe(''); expect(h.root.hidden).toBe(true);
  h.panels.identify('owner-session-a'); await h.panels.open('diary');
  expect(h.root.querySelector('textarea').value).toContain('<script>'); expect(h.root.querySelectorAll('script')).toHaveLength(0);
  h.panels.reset(); h.panels.identify('owner-session-b'); await h.panels.open('diary');
  expect(h.root.querySelector('textarea').value).toBe(''); expect(h.root.textContent).not.toContain('private synthetic');
});
test('missing database index leaves the draft recoverable and explains setup without exposing metadata', async () => {
  const h = setup(async (_path, body) => body ? { error: 'DIARY_INDEX_UNAVAILABLE' } : entry('2026-10-09'));
  await h.panels.open('diary'); h.edit('Synthetic unsaved draft'); await h.click('Save today’s page');
  expect(h.root.textContent).toContain('awaiting database setup');
  h.panels.reset(); await h.panels.open('diary');
  expect(h.root.querySelector('[aria-label="Diary text"]').value).toBe('Synthetic unsaved draft');
});
test('late private responses cannot reopen after takeover or authorization reset', async () => {
  let finish; const h = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.panels.open('diary'); h.panels.reset(); h.panels.identify('owner-session-b');
  finish(entry('2026-10-09', 'Old private payload')); await pending;
  expect(h.root.hidden).toBe(true); expect(h.root.textContent).toBe('');
});
test('conflict recovery remains available across panel close/reopen and never silently overwrites server text', async () => {
  let saved = 'Saved version';
  const h = setup(async (_path, body) => body ? { error: 'REVISION_CONFLICT' } : entry('2026-10-09', saved, 2));
  await h.panels.open('diary'); h.edit('Unsaved local version'); await h.click('Save today’s page');
  expect(h.root.textContent).toContain('Another tab saved'); saved = 'Other tab won'; await h.click('Reload saved entry');
  expect(h.root.querySelector('[aria-label="Diary text"]').value).toBe('Other tab won');
  expect(h.root.querySelector('[aria-label="Retained draft"]').value).toBe('Unsaved local version');
  h.panels.reset(); await h.panels.open('diary'); expect(h.root.querySelector('[aria-label="Retained draft"]').value).toBe('Unsaved local version');
});
test('history is read-only, fields are escaped, and no unapproved links are created', async () => {
  const h = setup(async () => entry('2026-10-08', '<img src=x onerror=alert(1)>', 1, '2026-10-09'));
  await h.panels.open('diary'); const editor = h.root.querySelector('textarea'); expect(editor.readOnly).toBe(true);
  expect([...h.root.querySelectorAll('button')].find(n => n.textContent === 'Save today’s page').disabled).toBe(true);
  expect(h.root.querySelectorAll('img')).toHaveLength(0);
  h.panels.reset();
});
test('confirmed quest disappears immediately even if subsequent refresh fails', async () => {
  let reads = 0;
  const h = setup(async (_path, body) => body ? { ok: true, done: true } : ++reads === 1 ? { rows: [{ taskId: '1'.repeat(24), title: 'Synthetic quest', canComplete: true }] } : { error: 'UNAVAILABLE' });
  await h.panels.open('quests'); await h.click('Report as done');
  expect(h.root.textContent).not.toContain('Synthetic quest'); expect(h.root.textContent).toContain('No entries');
});
