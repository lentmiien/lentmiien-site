const fs = require('fs');
const pug = require('pug');
const { parseSubmission } = require('../../services/localAi/policy');
const qwen = require('../fixtures/local-ai/qwen.json');
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
const flush = () => new Promise(resolve => setImmediate(resolve));
const id = '0123456789abcdef01234567';
const models = ['smollm2:360m', 'qwen3:0.6b', 'cydonia:24b-q6'].map(api_model => ({ api_model, model_name: api_model, provider: 'Local' }));
const metadata = { model: models[0].api_model, contextPrompt: '', maxMessages: 25, tools: [], reasoning: 'none', mode: 'standard', verbosity: 'medium', outputFormat: 'text' };
const base = { loggedIn: true, permissions: ['chat5'], htmlPaths: [], bookmarks: [] };
let dom, requests, reply;
async function render(page, locals, enabled = true, mediaEnabled = false) {
  dom = new JSDOM(pug.renderFile(page, { ...base, ...locals }), { url: 'https://site.test/chat5/chat/' + id, runScripts: 'outside-only' });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  requests = [];
  reply = async () => ({ ok: true, status: 202, json: async () => ({ id: 'job', url: '/local-ai/queue/job' }) });
  dom.window.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/local-ai/api/v1/config') return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ enabled, mediaEnabled, ownerId: 'synthetic-owner', csrfToken: 'test-csrf' }) };
    if (url === '/local-ai/api/v1/jobs') { requests.push(options); return reply(); }
    if (url === '/image_gen/api/workflows') return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ workflows: [{ key: 'qwen', name: 'Qwen' }, { key: 'uncensored', name: 'Qwen uncensored' }, { key: 'edit', name: 'Unsupported edit' }] }) };
    if (url.startsWith('/image_gen/api/workflows/')) {
      const graph = structuredClone(qwen);
      if (url.endsWith('uncensored')) graph['1'].inputs.unet_name = 'qwen-image-2.1-UC-int8_convrot.safetensors';
      if (url.endsWith('edit')) graph['9'] = { class_type: 'LoadImage', inputs: { image: 'test.png' } };
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ workflow: graph }) };
    }
    if (url === '/image_gen/api/health' || url.startsWith('/image_gen/api/files/input')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, files: [] }) };
    throw new Error('Unexpected fixture request: ' + url);
  });
  return dom.window;
}
function script(name) { dom.window.eval(fs.readFileSync('public/js/' + name, 'utf8')); }
async function chat({ conversationId = id, source = 'conversation5', settings = {}, enabled = true, mediaEnabled = false } = {}) {
  const window = await render('views/chat5_chat.pug', {
    conversation: { _id: conversationId, title: 'Synthetic conversation', summary: '', category: 'test', tags: [], members: ['test'], messages: [], metadata: { ...metadata, ...settings } },
    conversationSource: source, messages: [], chat_models: models, templates: [], personalities: [], responseTypes: [], ttsVoices: {},
  }, enabled, mediaEnabled);
  window.chatModels = models;
  window.io = () => ({ on: () => {}, emit: () => {} });
  window.toastui = { Editor: class { on() {} getMarkdown() { return 'synthetic prompt'; } } };
  window.bootstrap = { Modal: class {} };
  script('chat5_5.js'); // Real collectChatSettings and rendered select controls.
  script('local-ai-client.js'); script('local-ai-integrations.js');
  window.dispatchEvent(new window.Event('load')); await flush();
  return { window, button: window.document.getElementById('localAiChatBatch'), status: window.document.getElementById('localAiBatchStatus') };
}
afterEach(() => dom?.window.close());
test.each(models.map(m => m.api_model))('real Chat5 paragraph + click + serialized fetch includes trimmed ID for %s', async model => {
  const { window, button, status } = await chat({ conversationId: `  ${id}  `, settings: { model } });
  expect(window.document.getElementById('id').tagName).toBe('P');
  expect(window.document.getElementById('id').value).toBeUndefined();
  expect(button.disabled).toBe(false); button.click(); await flush();
  expect(requests).toHaveLength(1);
  const body = JSON.parse(requests[0].body);
  expect(body).toMatchObject({ type: 'chat5.response', conversation_id: id, prompt: 'synthetic prompt', settings: { model, outputFormat: 'text' } });
  expect(() => parseSubmission(body)).not.toThrow();
  expect(requests[0].headers['X-CSRF-Token']).toBe('test-csrf');
  expect(requests[0].headers['Idempotency-Key']).toBeTruthy();
  expect(status.textContent).toContain('Durably queued');
});
test.each(['NEW', '', 'invalid-id', 'a'.repeat(25)])('unsaved/malformed conversation %p never submits, including dispatched click', async conversationId => {
  const { window, button } = await chat({ conversationId });
  expect(button.disabled).toBe(true);
  button.dispatchEvent(new window.Event('click')); await flush();
  expect(requests).toHaveLength(0); expect(button.disabled).toBe(true);
});
test.each([
  { source: 'template' }, { enabled: false }, { settings: { reasoning: 'high' } },
  { settings: { mode: 'background' } }, { settings: { verbosity: 'high' } }, { settings: { outputFormat: 'json' } },
])('unsupported settings/source and disabled config remain ineligible: %p', async options => {
  const { window, button } = await chat(options);
  expect(button.disabled).toBe(true); button.dispatchEvent(new window.Event('click')); await flush();
  expect(requests).toHaveLength(0); expect(button.disabled).toBe(true);
});
test('rechecks ID and attachments at click time and keeps pending submissions disabled through setting changes', async () => {
  const { window, button } = await chat();
  window.document.getElementById('id').textContent = 'NEW';
  button.click(); await flush(); expect(requests).toHaveLength(0);
  window.document.getElementById('id').textContent = id;
  const files = window.document.getElementById('fileInput');
  Object.defineProperty(files, 'files', { configurable: true, value: [new window.File(['synthetic'], 'image.png')] });
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  Object.defineProperty(files, 'files', { value: [] }); files.dispatchEvent(new window.Event('change'));
  let resolve; reply = () => new Promise(r => { resolve = r; });
  button.click(); await flush(); expect(button.disabled).toBe(true);
  const verbosity = window.document.getElementById('verbosity'); verbosity.value = 'high'; verbosity.dispatchEvent(new window.Event('change'));
  expect(button.disabled).toBe(true); button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(1);
  resolve({ ok: true, status: 202, json: async () => ({ url: '/local-ai/queue/job' }) }); await flush();
  expect(button.disabled).toBe(true);
});
async function imagePage(enabled = true) {
  const window = await render('views/image_gen/index.pug', {}, enabled);
  script('local-ai-client.js'); script('local-ai-integrations.js'); script('image_gen.js');
  window.dispatchEvent(new window.Event('load')); await flush(); await flush();
  return { window, button: window.document.getElementById('btnLocalAiImageBatch'), select: window.document.getElementById('wfSelect') };
}
test('rendered image page submits both Qwen graphs and rejects edit/upload graphs', async () => {
  const { window, button, select } = await imagePage();
  for (const key of ['qwen', 'uncensored']) {
    select.value = key; select.dispatchEvent(new window.Event('change')); await flush();
    expect(button.disabled).toBe(false); button.click(); await flush();
    expect(() => parseSubmission(JSON.parse(requests.at(-1).body))).not.toThrow();
    expect(JSON.parse(requests.at(-1).body).type).toBe('comfy.image');
  }
  expect(requests).toHaveLength(2);
  select.value = 'edit'; select.dispatchEvent(new window.Event('change')); await flush();
  expect(button.disabled).toBe(true); button.dispatchEvent(new window.Event('click')); await flush();
  expect(requests).toHaveLength(2); expect(button.disabled).toBe(true);
});
test('image batching stays disabled with flag OFF, including synthetic clicks', async () => {
  const { window, button } = await imagePage(false);
  expect(button.disabled).toBe(true); button.dispatchEvent(new window.Event('click')); await flush();
  expect(requests).toHaveLength(0); expect(button.disabled).toBe(true);
});
test('Chat5 rejects non-Local models, selected tools and a removed ID element at click time', async () => {
  const { window, button } = await chat();
  window.chatModels = [{ ...models[0], provider: 'OpenAI' }];
  button.click(); await flush(); expect(requests).toHaveLength(0);
  window.chatModels = models;
  const tool = window.document.createElement('option'); tool.value = 'test-tool'; tool.selected = true;
  window.document.getElementById('tools').append(tool);
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  tool.remove(); window.document.getElementById('id').remove();
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  expect(button.disabled).toBe(true);
});
test('image request remains frozen and disabled through workflow changes until its response', async () => {
  const { window, button, select } = await imagePage();
  let resolve; reply = () => new Promise(r => { resolve = r; });
  button.click(); await flush();
  expect(button.disabled).toBe(true); expect(requests).toHaveLength(1);
  const body = requests[0].body;
  select.value = 'edit'; select.dispatchEvent(new window.Event('change')); await flush();
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(1);
  resolve({ ok: true, status: 202, json: async () => ({ url: '/local-ai/queue/job' }) }); await flush();
  expect(button.disabled).toBe(true); expect(requests[0].body).toBe(body);
  expect(() => parseSubmission(JSON.parse(body))).not.toThrow();
});


test('real rendered upload handler blocks batch through FileReader and server ack, then sends refs via trusted history', async () => {
  const { window, button, status } = await chat({ mediaEnabled: true });
  Object.defineProperty(window.crypto, 'subtle', { value: require('crypto').webcrypto.subtle });
  const input = window.document.getElementById('fileInput');
  let selected = [new window.File(['synthetic image bytes'], 'image.png')];
  Object.defineProperty(input, 'files', { configurable: true, get: () => selected });
  Object.defineProperty(input, 'value', { configurable: true, set: value => { if (value === '') selected = []; } });
  let acknowledge;
  window.socket.emit = jest.fn((event, payload, ack) => {
    if (event === 'chat5-uploadImage') { expect(payload.csrfToken).toBe('test-csrf'); expect(payload.uploadKey).toBeTruthy(); acknowledge = ack; }
  });
  input.dispatchEvent(new window.Event('change'));
  expect(button.disabled).toBe(true); button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  for (let i = 0; i < 30 && !acknowledge; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(acknowledge).toBeDefined(); expect(status.textContent).toContain('acknowledged');
  expect(Object.keys(window.sessionStorage).some(k => k.startsWith('chat5-upload-pending:'))).toBe(true);
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  acknowledge({ ok: true, artifact: { artifact_id: 'in_' + 'a'.repeat(32) } }); await flush();
  expect(button.disabled).toBe(false); button.click(); await flush(); expect(requests).toHaveLength(1);
  expect(Object.keys(window.sessionStorage).some(k => k.startsWith('chat5-upload-pending:'))).toBe(false);
  expect(JSON.stringify(window.sessionStorage)).not.toContain('synthetic image bytes');
  window.sessionStorage.setItem('chat5-upload-pending:uncertain', id);
  window.chat5UploadBarrier.failed = true;
  window.dispatchEvent(new window.Event('chat5-upload-state'));
  expect(button.disabled).toBe(true);
});
