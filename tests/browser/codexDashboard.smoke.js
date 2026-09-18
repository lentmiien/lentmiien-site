/* Optional real-browser check. Run from the repository root with Playwright available:
 * PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/codexDashboard.smoke.js
 * Serves synthetic fixtures only; never imports app.js or connects to MongoDB.
 */
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { dashboardFixture } = require('../fixtures/codexDashboard');
const { createFormAssets } = require('../../utils/formAssets');

(async () => {
  const fixture = dashboardFixture();
  const app = express();
  app.get('/codex', (_req, res) => res.send(fixture.html));
  app.get('/codex/api/session-history', (req, res) => res.json(fixture.history(req.originalUrl)));
  app.get('/codex/api/queue', (_req, res) => res.json(fixture.state));
  app.get('/codex/api/stats', (_req, res) => res.json({ stats: fixture.state.stats }));
  app.get('/codex/api/health', (_req, res) => res.json({ ok: true, health: {} }));
  app.get('/codex/api/turns/:id/events', (_req, res) => res.json({ ok: true, events: [], lastSeq: 0 }));
  app.use(express.json());
  app.post('/codex/api/sessions', (_req, res) => res.json({ ok: true, turn: { id: 'new-fixture-turn' } }));
  app.patch('/codex/api/pricing', (_req, res) => res.json({ ok: true, stats: fixture.state.stats }));
  app.post('/codex/api/turns/:id/cancel', (_req, res) => res.json({ ok: true }));
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
    const url = `http://127.0.0.1:${server.address().port}/codex`;
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.locator('[data-codex-history-status]').filter({ hasText: '1–12 of 37 sessions' }).waitFor();
      assert.equal(await page.locator('#codex-new-request-panel').getAttribute('open'), null);
      const measurements = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        nav: [...document.querySelectorAll('.codex-dashboard-nav > *')].map((node) => {
          const rect = node.getBoundingClientRect();
          return { y: rect.y, width: rect.width, height: rect.height, name: node.getAttribute('aria-label') };
        }),
      }));
      assert.ok(measurements.content <= measurements.viewport, `Overflow at ${width}: ${JSON.stringify(measurements)}`);
      assert.ok(measurements.nav.every((rect) => rect.width >= 44 && rect.height >= 44 && rect.name));
      assert.ok(measurements.nav.every((rect) => rect.y === measurements.nav[0].y));
      await page.locator('#codex-new-request-panel > summary').focus();
      await page.keyboard.press('Enter');
      await page.locator('#codex-prompt').fill('A synthetic prompt retained across collapse.');
      await page.locator('#codex-new-request-panel > summary').click();
      await page.locator('#codex-new-request-panel > summary').click();
      assert.equal(await page.locator('#codex-prompt').inputValue(), 'A synthetic prompt retained across collapse.');
      await page.locator('#codex-new-request-maximize').click();
      assert.equal(await page.locator('#codex-new-request-maximize').getAttribute('aria-pressed'), 'true');
      await page.locator('#codex-new-request-maximize').click();
      await page.locator('[data-codex-prompt-submit]').click();
      await page.locator('#codex-new-session-status').filter({ hasText: 'Accepted.' }).waitFor();
      await page.locator('#codex-new-request-panel > summary').click();
      await page.locator('[data-codex-history-next]').click();
      await page.locator('[data-codex-history-page]').filter({ hasText: 'Page 2 of 4' }).waitFor();
      assert.ok((await page.locator('[data-codex-session-table]').innerText()).includes('Historical session 13'));
      if (width === 390) {
        await page.locator('[data-codex-running-list] [data-action="cancel-turn"]').click();
        await page.waitForTimeout(11000);
        assert.equal(await page.locator('[data-codex-history-page]').innerText(), 'Page 2 of 4');
        const pricing = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Token Prices', exact: true }) });
        await pricing.locator('summary').focus();
        await page.keyboard.press('Enter');
        await page.locator('#codex-price-openai-input').fill('2.5');
        await page.getByRole('button', { name: 'Save OpenAI Prices', exact: true }).click();
        await pricing.locator('[data-provider="openai"] [data-codex-pricing-status]').filter({ hasText: 'Prices saved.' }).waitFor();
        await pricing.locator('summary').click();
        console.log('PASS live polling and cancel preserve historical page; keyboard price disclosure and save');
      }
      await page.locator('[data-codex-history-filters] input').fill('session 37');
      await page.locator('[data-codex-history-filters] button').click();
      await page.locator('[data-codex-history-status]').filter({ hasText: '1–1 of 1 sessions' }).waitFor();
      await page.getByRole('button', { name: 'Health', exact: true }).click();
      assert.equal(await page.locator('#codex-health-modal').getAttribute('open'), '');
      await page.keyboard.press('Escape');
      await page.locator('[data-codex-history-filters] input').fill('');
      await page.locator('[data-codex-history-filters] button').click();
      await page.locator('[data-codex-history-status]').filter({ hasText: '1–12 of 37 sessions' }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/codex-dashboard-${width}.png`, fullPage: true });
      console.log(`PASS ${width}px: no page overflow, 44px named icon targets, keyboard disclosure, retained/submitted prompt, maximize/restore, pagination/filter, health dialog`);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
