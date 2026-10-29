const fs = require('fs');
const pug = require('pug');
let dom;
afterEach(() => dom?.window.close());
async function page(fetch) {
  const { JSDOM } = await import('jsdom');
  const html = pug.renderFile('views/admin_experimental_models.pug', {
    experiments: require('../../services/experimentalModels/registry').listExperiments(),
    csrfToken: 'A'.repeat(43), loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [],
  });
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://site.invalid/admin/experimental-models' });
  dom.window.HTMLMediaElement.prototype.pause = jest.fn();
  dom.window.HTMLMediaElement.prototype.load = jest.fn();
  dom.window.fetch = fetch;
  dom.window.eval(fs.readFileSync('public/js/experimental-models.js', 'utf8'));
  await settle();
  return dom.window.document;
}
async function settle() { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve)); }
const response = data => ({ ok: true, json: async () => data });
const session = { id: '11111111-1111-4111-8111-111111111111', expiresAt: 86400000, bytes: 100, assets: [] };

test('working staging controls send header CSRF, refresh state, clear without exposing model runs', async () => {
  let sessions = [];
  const fetch = jest.fn(async (url, options) => {
    if (options.method === 'POST') sessions = [session];
    if (options.method === 'DELETE') sessions = [];
    return response(options.method ? { ok: true } : { sessions });
  });
  const document = await page(fetch);
  expect(document.getElementById('lab-status').textContent).toContain('No test data');
  document.getElementById('lab-create').click(); await settle();
  expect(document.querySelectorAll('.lab-session')).toHaveLength(1);
  const call = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(call[0]).toBe('/admin/experimental-models/api/sessions');
  expect(call[1].headers['X-CSRF-Token']).toBe('A'.repeat(43));
  expect(call[1].credentials).toBe('same-origin');
  expect(call[1].body).toBeUndefined();
  expect(document.getElementById('ming-reference').disabled).toBe(true);
  Array.from(document.querySelectorAll('.lab-session button')).find(button => button.textContent.startsWith('Clear session')).click();
  await settle();
  expect(document.querySelectorAll('.lab-session')).toHaveLength(0);
  expect(fetch.mock.calls.find(([, options]) => options.method === 'DELETE')[0]).toBe(`/admin/experimental-models/api/sessions/${session.id}`);
});

test('renders server errors as inert text and permits retry', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '<img src=x onerror=alert(1)>' }) });
  const document = await page(fetch);
  expect(document.getElementById('lab-status').textContent).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('#lab-status img')).toBeNull();
  expect(document.getElementById('lab-create').disabled).toBe(false);
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test('empty or oversized image is rejected before upload; valid selection uses a single file part', async () => {
  const fetch = jest.fn(async () => response({ sessions: [session] }));
  const document = await page(fetch);
  const upload = () => Array.from(document.querySelectorAll('.lab-session button')).find(button => button.textContent === 'Upload image');
  upload().click(); await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(document.getElementById('lab-status').textContent).toContain('Choose one image');
  const picker = document.querySelector('.lab-session input');
  const file = new dom.window.File(['synthetic'], 'test.png', { type: 'image/png' });
  Object.defineProperty(picker, 'files', { value: [file] });
  upload().click(); await settle();
  const call = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(call[0]).toBe(`/admin/experimental-models/api/sessions/${session.id}/files`);
  expect(Array.from(call[1].body.keys())).toEqual(['file']);
  expect(call[1].headers['Content-Type']).toBeUndefined(); // Browser supplies multipart boundary.
});

test('WeVis forms send exact queries and omit OCR query content', async () => {
  const image = { id: '22222222-2222-4222-8222-222222222222', mime: 'image/png', width: 128, height: 128, bytes: 100 };
  const fetch = jest.fn(async (url, options = {}) => response(options.method ? { id: 'job' } : { sessions: [{ ...session, assets: [image] }] }));
  const document = await page(fetch), task = document.getElementById('wevis-task'), query = document.getElementById('wevis-query');
  for (const value of ['detection', 'referring', 'point', 'count_box', 'count_point', 'ocr_grounding', 'ocr']) {
    task.value = value; task.dispatchEvent(new dom.window.Event('change'));
    query.value = value === 'referring' ? 'cup, near plate' : 'cups\nplates';
    document.getElementById('lab-wevis').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const posted = JSON.parse(fetch.mock.calls.filter(([, options]) => options?.method === 'POST').at(-1)[1].body);
    expect(posted).toEqual({ fileId: image.id, task: value, query: value === 'ocr' ? '' : query.value, max_new_tokens: 1024 });
  }
  expect(document.getElementById('wevis-preview').src).toContain(`/sessions/${session.id}/files/${image.id}`);
  expect(query.disabled).toBe(true);
});

test('Ming task switching hides inactive controls, inserts exact tags at cursor, omits unused fields', async () => {
  const fetch = jest.fn(async (url, options = {}) => response(options.method ? {} : { sessions: [session] }));
  const document = await page(fetch), task = document.getElementById('ming-task'), text = document.getElementById('ming-text');
  text.value = 'Hello world'; text.setSelectionRange(6, 6);
  Array.from(document.querySelectorAll('#ming-tags button')).find(b => b.textContent === '[Uhm]').click();
  expect(text.value).toBe('Hello [Uhm]world');
  document.getElementById('ming-style').value = 'Calm';
  document.getElementById('lab-ming').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
  let posted = JSON.parse(fetch.mock.calls.filter(([, options]) => options?.method === 'POST').at(-1)[1].body);
  expect(posted).toEqual({ task: 'VOICE_DESIGN', text: 'Hello [Uhm]world', language: 'en', controls: { style: 'Calm' }, max_decode_steps: 200 });
  task.value = 'FREEFORM'; task.dispatchEvent(new dom.window.Event('change'));
  expect(document.getElementById('ming-style').disabled).toBe(true); expect(document.getElementById('ming-instruction').disabled).toBe(false);
  document.getElementById('ming-instruction').value = 'Speak softly';
  document.getElementById('lab-ming').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
  posted = JSON.parse(fetch.mock.calls.filter(([, options]) => options?.method === 'POST').at(-1)[1].body);
  expect(posted).toEqual({ task: 'FREEFORM', text: 'Hello [Uhm]world', language: 'en', instruction: 'Speak softly', max_decode_steps: 200 });
  expect(document.querySelector('option[value="TTS"]').disabled).toBe(true);
  expect(fetch.mock.calls.some(([url]) => /voices|catalog|registration/.test(url))).toBe(false);
});

test('JSON inspectors and overlays keep model labels and raw output inert', async () => {
  const imageId = '22222222-2222-4222-8222-222222222222', resultId = '33333333-3333-4333-8333-333333333333';
  const payload = '<img src=x onerror=alert(1)>', output = { raw_text: payload, text: payload, regions: [
    { shape: 'box', pixels: [0, 0, 50, 50], label: payload }, { shape: 'point', pixels: [999, 999], label: 'out of bounds' },
    { shape: 'polygon', pixels: [0, 0, 100, 0, 50, 100], label: payload }, { shape: 'script', pixels: [0, 0], label: payload }], count: 2, declared_count: 2 };
  const data = { ...session, assets: [{ id: imageId, mime: 'image/png', width: 128, height: 128, bytes: 50 }, { id: resultId, mime: 'application/json', bytes: 50 }], jobs: [
    { id: '44444444-4444-4444-8444-444444444444', model: 'wevisone-vl', state: 'succeeded', fileId: imageId, resultId, request: payload, status: 200, headers: {}, createdAt: 1, endedAt: 2 }] };
  const fetch = jest.fn(async url => response(url.endsWith(resultId) ? output : { sessions: [data] }));
  const document = await page(fetch);
  Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Inspect result and overlay').click(); await settle();
  expect(document.querySelector('.lab-job').textContent).toContain(payload);
  expect(document.querySelector('.lab-job img[onerror]')).toBeNull(); expect(document.querySelectorAll('.lab-preview svg rect')).toHaveLength(1);
  expect(document.querySelectorAll('.lab-preview svg polygon')).toHaveLength(1); expect(document.querySelectorAll('.lab-preview svg circle')).toHaveLength(0);
  expect(document.querySelector('.lab-preview svg title').textContent).toBe(payload);
  expect(document.querySelectorAll('.lab-preview svg script')).toHaveLength(0);
  const toggle = document.querySelector('.lab-job input[type=checkbox]'); toggle.checked = false; toggle.dispatchEvent(new dom.window.Event('change'));
  expect(document.querySelector('.lab-preview svg').style.display).toBe('none');
});

test('pending deletion polls until gone and preserves typed forms while waiting', async () => {
  let pending = true;
  const fetch = jest.fn(async () => response({ sessions: pending ? [{ ...session, deletePending: true }] : [] }));
  const document = await page(fetch);
  expect(document.querySelector('.lab-session').textContent).toContain('Deletion pending');
  expect(document.querySelector('.lab-session button')).toBeNull();
  document.getElementById('ming-text').value = 'Keep this draft';
  pending = false; document.getElementById('lab-refresh').click(); await settle();
  expect(document.querySelector('.lab-session')).toBeNull(); expect(document.getElementById('ming-text').value).toBe('Keep this draft');
});

test('capability v1 enables all reference forms with exact conditional fields, languages, preview and explicit consent', async () => {
  const asset = { id: '22222222-2222-4222-8222-222222222222', mime: 'audio/wav', bytes: 64044,
    audio: { sampleRate: 16000, channels: 2, bitsPerSample: 16, durationSeconds: 1 } };
  const fetch = jest.fn(async (url, options = {}) => response(url.endsWith('/capabilities') ? { available: true, referenceAdapter: 'available', ephemeral_reference: { version: 1 } }
    : options.method ? {} : { sessions: [{ ...session, assets: [asset] }] }));
  const document = await page(fetch);
  document.querySelector('.lab-capabilities[data-model="ming-tts"]').click(); await settle();
  for (const task of ['TTS', 'MULTILINGUAL', 'BASIC', 'EMOTION', 'DIALECT']) {
    expect(document.querySelector(`option[value="${task}"]`).disabled).toBe(false);
    const select = document.getElementById('ming-task'); select.value = task; select.dispatchEvent(new dom.window.Event('change'));
    expect(document.getElementById('ming-reference').disabled).toBe(false);
    expect(document.getElementById('ming-style').disabled).toBe(true);
    expect(document.getElementById('ming-instruction').disabled).toBe(true);
    const languages = Array.from(document.getElementById('ming-language').options).map(option => option.value);
    expect(languages).toEqual(task === 'MULTILINGUAL' ? ['ja', 'ko', 'de', 'fr', 'es'] : task === 'DIALECT' ? ['zh'] : ['en', 'zh']);
    expect(document.getElementById('ming-tag-field').hidden).toBe(task === 'MULTILINGUAL');
    if (task === 'BASIC') document.getElementById('ming-speed').value = '慢速';
    if (task === 'EMOTION') document.getElementById('ming-emotion').value = '高兴';
    if (task === 'DIALECT') document.getElementById('ming-dialect').value = 'cantonese';
    document.getElementById('ming-text').value = 'Synthetic text'; document.getElementById('ming-transcript').value = 'Synthetic transcript';
    document.getElementById('ming-consent').checked = false;
    const before = fetch.mock.calls.filter(([, o]) => o.method === 'POST').length;
    document.getElementById('lab-ming').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    expect(fetch.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(before);
    document.getElementById('ming-consent').checked = true;
    document.getElementById('lab-ming').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    const posted = JSON.parse(fetch.mock.calls.filter(([, o]) => o.method === 'POST').at(-1)[1].body);
    expect(posted).toEqual({ task, text: 'Synthetic text', transcript: 'Synthetic transcript', fileId: asset.id, consent: true,
      language: task === 'MULTILINGUAL' ? 'ja' : task === 'DIALECT' ? 'zh' : 'en',
      controls: { BASIC: { speed: '慢速' }, EMOTION: { emotion: '高兴' }, DIALECT: { dialect: 'cantonese' } }[task] || {}, max_decode_steps: 200 });
  }
  expect(document.getElementById('ming-reference-preview').src).toContain(`/sessions/${session.id}/files/${asset.id}`);
  expect(document.getElementById('ming-reference-metadata').textContent).toContain('2 channel(s), PCM16, 16000 Hz');
  document.getElementById('ming-file').dispatchEvent(new dom.window.Event('change'));
  expect(document.getElementById('ming-consent').checked).toBe(false);
});

test.each(['unsupported', 'failed', 'unavailable'])('reference feature gate stays closed for %s backend', async kind => {
  const fetch = jest.fn(async url => url.endsWith('/capabilities') ? kind === 'failed' ? { ok: false, json: async () => ({ error: 'Ming server credential missing.' }) }
    : response({ available: kind !== 'unavailable', referenceAdapter: kind === 'unsupported' ? 'unsupported' : 'available' }) : response({ sessions: [] }));
  const document = await page(fetch);
  document.querySelector('.lab-capabilities[data-model="ming-tts"]').click(); await settle();
  expect(document.querySelector('option[value="TTS"]').disabled).toBe(true);
  expect(document.querySelector('option[value="VOICE_DESIGN"]').disabled).toBe(false);
  expect(document.getElementById('ming-availability').textContent).toMatch(kind === 'unsupported' ? /Unsupported Gateway/ : kind === 'failed' ? /check failed/ : /currently unavailable/);
});

test('reference upload supplies one file, leaves consent unchecked, and clearing removes drafts and playback sources', async () => {
  let removed = false;
  const fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'DELETE') removed = true;
    return response(url.endsWith('/capabilities') ? { available: true, referenceAdapter: 'available' } : options.method ? {} : { sessions: removed ? [] : [session] });
  });
  const document = await page(fetch);
  document.querySelector('.lab-capabilities[data-model="ming-tts"]').click(); await settle();
  const task = document.getElementById('ming-task'); task.value = 'TTS'; task.dispatchEvent(new dom.window.Event('change'));
  Object.defineProperty(document.getElementById('ming-upload'), 'files', { value: [new dom.window.File(['synthetic'], 'reference.wav', { type: 'audio/wav' })] });
  document.getElementById('ming-upload-button').click(); await settle();
  const call = fetch.mock.calls.find(([url]) => url.endsWith('/references'));
  expect(Array.from(call[1].body.keys())).toEqual(['file']); expect(call[1].headers['Content-Type']).toBeUndefined();
  expect(document.getElementById('ming-consent').checked).toBe(false);
  document.getElementById('ming-text').value = 'Remove text'; document.getElementById('ming-transcript').value = 'Remove transcript';
  document.getElementById('ming-consent').checked = true;
  Array.from(document.querySelectorAll('.lab-session button')).find(button => button.textContent.startsWith('Clear session')).click(); await settle();
  expect(document.getElementById('ming-text').value).toBe(''); expect(document.getElementById('ming-transcript').value).toBe('');
  expect(document.getElementById('ming-consent').checked).toBe(false);
  expect(document.getElementById('ming-reference-preview').hasAttribute('src')).toBe(false);
  expect(document.getElementById('lab-ming').getAttribute('autocomplete')).toBe('off');
});

test('UI blocks empty BASIC controls and typed multilingual tags before posting', async () => {
  const fetch = jest.fn(async url => response(url.endsWith('/capabilities') ? { available: true, referenceAdapter: 'available' } : { sessions: [session] }));
  const document = await page(fetch);
  document.querySelector('.lab-capabilities[data-model="ming-tts"]').click(); await settle();
  for (const [task, text, error] of [['BASIC', 'hello', /at least one/], ['MULTILINGUAL', '[Uhm] hello', /accepts no tags/]]) {
    const select = document.getElementById('ming-task'); select.value = task; select.dispatchEvent(new dom.window.Event('change'));
    document.getElementById('ming-text').value = text; document.getElementById('ming-consent').checked = true;
    document.getElementById('lab-ming').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
    expect(document.getElementById('lab-status').textContent).toMatch(error);
  }
  expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
});

test('pagehide and expired authorization remove browser snapshots, drafts and inspectors', async () => {
  let revoked = false;
  const fetch = jest.fn(async () => revoked ? { ok: false, status: 401, json: async () => ({ error: 'Login required.' }) } : response({ sessions: [session] }));
  const document = await page(fetch);
  document.getElementById('ming-text').value = 'Private draft';
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(document.getElementById('ming-text').value).toBe(''); expect(document.querySelector('.lab-session')).toBeNull();
  document.getElementById('lab-refresh').click(); await settle();
  expect(document.querySelector('.lab-session')).not.toBeNull();
  document.getElementById('ming-transcript').value = 'Private transcript'; revoked = true;
  document.getElementById('lab-refresh').click(); await settle();
  expect(document.getElementById('ming-transcript').value).toBe(''); expect(document.querySelector('.lab-session')).toBeNull();
});
