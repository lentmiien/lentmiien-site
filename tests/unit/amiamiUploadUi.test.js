const fs = require('fs');
const path = require('path');
const pug = require('pug');
let dom, doc;
const reply = (job, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => ok ? { job } : { error: job } });
const progress = { active: true, state: 'queued', jobId: 'synthetic', totalCodes: 3, queuedCount: 2,
  fetched: 1, failed: 0, skippedExisting: 1, failures: [], delaySeconds: 60,
  startedAt: '2026-09-24T00:00:00Z', nextFetchAt: '2026-09-24T00:01:00Z' };
async function open(job) {
  const { JSDOM } = await import('jsdom');
  dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_amiami_upload.pug'), { csrfToken: 'synthetic-token' }), {
    url: 'http://localhost/admin/amiami-items/upload', runScripts: 'outside-only',
  });
  doc = dom.window.document;
  dom.window.setTimeout = jest.fn();
  dom.window.fetch = jest.fn().mockResolvedValue(reply(job));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/amiami-upload.js'), 'utf8'));
  await new Promise(setImmediate);
}
afterEach(() => dom?.window.close());

test('empty state exposes paste/file form and submits with CSRF header; accepted active job hides form', async () => {
  await open(null);
  expect(doc.querySelector('#upload-panel').hidden).toBe(false);
  doc.querySelector('#html-input').value = '<div><a href="/eng/detail?gcode=TOY-RBT-9417">figure</a></div>';
  dom.window.fetch.mockResolvedValueOnce(reply(progress));
  doc.querySelector('#upload-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await new Promise(setImmediate);
  const [url, options] = dom.window.fetch.mock.calls[1];
  expect(url).toBe('/admin/amiami-items/upload');
  expect(options.headers['X-CSRF-Token']).toBe('synthetic-token');
  expect(options.body.get('html')).toContain('TOY-RBT-9417');
  expect(doc.querySelector('#upload-panel').hidden).toBe(true);
  expect(doc.querySelector('#job-summary').textContent).toBe('2 of 3 item codes processed');
  expect(doc.querySelector('#html-input').value).toBe('');
});

test('reopening shows current job; terminal status restores upload form and escapes error strings', async () => {
  await open(progress);
  expect(doc.querySelector('#upload-panel').hidden).toBe(true);
  expect(doc.querySelector('#job-panel').hidden).toBe(false);
  const attack = '<img src=x onerror="window.compromised=true">';
  dom.window.fetch.mockResolvedValueOnce(reply({ ...progress, active: false, state: 'completed', failed: 1,
    message: attack, failures: [{ itemCode: 'FIGURE-1', message: attack }], finishedAt: '2026-09-24T00:02:00Z' }));
  doc.querySelector('#refresh-status').click(); await new Promise(setImmediate);
  expect(doc.querySelector('#upload-panel').hidden).toBe(false);
  expect(doc.querySelector('#job-message').textContent).toBe(attack);
  expect(doc.querySelectorAll('img')).toHaveLength(0);
  expect(dom.window.compromised).toBeUndefined();
  expect(doc.querySelector('#job-state').textContent).toBe('Completed with errors');
});

test('status failure closes the form and retains a readable error', async () => {
  await open(null);
  dom.window.fetch.mockResolvedValueOnce(reply('Please sign in again.', false));
  doc.querySelector('#refresh-status').click(); await new Promise(setImmediate);
  expect(doc.querySelector('#upload-panel').hidden).toBe(true);
  expect(doc.querySelector('#upload-status').textContent).toContain('sign in');
});

test('oversized paste is rejected before any upload', async () => {
  await open(null);
  doc.querySelector('#html-input').value = 'x'.repeat(2 * 1024 * 1024 + 1);
  doc.querySelector('#upload-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await new Promise(setImmediate);
  expect(dom.window.fetch).toHaveBeenCalledTimes(1);
  expect(doc.querySelector('#upload-status').textContent).toContain('2 MiB');
});
