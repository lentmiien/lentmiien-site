const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { MODEL_DEFINITIONS, DEFAULT_PROMPT } = require('../../services/ocrModelService');
let dom, window, document;
const malicious = '</script><img src=x onerror="window.injected=true">';
async function setup(model = null, status = 'completed') {
  const { JSDOM } = await import('jsdom');
  const job = model ? { id: 'job1', model, status, createdAt: new Date().toISOString(), options: { task: 'text' }, files: [{ id: 'file1', status: 'completed', originalname: 'sample.png', size: 42, embeddingStatus: model === 'hunyuanocr' ? 'completed' : 'not_applicable', result: { rawText: malicious, rawResponse: { text: malicious, finish_reason: 'length' }, imagePath: '/ocr/jobs/job1/files/file1/preview', overlayBoxes: [], layoutText: 'legacy layout' } }] } : null;
  const html = pug.renderFile(path.join(__dirname, '../../views/ocr_tool.pug'), {
    pageLang: 'en', gtag: false, csrfToken: 'A'.repeat(43), jobs: job ? [job] : [],
    defaults: { prompt: DEFAULT_PROMPT, maxNewTokens: 2048 }, formValues: { prompt: DEFAULT_PROMPT, maxNewTokens: 2048 }, tokenLimit: 8192,
    modelCatalog: { models: { ...MODEL_DEFINITIONS, 'lightonocr-2': { ...MODEL_DEFINITIONS['lightonocr-2'], warning: 'Quarantined on this host.' } } },
    singleJobMode: false, initialJobDetail: job, selectedJobId: job?.id,
  });
  dom = new JSDOM(html, { url: 'https://site.invalid/ocr', runScripts: 'outside-only' });
  window = dom.window; document = window.document;
  window.setTimeout = jest.fn();
  window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [], job }) });
  for (const script of document.querySelectorAll('script')) {
    if (!script.src) window.eval(script.textContent);
    else if (script.getAttribute('src') === '/js/ocr-model-selector.js') window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/ocr-model-selector.js'), 'utf8'));
  }
}
afterEach(() => window?.close());
function change(id, value) {
  const input = document.getElementById(id); input.value = value; input.dispatchEvent(new window.Event('change', { bubbles: true })); return input;
}
function data() { return Object.fromEntries(new window.FormData(document.getElementById('ocrForm'))); }
test('initial selection preserves defaults and switching models omits irrelevant inputs', async () => {
  await setup();
  expect(data()).toMatchObject({ model: 'hunyuanocr', prompt: DEFAULT_PROMPT, max_new_tokens: '2048' });
  change('ocrModel', 'teleocr');
  expect(data()).toMatchObject({ model: 'teleocr', prompt: '', task: 'text', max_new_tokens: '', max_pixels: '' });
  expect(document.getElementById('max_new_tokens').placeholder).toBe('Default: 4096');
  change('task', 'layout');
  expect(document.getElementById('max_pixels').min).toBe('1073296');
  change('prompt', 'Custom TeleOCR prompt');
  change('ocrModel', 'unlimited-ocr');
  expect(data()).toMatchObject({ model: 'unlimited-ocr', image_mode: 'base', max_length: '', no_repeat_ngram_size: '', ngram_window: '' });
  expect(data()).not.toHaveProperty('task');
  expect(data()).not.toHaveProperty('max_new_tokens');
  change('ocrModel', 'lightonocr-2');
  expect(document.getElementById('ocrModelWarning').hidden).toBe(false);
  expect(document.getElementById('ocrModelWarning').textContent).toContain('Quarantined');
  change('ocrModel', 'hunyuanocr');
  expect(data()).toMatchObject({ model: 'hunyuanocr', prompt: DEFAULT_PROMPT, max_new_tokens: '2048' });
  change('ocrModel', 'teleocr');
  expect(data()).toMatchObject({ prompt: 'Custom TeleOCR prompt', task: 'layout' });
});
test('alternative text and JSON are inert and omit Hunyuan-only tools', async () => {
  await setup('teleocr');
  expect(document.getElementById('raw-file1').textContent).toBe(malicious);
  expect(document.getElementById('response-file1').textContent).toContain(malicious.replaceAll('"', '\\"'));
  expect(document.querySelector('#ocrJobDetails [onerror]')).toBeNull();
  expect(document.querySelector('[data-save-file]')).toBeNull();
  expect(document.querySelector('[data-send-job]')).toBeNull();
  expect(document.querySelector('[data-embed-hq]')).toBeNull();
  expect(document.getElementById('ocrJobDetails').textContent).toContain('may be truncated');
  expect(window.injected).toBeUndefined();
});
test('Hunyuan jobs keep editing, embedding and receipt controls', async () => {
  await setup('hunyuanocr');
  expect(document.querySelector('[data-save-file]')).not.toBeNull();
  expect(document.querySelector('[data-send-job]')).not.toBeNull();
  expect(document.querySelector('[data-embed-hq]')).not.toBeNull();
});
test('submits selected settings and header CSRF before multipart parsing', async () => {
  await setup();
  change('ocrModel', 'unlimited-ocr');
  document.getElementById('ocrForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await Promise.resolve();
  const [url, request] = window.fetch.mock.calls[0];
  expect(url).toBe('https://site.invalid/ocr/jobs');
  expect(request.headers['X-CSRF-Token']).toBe('A'.repeat(43));
  expect(request.body.get('model')).toBe('unlimited-ocr');
  expect(request.body.has('max_new_tokens')).toBe(false);
});

test('polling loads the final response when a queued alternative job completes', async () => {
  await setup('teleocr', 'queued');
  const completed = { ...window.__OCR_SINGLE_JOB_DETAIL__, status: 'completed', updatedAt: new Date().toISOString() };
  window.fetch.mockImplementation(async url => ({ ok: true, json: async () => url.includes('?') ? { jobs: [completed] } : { job: completed } }));
  await window.setTimeout.mock.calls[0][0]();
  await new Promise(setImmediate);
  expect(window.fetch).toHaveBeenCalledWith('/ocr/jobs/job1', expect.any(Object));
  expect(document.getElementById('jobStatusLabel').textContent).toContain('COMPLETED');
});
