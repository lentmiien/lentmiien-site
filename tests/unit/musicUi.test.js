const fs = require('fs');
const vm = require('vm');
const pug = require('pug');
const { normalizeCatalog } = require('../../services/musicGatewayService');
const { parseLosslessJson } = require('../../utils/losslessJson');
let JSDOM, dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());
function setup({ admin = false, catalog } = {}) {
  catalog ||= normalizeCatalog(parseLosslessJson(fs.readFileSync('tests/fixtures/music/models.json', 'utf8')));
  const html = pug.renderFile(admin ? 'views/admin_music_test.pug' : 'views/music_library.pug', { library: [], musicCatalog: catalog, musicPrefix: admin ? '/admin/music-test' : '/music', adminMode: admin, explorer: null, explorerError: null, defaults: {}, csrfToken: 'A'.repeat(43), loggedIn: true, admin, permissions: [], htmlPaths: [], bookmarks: [] });
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://site.invalid/music' });
  dom.window.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ skipped: true }) });
  for (const file of ['music_controls.js', 'music_library.js']) vm.runInContext(fs.readFileSync('public/js/' + file, 'utf8'), dom.getInternalVMContext());
  return dom.window.document;
}
function selectModel(document, model) { const el = document.getElementById('music-model'); el.value = model; el.dispatchEvent(new dom.window.Event('change')); }
function selectYue(document) { selectModel(document, 'yue2-3b'); }
const flush = () => new Promise(resolve => setImmediate(resolve));
test('model selection updates caption length, required lyrics, format/defaults and gates ACE controls', () => {
  const d = setup(); expect(d.getElementById('caption').maxLength).toBe(512);
  selectYue(d);
  expect(d.getElementById('caption').maxLength).toBe(2000); expect(d.getElementById('lyrics').required).toBe(true);
  expect(d.getElementById('music-ace-controls').disabled).toBe(true);
  expect(d.getElementById('timeout_sec').value).toBe('3630');
  expect(d.getElementById('infinity-generator').textContent).toContain('yue2-3b');
  const data = new dom.window.FormData(d.getElementById('music-generate-form'));
  expect(data.has('instrumental')).toBe(false); expect(data.has('load_llm')).toBe(false);
  expect(data.get('max_duration')).toBe('300'); expect(data.get('seed')).toBe('');
  expect([...d.getElementById('audio_format').options].map(o => o.value)).toEqual(['flac', 'wav']);
});
test('switching models preserves each model’s settings without copying ACE options', () => {
  const d = setup(); d.getElementById('duration').value = '100'; selectYue(d); d.getElementById('max_duration').value = '12';
  const el = d.getElementById('music-model'); el.value = 'ace-step-1.5-xl-turbo'; el.dispatchEvent(new dom.window.Event('change'));
  expect(d.getElementById('duration').value).toBe('100'); expect(d.getElementById('caption').maxLength).toBe(512);
  selectYue(d); expect(d.getElementById('max_duration').value).toBe('12');
});
describe.each(['ace-step-1.5-xl-turbo', 'yue2-3b'])('seed settings for %s', model => {
  const otherModel = model === 'yue2-3b' ? 'ace-step-1.5-xl-turbo' : 'yue2-3b';
  test.each(['', '0', '123', '9007199254740991', '9223372036854775807'])('restores seed %p exactly across repeated switches', seed => {
    const d = setup(); selectModel(d, model);
    const input = d.getElementById('music-seed'); input.value = seed;
    selectModel(d, otherModel); input.value = '456';
    for (let i = 0; i < 2; i++) {
      selectModel(d, model); expect(input.value).toBe(seed);
      selectModel(d, otherModel); expect(input.value).toBe('456');
    }
  });
  describe.each([false, true])('submission for admin=%s', admin => {
    test.each(['manual', 'ai', 'infinity'].flatMap(mode => ['', '0', '123', '9007199254740991'].map(seed => [mode, seed])))('%s serializes restored seed %p', async (mode, seed) => {
      const d = setup({ admin }); selectModel(d, model);
      d.getElementById('music-seed').value = seed;
      selectModel(d, otherModel); d.getElementById('music-seed').value = '456';
      selectModel(d, model); d.getElementById('lyrics').value = '[Verse]\nA boat sails home';
      if (mode === 'infinity') {
        const toggle = d.getElementById('infinity-toggle'); toggle.checked = true;
        toggle.dispatchEvent(new dom.window.Event('change'));
      } else {
        d.getElementById(mode === 'manual' ? 'music-generate-form' : 'music-ai-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      }
      await flush();
      const calls = dom.window.fetch.mock.calls.filter(([url]) => url.includes('/generate'));
      expect(calls).toHaveLength(1);
      const [url, options] = calls[0]; const body = new URLSearchParams(String(options.body));
      expect(url).toBe('https://site.invalid' + (admin ? '/admin/music-test' : '/music') + (mode === 'manual' ? '/generate' : '/generate-ai'));
      expect(options.method).toBe('POST'); expect(body.get('model')).toBe(model);
      expect(body.has('seed')).toBe(seed !== ''); expect(body.get('seed')).toBe(seed === '' ? null : seed);
      expect(body.has('background')).toBe(mode === 'infinity');
      expect(body.get('_csrf')).toBe('A'.repeat(43));
      expect(body.has('max_duration')).toBe(model === 'yue2-3b');
      expect(body.has('instrumental')).toBe(model !== 'yue2-3b');
    });
  });
});
test.each([false, true])('AI submission keeps current generator/controls for admin=%s', async admin => {
  const d = setup({ admin }); selectYue(d); d.getElementById('max_duration').value = '12'; d.getElementById('ai-direction').value = 'folk';
  d.getElementById('music-ai-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await flush();
  const [url, options] = dom.window.fetch.mock.calls[0]; const body = new URLSearchParams(String(options.body));
  expect(url).toContain((admin ? '/admin/music-test' : '/music') + '/generate-ai');
  expect(body.get('model')).toBe('yue2-3b'); expect(body.get('max_duration')).toBe('12'); expect(body.get('direction')).toBe('folk');
  expect(body.has('instrumental')).toBe(false); expect(body.get('_csrf')).toBe('A'.repeat(43));
});
test('parallel browser submissions do not start duplicate work', async () => {
  const d = setup(); dom.window.fetch.mockImplementation(() => new Promise(() => {}));
  d.getElementById('music-generate-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  d.getElementById('music-ai-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await flush();
  expect(dom.window.fetch).toHaveBeenCalledTimes(1);
});
test('Infinity uses selected YuE2 and stops new submissions after an ambiguous failure', async () => {
  const d = setup(); selectYue(d);
  dom.window.fetch.mockImplementation(async url => {
    if (url.includes('generate-ai')) throw new Error('Outcome uncertain');
    return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'No tracks' }) };
  });
  const toggle = d.getElementById('infinity-toggle'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change')); await flush();
  const calls = dom.window.fetch.mock.calls.filter(([url]) => url.includes('generate-ai'));
  expect(calls).toHaveLength(1); expect(new URLSearchParams(String(calls[0][1].body)).get('model')).toBe('yue2-3b');
  expect(d.getElementById('infinity-status').textContent).toContain('paused');
  d.getElementById('infinity-next-btn').click(); await flush();
  expect(dom.window.fetch.mock.calls.filter(([url]) => url.includes('generate-ai'))).toHaveLength(1);
});
test('unavailable catalog disables generation and private JSON is escaped', () => {
  const d = setup({ catalog: { models: [], note: '</script><script>window.pwned=true</script>', default_model: 'ace-step-1.5-xl-turbo' } });
  expect(d.querySelector('#music-generate-form button').disabled).toBe(true);
  expect(dom.window.pwned).toBeUndefined();
  expect(d.getElementById('music-catalog').textContent).toContain('\\u003c');
  expect(d.documentElement.innerHTML).not.toContain('Gateway base:');
});

describe.each([['models.json', 300, 300, 3630], ['models-legacy.json', 30, 20, 1830]])('%s browser controls', (file, max, defaultDuration, execution) => {
  const discovered = () => normalizeCatalog(parseLosslessJson(fs.readFileSync(`tests/fixtures/music/${file}`, 'utf8')));
  describe.each([false, true])('admin=%s', admin => {
    test('limits, defaults and help match discovery and survive provider switching', () => {
      const d = setup({ admin, catalog: discovered() }); selectYue(d);
      const input = d.getElementById('max_duration');
      expect([input.min, input.max, input.value]).toEqual(['8', String(max), String(defaultDuration)]);
      expect(d.getElementById('timeout_sec').max).toBe(String(execution));
      const help = d.getElementById('max-duration-help').textContent;
      expect(help).toContain(`8–${max} seconds`); expect(help).toContain(`default: ${defaultDuration} seconds`);
      expect(help).toContain('may finish earlier'); expect(help).not.toContain('testing');
      expect(help.includes('5 minutes')).toBe(max === 300);
      input.value = '12'; selectModel(d, 'ace-step-1.5-xl-turbo');
      expect(d.getElementById('timeout_sec').value).toBe('7200');
      selectYue(d); expect(input.value).toBe('12');
    });
    test.each(['manual', 'ai', 'infinity'].flatMap(mode => [undefined, 12, 31, 300, 301].map(ceiling => [mode, ceiling])))('%s submits or rejects selected ceiling %s before network', async (mode, ceiling) => {
      const d = setup({ admin, catalog: discovered() }); selectYue(d);
      d.getElementById('lyrics').value = '[Verse]\nA boat sails home';
      if (ceiling !== undefined) d.getElementById('max_duration').value = String(ceiling);
      selectModel(d, 'ace-step-1.5-xl-turbo'); selectYue(d);
      if (mode === 'infinity') {
        const toggle = d.getElementById('infinity-toggle'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change'));
      } else d.getElementById(mode === 'manual' ? 'music-generate-form' : 'music-ai-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await flush();
      const calls = dom.window.fetch.mock.calls.filter(([url]) => url.includes('/generate'));
      if (ceiling > max) { expect(calls).toHaveLength(0); return; }
      expect(calls).toHaveLength(1);
      const body = new URLSearchParams(String(calls[0][1].body));
      expect(body.get('max_duration')).toBe(String(ceiling ?? defaultDuration));
      expect(body.get('timeout_sec')).toBe(String(execution));
      expect(body.get('model')).toBe('yue2-3b'); expect(body.has('instrumental')).toBe(false);
    });
  });
});
test('unverified fallback remains disabled and conservative before browser initialization', () => {
  const html = pug.renderFile('views/partials/music_controls.pug', { csrfToken: 'token', musicCatalog: { models: [], note: 'Unavailable' } });
  dom = new JSDOM(html);
  const d = dom.window.document;
  expect(d.getElementById('music-yue-controls').disabled).toBe(true);
  expect(d.getElementById('max_duration').max).toBe('30');
  expect(d.getElementById('max_duration').value).toBe('20');
});
