const express = require('express');
const accountSurfaceBody = require('../../middleware/accountSurfaceBody');
let server; let base;
beforeAll(async () => {
  const app = express(); app.use(accountSurfaceBody); app.use(express.json({ limit: '1mb' }));
  app.post('/mypage/api/settings', (_req, res) => res.json({ ok: true }));
  app.use(['/accounting/close-month', '/budget/close-month'], (_req, res) => res.status(403).send('Denied by parent authorization'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
});
test.each(['/accounting/close-month', '/BUDGET/CLOSE-MONTH/'])('closing parent denials are uncached for GET and POST at %s', async route => {
  for (const method of ['GET', 'POST']) {
    const response = await fetch(`${base}${route}`, { method });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.each(['/mypage/api/settings', '/MYPAGE/api/settings'])('narrow parser rejects oversized JSON before the larger legacy parser at %s', async route => {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(50000) }) });
  expect(response.status).toBe(413); expect(await response.json()).toMatchObject({ ok: false });
  expect(response.headers.get('cache-control')).toContain('private, no-store');
});
test('malformed JSON gets a generic JSON error', async () => {
  const response = await fetch(`${base}/mypage/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  expect(response.status).toBe(400); expect(await response.text()).not.toContain('SyntaxError');
});
