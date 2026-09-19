/* Synthetic local UI check; never imports app.js or connects to MongoDB.
 * PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome
 *   node tests/browser/codexDetails.smoke.js
 */
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { detailFixture } = require('../fixtures/codexDetails');
const { createFormAssets } = require('../../utils/formAssets');

(async () => {
  let fixture = detailFixture();
  const writes = [];
  const app = express();
  app.use(express.json());
  app.get('/codex', (_req, res) => res.send('Synthetic dashboard'));
  app.get('/codex/sessions/session-1', (_req, res) => res.send(fixture.html('session')));
  app.get('/codex/turns/:id', (_req, res) => res.send(fixture.html('turn')));
  app.get('/codex/api/sessions/session-1', (_req, res) => res.json({ ok: true, ...fixture.payload('session') }));
  app.get('/codex/api/turns/:id', (_req, res) => res.json({ ok: true, ...fixture.payload('turn') }));
  app.get('/codex/api/turns/:id/events', (_req, res) => res.json({ events: [{ id: 'event-1', seq: 1, category: 'message', kind: 'agent_message', summary: 'Reviewing the workspace', timestamp: '2026-09-19T10:00:02Z' }], lastSeq: 1 }));
  app.get('/codex/api/turns/:id/raw-events', (_req, res) => res.json({ events: [], hasMore: false }));
  app.post('/codex/api/sessions/session-1/turns', (req, res) => {
    writes.push({ action: 'followup', body: req.body, csrf: req.headers['x-csrf-token'] });
    res.json({ ok: true, turn: { id: 'new-turn' } });
  });
  app.post('/codex/api/sessions/session-1/archive', (_req, res) => { writes.push({ action: 'archive' }); res.json({ ok: true }); });
  app.post('/codex/api/turns/:id/cancel', (_req, res) => { writes.push({ action: 'cancel' }); res.json({ ok: true }); });
  app.post('/codex/api/turns/:id/retry', (_req, res) => { writes.push({ action: 'retry' }); res.json({ ok: true, statusUrl: '/codex/turns/turn-1' }); });
  app.get('/assets/forms/:revision/:filename', createFormAssets().serve);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  let browser;
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    const noOverflow = async (label) => {
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.viewport, `${label}: ${JSON.stringify(dimensions)}`);
    };
    for (const width of [320, 390, 768, 1440]) {
      fixture = detailFixture();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${url}/codex/sessions/session-1`);
      await page.locator('[data-activity-summary]').filter({ hasText: 'Reviewing the workspace' }).waitFor();
      const icons = await page.locator('.codex-session-nav > *').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, label: node.getAttribute('aria-label') };
      }));
      assert.ok(icons.every((icon) => icon.width >= 44 && icon.height >= 44 && icon.label && icon.y === icons[0].y));
      assert.equal(await page.locator('.codex-followup-panel').getAttribute('open'), null);
      assert.equal(await page.locator('.codex-turn-disclosure').first().getAttribute('open'), null);
      assert.equal(await page.locator('[data-action="toggle-events"], [data-events-for]').count(), 0);
      assert.ok(await page.locator('.codex-session-response strong').isVisible());
      assert.equal(await page.locator('.codex-session-response img').count(), 0);
      await noOverflow(`session ${width} collapsed`);
      const disclosure = page.locator('.codex-turn-disclosure').first();
      await disclosure.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.ok(await disclosure.locator('h1').isVisible());
      await noOverflow(`session ${width} expanded`);
      await page.locator('.codex-followup-panel > summary').focus();
      await page.keyboard.press('Enter');
      await page.locator('#codex-followup-prompt').fill('Keep this follow-up draft');
      await page.locator('.codex-followup-panel > summary').click();
      await page.locator('.codex-followup-panel > summary').click();
      assert.equal(await page.locator('#codex-followup-prompt').inputValue(), 'Keep this follow-up draft');
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/sessions/session-1') && response.request().method() === 'GET'),
        page.locator('[data-action="cancel-turn"]').click(),
      ]);
      assert.equal(await disclosure.getAttribute('open'), '');
      await page.locator('#codex-followup-form [type="submit"]').click();
      await page.locator('#codex-followup-status').filter({ hasText: 'Accepted.' }).waitFor();
      assert.equal(writes.at(-1).body.prompt, 'Keep this follow-up draft');
      assert.equal(writes.at(-1).csrf, 'synthetic-test-token');
      await page.locator('.codex-followup-panel > summary').click();
      await disclosure.locator('summary').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/codex-session-${width}.png`, fullPage: true });

      await page.goto(`${url}/codex/turns/turn-1`);
      await page.getByRole('tab', { name: /Activity/ }).waitFor();
      assert.ok(await page.locator('.codex-transcript--detail strong').first().isVisible());
      await noOverflow(`turn ${width}`);
      await page.getByRole('tab', { name: /Issues/ }).click();
      await page.getByRole('tab', { name: /Raw events/i }).click();
      await page.getByRole('tab', { name: /Activity/ }).click();
      await page.getByRole('button', { name: 'Pause live', exact: true }).click();
      await page.getByRole('button', { name: /Resume live/ }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/codex-turn-${width}.png`, fullPage: true });
      console.log(`PASS ${width}px: icon targets, no overflow, keyboard disclosures, Markdown, retained drafts/open state, follow-up CSRF, live progress and Process Details tabs/pause`);
    }
    await page.goto(`${url}/codex/sessions/session-1`);
    await page.locator('[data-action="retry-turn"]').click();
    await page.waitForURL('**/codex/turns/turn-1');
    assert.equal(writes.at(-1).action, 'retry');
    await page.goto(`${url}/codex/sessions/session-1`);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.waitForURL('**/codex');
    assert.equal(writes.at(-1).action, 'archive');
    assert.deepEqual(errors, []);
    console.log('PASS existing retry/archive actions');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
