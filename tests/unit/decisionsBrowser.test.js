const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(path.join(__dirname, '../../public/js/decisions.js'), 'utf8');
const html = pug.renderFile(path.join(__dirname, '../../views/admin_decisions.pug'), { csrfToken: 'token', storageScope: 'owner', gtag: false });
let dom; let window; let fetchMock;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function mount(saved) {
  dom = new JSDOM(html, { url: 'https://site.test/admin/decisions', runScripts: 'outside-only' });
  window = dom.window;
  if (saved) window.sessionStorage.setItem('decisions:v1:owner', saved);
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ id: 'liquid-d1-2b-q8', provider: 'local' }, { id: 'gpt-6-luna', provider: 'openai', configured: false }] }) });
  window.fetch = fetchMock;
  window.eval(script);
  await tick();
}
afterEach(() => dom?.window.close());
const $ = id => window.document.getElementById(id);
function change(node, value) {
  node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function instructions() {
  for (const control of window.document.querySelectorAll('.question textarea')) change(control, 'Assess this evidence.');
}
test('builds mixed questions with typed boolean choices and ordered levels', async () => {
  await mount();
  change($('decision-input'), 'Synthetic evidence');
  $('add-predicate').click(); $('add-choice').click(); $('add-score').click();
  const choice = window.document.querySelectorAll('.question')[1];
  change(choice.querySelector('select'), 'boolean');
  const updated = window.document.querySelectorAll('.question')[1];
  change(updated.querySelectorAll('.option-row')[1].querySelector('input'), 'true');
  instructions();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ model: 'liquid-d1-2b-q8', answers: [{ type: 'predicate', probability: 0.9 }, { type: 'choice', choice: true }, { type: 'score', score: 0.8 }], usage: { input_tokens: 5 } }) });
  $('decision-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  const [url, options] = fetchMock.mock.calls[1];
  expect(url).toBe('/admin/decisions'); expect(options.headers['X-CSRF-Token']).toBe('token');
  const body = JSON.parse(options.body);
  expect(body.questions.map(q => q.type)).toEqual(['predicate', 'choice', 'score']);
  expect(body.questions[1].choices.map(c => c.value)).toEqual([true, 'true']);
  expect(body.questions[2].levels.map(c => c.label)).toEqual(['low', 'high']);
  expect($('decision-results').hidden).toBe(false); expect($('answer-summary').textContent).toContain('zero-based weighted mean');
  expect($('decision-raw').textContent).toContain('input_tokens');
});
test('restores only the tab session, renders refusal safely, clears and starts blank in a fresh session', async () => {
  await mount(JSON.stringify({ model: 'liquid-d1-2b-q8', input: 'saved evidence', questions: [{ type: 'predicate', instructions: 'Assess' }], result: { model: 'liquid-d1-2b-q8', answers: [{ type: 'refusal', refusal: '<img src=x onerror=alert(1)>' }] } }));
  expect($('decision-input').value).toBe('saved evidence');
  expect($('answer-summary').textContent).toContain('<img src=x');
  expect($('answer-summary').querySelector('img')).toBeNull();
  expect(window.localStorage.length).toBe(0);
  $('clear-session').click();
  expect(window.sessionStorage.getItem('decisions:v1:owner')).toBeNull();
  expect($('decision-input').value).toBe(''); expect($('decision-results').hidden).toBe(true);
  dom.window.close(); await mount();
  expect($('decision-input').value).toBe(''); expect($('decision-results').hidden).toBe(true);
});
test('marks unconfigured cloud models unavailable and handles catalog failures', async () => {
  await mount();
  expect($('decision-model').options[1].disabled).toBe(true);
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: 'Catalog unavailable' }) });
  $('refresh-models').click(); await tick();
  expect($('catalog-status').textContent).toContain('Catalog unavailable'); expect($('run-decision').disabled).toBe(true);
});
test('can cancel pending inference and restore editable controls', async () => {
  await mount(); change($('decision-input'), 'Synthetic'); $('add-predicate').click(); instructions();
  fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new window.DOMException('Aborted', 'AbortError')))));
  $('decision-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  expect($('decision-fields').disabled).toBe(true); expect($('cancel-decision').hidden).toBe(false);
  $('cancel-decision').click(); await tick();
  expect($('decision-status').textContent).toContain('Request cancelled'); expect($('decision-fields').disabled).toBe(false);
});
