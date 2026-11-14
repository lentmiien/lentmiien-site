// Synthetic local fixture; no application startup or database.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome node tests/browser/codexTurnProgress.cjs
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { detailFixture } = require('../fixtures/codexDetails');
const { createFormAssets } = require('../../utils/formAssets');

(async () => {
  const fixture = detailFixture();
  const now = new Date('2026-11-14T10:00:00Z');
  const progress = {
    storage: { limit: 2000, cappedAt: '2026-11-14T09:30:00Z', omittedCount: 432, coalescedCount: 595 },
    workerHeartbeatAt: now.toISOString(), workerHeartbeatIntervalMs: 15000,
    lastExecutionActivityAt: '2026-11-14T09:59:00Z',
  };
  fixture.state.turns[0].progress = progress;
  fixture.state.turns[0].eventCount = 2003;
  let seq = 9000;
  const app = express();
  app.get('/codex/turns/turn-1', (_req, res) => res.send(fixture.html('turn')));
  app.get('/codex/api/turns/turn-1', (_req, res) => res.json({ ok: true, ...fixture.payload('turn') }));
  app.get('/codex/api/turns/turn-1/events', (req, res) => res.json({
    ok: true, progress, counts: { raw: 2003 }, lastSeq: seq,
    events: Number(req.query.afterSeq) < seq ? [{
      id: 'rolling-slot', seq, category: 'message', kind: 'agent_message', label: 'Agent message',
      summary: `Progress update ${seq}: checking the remaining cases.`, timestamp: now.toISOString(),
    }] : [],
  }));
  app.get('/assets/forms/:revision/:filename', createFormAssets().serve);
  app.use(express.static('public'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: now });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:${server.address().port}/codex/turns/turn-1`);
      await page.locator('[data-storage-status]').filter({ hasText: 'Messages, errors, and completion updates continue' }).waitFor();
      assert.equal(await page.locator('[data-worker-heartbeat]').textContent(), 'just now');
      assert.equal(await page.locator('[data-execution-activity]').textContent(), '1m ago');
      assert.equal(await page.locator('[data-raw-count]').textContent(), '2003');
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.viewport, JSON.stringify(dimensions));
      await page.screenshot({ path: `/tmp/codex-turn-progress-${width}.png`, fullPage: true });
    }
    seq = 12000;
    await page.clock.runFor(2000);
    await page.locator('[data-events-for]').filter({ hasText: 'Progress update 12000' }).waitFor();
    await page.clock.runFor(60000);
    await page.locator('[data-worker-heartbeat]').filter({ hasText: 'Delayed' }).waitFor();
    assert.equal(await page.locator('[data-raw-count]').textContent(), '2003');
    assert.deepEqual(errors, []);
    console.log('PASS: capped turn progress, sparse cursors, separate heartbeat/activity, mobile and desktop layouts');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
