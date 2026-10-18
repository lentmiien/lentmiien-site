const fs = require('fs');
const pug = require('pug');
const { parseSubmission } = require('../../services/localAi/policy');
const policies = require('../fixtures/local-ai/workflows-8105a1b.json');
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
const flush = () => new Promise(resolve => setImmediate(resolve));
const id = '0123456789abcdef01234567';
const models = ['smollm2:360m', 'qwen3:0.6b', 'cydonia:24b-q6'].map(api_model => ({ api_model, model_name: api_model, provider: 'Local' }));
const metadata = { model: models[0].api_model, contextPrompt: '', maxMessages: 25, tools: [], reasoning: 'none', mode: 'standard', verbosity: 'medium', outputFormat: 'text' };
const base = { loggedIn: true, permissions: ['chat5'], htmlPaths: [], bookmarks: [] };
let dom, requests, reply, immediateRequests;
async function render(page, locals, enabled = true, mediaEnabled = false) {
  dom = new JSDOM(pug.renderFile(page, { ...base, ...locals }), { url: 'https://site.test/chat5/chat/' + id, runScripts: 'outside-only' });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  requests = []; immediateRequests = [];
  reply = async () => ({ ok: true, status: 202, json: async () => ({ id: 'job', url: '/local-ai/queue/job' }) });
  dom.window.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/local-ai/api/v1/config') return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ enabled, mediaEnabled, ownerId: 'synthetic-owner', csrfToken: 'test-csrf' }) };
    if (url === '/image_gen/api/generate') { immediateRequests.push(JSON.parse(options.body)); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'completed' }) }; }
    if (url === '/local-ai/api/v1/jobs') { requests.push(options); return reply(); }
    if (url === '/local-ai/api/v1/workflows') return { ok: true, json: async () => ({ workflows: policies }) };
    if (url.startsWith('/local-ai/api/v1/workflows/')) return { ok: true, json: async () => policies.find(p => url.includes('/' + p.workflow_id + '/')) };
    if (url === '/local-ai/api/v1/inputs') return { ok: true, json: async () => ({ inputs: [1, 2, 3].map(n => ({ artifact_id: 'in_' + String(n).repeat(32), sha256: 'b'.repeat(64), width: 16, height: 16, bytes: 100 })) }) };
    if (url === '/image_gen/api/workflows') return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ workflows: policies.map(p => ({ key: p.workflow_id, name: p.workflow_id })) }) };
    if (url.startsWith('/image_gen/api/workflows/')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ workflow: structuredClone(policies.find(p => url.endsWith(p.workflow_id)).graph) }) };
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
  window.toastui = { Editor: class { on() {} getMarkdown() { return this.prompt ?? 'synthetic prompt'; } reset() { this.prompt = ''; } } };
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
  const window = await render('views/image_gen/index.pug', {}, enabled, true);
  script('local-ai-client.js'); script('local-ai-integrations.js'); script('local-ai-workflows.js'); script('image_gen.js');
  window.dispatchEvent(new window.Event('load')); await flush(); await flush();
  return { window, button: window.document.getElementById('btnLocalAiImageBatch'), select: window.document.getElementById('wfSelect') };
}
test('all twenty real rendered workflows submit typed requests with ordered private reference slots', async () => {
  const { window, button, select } = await imagePage();
  for (const policy of policies) {
    select.value = policy.workflow_id; select.dispatchEvent(new window.Event('change')); await flush();
    const ids = Object.keys(policy.bindings);
    if (ids.length) {
      expect(button.disabled).toBe(true);
      for (let i = 0; i < ids.length; i++) {
        const inputs = window.document.getElementById('batchPrivateInput'); inputs.selectedIndex = i;
        window.document.getElementById('btnSelectPrivateInput').click();
        window.document.querySelectorAll('#batchReferenceSlots button')[i].click();
      }
    }
    expect(button.disabled).toBe(false); button.click(); await flush();
    const body = JSON.parse(requests.at(-1).body);
    expect(() => parseSubmission(body)).not.toThrow(); expect(body.type).toBe('comfy.workflow');
    expect(body.request.template_sha256).toBe(policy.template_sha256);
    expect(Object.keys(body.request.bindings)).toEqual(ids);
    for (let i = 0; i < ids.length; i++) expect(body.request.bindings[ids[i]].artifact_id).toBe('in_' + String(i + 1).repeat(32));
  }
  expect(requests).toHaveLength(20);
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
  select.value = 'image_qwen_image_2_1_t2i'; select.dispatchEvent(new window.Event('change')); await flush();
  let resolve; reply = () => new Promise(r => { resolve = r; });
  button.click(); await flush();
  expect(button.disabled).toBe(true); expect(requests).toHaveLength(1);
  const body = requests[0].body;
  select.value = 'image_qwen_image_2_1_image_edit'; select.dispatchEvent(new window.Event('change')); await flush();
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

test('rendered controls preserve immediate/batch parity, boolean branches, random controls and negative seed sentinels', async () => {
  const { window, button, select } = await imagePage();
  const p = policies.find(p => p.workflow_id === 'image_krea2_turbo_t2i');
  window.localStorage.setItem(`imageGenWorkflowUi:${p.workflow_id}`, JSON.stringify({ fields: [
    { key: '30:19::value', value: 'Exact edited prompt', controlType: 'prompt' },
    { key: '30:23::value', value: true, controlType: 'boolean' },
    { key: '30:3::seed', value: -1, controlType: 'number' },
    { key: '30:16::sampling_mode.seed', value: 0, controlType: 'random-integer' },
  ] }));
  select.value = p.workflow_id; select.dispatchEvent(new window.Event('change')); await flush();
  expect(window.document.getElementById('workflowJson').tagName).toBe('TEXTAREA');
  expect(window.document.getElementById('promptText').tagName).toBe('TEXTAREA');
  window.crypto.getRandomValues = values => { values.fill(12345); return values; };
  window.document.getElementById('btnGenerate').click(); await flush();
  button.click(); await flush();
  const body = JSON.parse(requests.at(-1).body);
  const mapped = require('../../public/js/local-ai-workflows').map(p, immediateRequests[0].prompt, {});
  expect(body.request).toEqual(mapped);
  expect(body.request.overrides['30:3/seed']).toBe(12345);
  expect(body.request.overrides['30:16/sampling_mode.seed']).toBe(12345);
  expect(body.request.overrides['30:23/value']).toBe(true);
  expect(body.request.overrides['30:19/value']).toBe('Exact edited prompt');
});
test('a later oversized immediate overwrite cannot reuse an older private receipt for that filename', async () => {
  const { window, button, select } = await imagePage();
  Object.defineProperty(window.crypto, 'subtle', { value: require('crypto').webcrypto.subtle });
  select.value = 'image_qwen_image_2_1_image_edit'; select.dispatchEvent(new window.Event('change')); await flush();
  const originalFetch = window.fetch.getMockImplementation();
  let eligible = true;
  window.fetch.mockImplementation(async (url, options) => {
    if (url === '/image_gen/api/files/input' && options?.method === 'POST') return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ file: { filename: 'reference.png', path: 'reference.png', subfolder: '' }, batch_input: eligible ? { eligible: true, artifact_id: 'in_' + 'a'.repeat(32), sha256: 'b'.repeat(64) } : { eligible: false, reason: 'batch_input_limit_32_mib' } }) };
    return originalFetch(url, options);
  });
  const file = new window.File(['synthetic'], 'reference.png'); file.arrayBuffer = async () => new Uint8Array([1, 2, 3]).buffer;
  const input = window.document.getElementById('inputFile'); Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  const form = window.document.getElementById('inputUploadForm');
  form.dispatchEvent(new window.Event('submit', { cancelable: true })); expect(button.disabled).toBe(true);
  for (let i = 0; i < 20 && !window.document.getElementById('inputUploadStatus').textContent.includes('ready'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  window.document.getElementById('inputTargetField').value = '11::image'; window.document.getElementById('btnUseInput').click(); await flush();
  expect(button.disabled).toBe(false);
  eligible = false; Object.defineProperty(file, 'size', { value: 40 * 1024 ** 2 });
  form.dispatchEvent(new window.Event('submit', { cancelable: true })); expect(button.disabled).toBe(true);
  button.dispatchEvent(new window.Event('click')); await flush(); expect(requests).toHaveLength(0);
  for (let i = 0; i < 20 && !window.document.getElementById('inputUploadStatus').textContent.includes('batch_input_limit_32_mib'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  window.document.getElementById('inputTargetField').value = '11::image'; window.document.getElementById('btnUseInput').click(); await flush();
  expect(window.document.getElementById('inputUploadStatus').textContent).toContain('batch_input_limit_32_mib');
  expect(button.disabled).toBe(true); expect(requests).toHaveLength(0);
});


test.each(['hello', '', '   '])('split send action includes only a non-empty prompt: %p', async prompt => {
  const { window } = await chat();
  window.editor.prompt = prompt;
  window.socket.emit = jest.fn();
  window.document.getElementById('sendAndResponse').click();
  expect(window.socket.emit).toHaveBeenCalledWith('chat5-append', expect.objectContaining({
    prompt: prompt.trim() ? prompt : null, response: true,
  }));
});

test('send menu orders append, batch, bot and TTS, and keeps append roles', async () => {
  const { window } = await chat();
  const document = window.document;
  expect(Array.from(document.querySelectorAll('.chat5-send-controls .dropdown-item'), el => el.textContent))
    .toEqual(['Append', 'Batch', 'Append as bot', 'Generate TTS audio']);
  window.socket.emit = jest.fn();
  document.getElementById('chat5Append').click();
  expect(window.socket.emit).toHaveBeenLastCalledWith('chat5-append', expect.objectContaining({ prompt: 'synthetic prompt', response: false }));
  window.editor.prompt = 'bot draft';
  document.getElementById('chat5AppendBot').click();
  expect(window.socket.emit).toHaveBeenLastCalledWith('chat5-append', expect.objectContaining({ prompt: 'bot draft', response: false, user_id: 'bot' }));
});

test.each(['hello', '', '   '])('unified batch routes OpenAI with optional prompt %p even when local batching is disabled', async prompt => {
  const { window, button } = await chat({ enabled: false });
  window.chatModels = [{ ...models[0], provider: 'OpenAI', batch_use: true }];
  window.document.getElementById('model').dispatchEvent(new window.Event('change'));
  window.editor.prompt = prompt;
  window.socket.emit = jest.fn();
  expect(button.disabled).toBe(false);
  button.click(); await flush();
  expect(requests).toHaveLength(0);
  expect(window.socket.emit).toHaveBeenCalledWith('chat5-batch', expect.objectContaining({
    prompt: prompt.trim() ? prompt : null, includePrompt: Boolean(prompt.trim()),
  }));
});

test.each(['', '   '])('local batch treats whitespace as response-only: %p', async prompt => {
  const { window, button } = await chat();
  window.editor.prompt = prompt;
  window.socket.emit = jest.fn();
  button.click(); await flush();
  expect(JSON.parse(requests[0].body).prompt).toBe('');
  expect(window.socket.emit).not.toHaveBeenCalledWith('chat5-batch', expect.anything());
  expect(window.editor.getMarkdown()).toBe('');
});

test('local batch keeps changed drafts and failed submissions in the editor', async () => {
  const { window, button } = await chat();
  let resolve;
  reply = () => new Promise(r => { resolve = r; });
  button.click(); await flush();
  window.editor.prompt = 'next draft';
  resolve({ ok: true, status: 202, json: async () => ({ url: '/local-ai/queue/job' }) }); await flush();
  expect(window.editor.getMarkdown()).toBe('next draft');
  reply = async () => { throw new Error('network unavailable'); };
  button.click(); await flush();
  expect(window.editor.getMarkdown()).toBe('next draft');
});

test.each([{ provider: 'OpenAI', batch_use: false }, { provider: 'OpenAI' }, { provider: 'Other' }])('unsupported batch model never queues: %p', async model => {
  const { window, button } = await chat();
  window.chatModels = [{ ...models[0], ...model }];
  window.socket.emit = jest.fn();
  button.dispatchEvent(new window.Event('click')); await flush();
  expect(requests).toHaveLength(0);
  expect(window.socket.emit).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
});


test('TTS remains available from the send menu', async () => {
  const { window } = await chat();
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.socket.emit = jest.fn();
  window.document.getElementById('generateTtsBtn').click();
  expect(window.socket.emit).toHaveBeenCalledWith('chat5-tts', expect.objectContaining({ prompt: 'synthetic prompt' }), expect.any(Function));
});
