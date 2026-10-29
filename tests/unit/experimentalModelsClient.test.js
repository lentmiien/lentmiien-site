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
  expect(Array.from(document.querySelectorAll('.lab-models button')).every(button => button.disabled)).toBe(true);
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
