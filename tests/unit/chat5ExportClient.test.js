const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pug = require('pug');
const { buildExport, parseOptions } = require('../../services/chat5ExportService');
const script = fs.readFileSync(path.join(process.cwd(), 'public/js/chat5_export.js'), 'utf8');
const template = path.join(process.cwd(), 'views/partials/chat5_export.pug');
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
function setup() {
  const html = pug.renderFile(template, { conversation: { _id: '0123456789abcdef01234567' } });
  const dom = new JSDOM(html, { url: 'https://example.test/chat5/chat/0123456789abcdef01234567', runScripts: 'outside-only' });
  const { window } = dom;
  window.URL.createObjectURL = jest.fn(() => 'blob:synthetic');
  window.URL.revokeObjectURL = jest.fn();
  window.HTMLAnchorElement.prototype.click = jest.fn();
  window.fetch = jest.fn();
  window.eval(script);
  return { dom, window, form: window.document.querySelector('form'), status: window.document.querySelector('[role="status"]') };
}
async function submit(window, form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let n = 0; n < 5; n++) await new Promise(resolve => setImmediate(resolve));
}
function result(format) {
  return buildExport({ conversation: { _id: '0123456789abcdef01234567', messages: ['1', '2', '3', '4'], members: ['member'] }, source: 'conversation5',
    documents: [1, 2, 3, 4].map(n => ({ _id: String(n), user_id: n <= 2 ? 'member' : 'bot', contentType: 'text', content: { text: '<img src=x onerror=alert(1)>' } })), options: parseOptions({ format }) });
}
test('browser asset parses, export controls default to both text directions and preserve escaped attributes', () => {
  expect(() => new vm.Script(script)).not.toThrow();
  const { dom, window, form } = setup();
  expect(Array.from(form.querySelectorAll('input:checked')).map(e => e.value)).toEqual(['sent_text', 'received_text']);
  expect(form.querySelectorAll('input[name="type"]')).toHaveLength(10);
  expect(form.querySelector('[name="format"]').value).toBe('json');
  expect(form.querySelector('[name="raw"]').checked).toBe(false);
  const escaped = pug.renderFile(template, { conversation: { _id: '" onmouseover="alert(1)' } });
  expect(escaped).not.toContain(' onmouseover="');
  expect(window.document.querySelector('summary').textContent).toBe('Export conversation');
  dom.window.close();
});
test.each(['json', 'jsonl'])('download %s shows ambiguity counts safely and prepares a reusable source file', async format => {
  const { dom, window, form, status } = setup();
  form.querySelector('[name="format"]').value = format;
  window.fetch.mockResolvedValue({ ok: true, text: async () => result(format).body });
  await submit(window, form);
  expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining(`format=${format}&types=sent_text%2Creceived_text`), expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  expect(status.textContent).toContain('4 source references; 4 selected records');
  expect(status.textContent).toContain('1 ambiguous groups');
  expect(form.querySelector('li').textContent).toContain('positions 0–3 (zero-based), 2 prompts / 2 text responses');
  expect(form.querySelectorAll('img')).toHaveLength(0);
  expect(form.querySelector('a').download).toBe(`chat5-0123456789abcdef01234567-source-v1.${format}`);
  expect(window.HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  await submit(window, form);
  expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  expect(form.querySelector('button').disabled).toBe(false);
  dom.window.close();
});
test('empty selection fails locally; hidden/raw/type controls are serialized explicitly', async () => {
  const { dom, window, form, status } = setup();
  form.querySelectorAll('input').forEach(input => { input.checked = false; });
  await submit(window, form);
  expect(window.fetch).not.toHaveBeenCalled();
  expect(status.textContent).toBe('Choose at least one message type.');
  form.querySelector('[value="reasoning"]').checked = true;
  form.querySelector('[name="hidden"]').checked = true;
  form.querySelector('[name="raw"]').checked = true;
  window.fetch.mockResolvedValue({ ok: true, text: async () => result('json').body });
  await submit(window, form);
  expect(window.fetch.mock.calls[0][0]).toContain('types=reasoning&hidden=1&raw=1');
  dom.window.close();
});
test.each([401, 403, 404, 409, 413, 429, 503])('HTTP %s shows useful failure and allows retry without downloading error content', async code => {
  const { dom, window, form, status } = setup();
  window.fetch.mockResolvedValue({ ok: false, status: code, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Helpful safe error.' }) });
  await submit(window, form);
  expect(status.textContent).toBe('Helpful safe error.');
  expect(status.dataset.error).toBe('true');
  expect(form.querySelector('button').disabled).toBe(false);
  expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  dom.window.close();
});
test('unexpected login HTML cannot be downloaded as source JSON', async () => {
  const { dom, window, form, status } = setup();
  window.fetch.mockResolvedValue({ ok: true, text: async () => '<html>login</html>' });
  await submit(window, form);
  expect(status.dataset.error).toBe('true');
  expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  dom.window.close();
});
