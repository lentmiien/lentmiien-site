const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync('public/js/local-ai-client.js', 'utf8');
function client({ fail = false, enabled = true, ownerId = 'owner', store = new Map() } = {}) {
  const requests = []; let attempt = 0;
  const scope = { window: {}, crypto: { randomUUID: () => 'stable-key' }, sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    fetch: async (url, options) => {
      if (url.endsWith('/config')) return { ok: true, json: async () => ({ enabled, ownerId, csrfToken: 'csrf' }) };
      requests.push({ url, ...options }); attempt += 1;
      if (fail && attempt === 1) return { ok: false, status: 503, json: async () => ({ error: { code: 'uncertain' } }) };
      return { ok: true, status: 202, json: async () => ({ id: 'job', url: '/local-ai/queue/job' }) };
    } };
  vm.runInNewContext(code, scope);
  return { api: scope.window.localAiBatch, requests, store };
}
test('browser retries identical serialized request and key after lost response or reload', async () => {
  const first = client({ fail: true }); const body = { type: 'comfy.image', request: { prompt: { seed: 123 } } };
  await expect(first.api.submit(body)).rejects.toThrow('uncertain');
  await expect(first.api.submit({ ...body, changed: true })).rejects.toThrow('prior submission');
  const restarted = client({ enabled: false, store: first.store });
  await restarted.api.retryPending();
  expect(restarted.requests[0].body).toBe(first.requests[0].body);
  expect(restarted.requests[0].headers['Idempotency-Key']).toBe('stable-key');
  expect(first.store.size).toBe(0);
});
test('a different account cannot accidentally export another account’s pending prompt', async () => {
  const first = client({ fail: true }); await expect(first.api.submit({ prompt: 'private' })).rejects.toThrow();
  const other = client({ ownerId: 'other', store: first.store }); await expect(other.api.retryPending()).rejects.toThrow('original account');
  expect(other.requests).toHaveLength(0);
});
test('disabled acceptance does not retain an unsubmitted draft as an uncertain job', async () => {
  const c = client({ enabled: false }); await expect(c.api.submit({ prompt: 'draft' })).rejects.toThrow('disabled'); expect(c.store.size).toBe(0);
});
