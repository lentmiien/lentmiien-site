/* Synthetic pages and API only. No app startup, Mongo, credentials or AI calls. */
const assert = require('node:assert/strict');
const express = require('express');
const pug = require('pug');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const session = { id: 'synthetic_session', state: 'held', deadline: '2026-10-18T06:00:00+09:00', lease_deadline: '2026-10-18T02:02:00+09:00', cohort: 3 };
  const dashboard = { errors: {}, gpu: {}, requests: { totals: {}, routes: [] }, waiters: {}, logs: [], containers: [], checkpoints: [] };
  const app = express(), keys = [];
  let loseReply = true;
  app.get('/admin/ai-gateway', (_req, res) => res.send(pug.renderFile('views/admin_ai_gateway.pug', { dashboard, loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [], gtag: false })));
  app.get('/local-ai/queue', (_req, res) => res.send(pug.renderFile('views/local_ai_queue.pug', { session, jobs: [], job: null, csrfToken: 'synthetic', config: { enabled: true, auto: false } })));
  app.get('/local-ai/api/v1/config', (_req, res) => res.json({ csrfToken: 'synthetic' }));
  app.get('/local-ai/api/v1/scheduler', (_req, res) => res.json({ session, run: null, counts: { queued: 5, collecting: 1 }, auto: false }));
  app.post('/local-ai/api/v1/scheduler/start', (req, res) => {
    assert.equal(req.get('X-CSRF-Token'), 'synthetic'); keys.push(req.get('Idempotency-Key'));
    if (loseReply) { loseReply = false; res.status(503).json({ error: { code: 'reply_unavailable' } }); return; }
    res.status(202).json({ accepted: true });
  });
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1'); let browser;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + '/local-ai/queue');
      await page.getByText('GPU reserved across cohorts').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/local-ai-session-queue-${width}.png`, fullPage: true });
      await page.goto(origin + '/admin/ai-gateway');
      await page.locator('#localAiSessionSummary').getByText('GPU reserved — between cohorts', { exact: false }).waitFor();
      await page.locator('#localAiScheduler').screenshot({ path: `/tmp/local-ai-session-admin-${width}.png` });
    }
    const start = page.locator('[data-batch-control="start"]');
    await start.click(); await page.waitForFunction(() => !document.querySelector('[data-batch-control="start"]').disabled);
    await start.click(); await page.waitForFunction(() => !document.querySelector('[data-batch-control="start"]').disabled);
    assert.equal(keys.length, 2); assert.ok(keys[0]); assert.equal(keys[0], keys[1]);
    session.state = 'closing'; await page.reload();
    await page.locator('#localAiSessionSummary').getByText('closing', { exact: false }).waitFor();
    process.stdout.write('Session UI: mobile/desktop reserved status, release pending, CSRF and lost Start reply idempotency passed.\n');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
