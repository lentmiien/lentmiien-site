// Synthetic loopback page only. Uses the same external Playwright/Chromium/CSS
// configuration as accountDashboardLayout.cjs; never starts the application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { assets, settings, renderDashboard, cardData, overviewData } = require('../fixtures/accountDashboardLayout');

async function main() {
  assert(process.env.BOOTSTRAP_CSS, 'Supply Bootstrap 5.3.3 CSS.');
  const app = express();
  let payload = overviewData(); let fail = false;
  let preferences = structuredClone(settings);
  const requests = [];
  app.get('/mypage', (_req, res) => res.send(renderDashboard(preferences)));
  app.get('/mypage/api/overview', (_req, res) => fail ? res.status(503).json({ ok: false }) : res.json(payload));
  app.get('/mypage/api/cards/:id', (req, res) => { requests.push(req.params.id); res.json(cardData(req.params.id, 3)); });
  app.get('/assets/forms/:revision/:filename', assets.serve);
  app.use('/css', express.static('public/css'));
  app.use('/js', express.static('public/js'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css')) return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.BOOTSTRAP_CSS, 'utf8') });
      if (!url.startsWith(origin + '/')) return route.abort();
      if (route.request().resourceType() === 'script' && !['account_dashboard.js', 'mypage_tasks.js', 'nav.js'].some(name => url.endsWith('/' + name))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const waitForOverview = state => page.waitForFunction(expected => {
      const overview = document.getElementById('account-overview');
      return !overview.hasAttribute('aria-busy') && overview.dataset.state === expected;
    }, state);
    const refresh = async state => {
      await page.getByRole('button', { name: 'Refresh overview', exact: true }).click();
      await waitForOverview(state);
    };
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      preferences = structuredClone(settings); payload = overviewData(); fail = false;
      await page.goto(origin + '/mypage'); await waitForOverview('ready');
      const layout = await page.evaluate(() => {
        const overview = document.getElementById('account-overview');
        return { position: getComputedStyle(overview).position, height: overview.getBoundingClientRect().height,
          bottom: overview.getBoundingClientRect().bottom, sectionsTop: document.querySelector('.account-grid').getBoundingClientRect().top,
          columns: getComputedStyle(document.querySelector('.account-overview-grid')).gridTemplateColumns.split(' ').length,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.overflow, false);
      assert(!['sticky', 'fixed'].includes(layout.position));
      assert(layout.bottom < layout.sectionsTop, `${width}px overview must precede sections`);
      assert.equal(layout.columns, width < 360 ? 1 : width <= 960 ? 2 : 4);
      assert(layout.height < (width < 360 ? 1100 : width <= 960 ? 850 : 540), `${width}px overview too tall: ${layout.height}`);
      assert.equal(await page.locator('[data-overview-group]').count(), 7);
      for (const group of await page.locator('[data-overview-group]').all()) assert(await group.locator('.account-overview-row').count() <= 2);
      await page.screenshot({ path: path.join(os.tmpdir(), `mypage-overview-${width}.png`) });
      await page.evaluate(() => window.scrollTo(0, document.getElementById('account-overview').offsetTop + document.getElementById('account-overview').offsetHeight));
      assert(await page.locator('#account-overview').evaluate(el => el.getBoundingClientRect().bottom <= 1), 'Overview scrolls off screen');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole('button', { name: 'Customize account', exact: true }).click();
      assert(await page.locator('#account-customizer').evaluate(el => el.open));
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'account-customize');
      assert.equal(await page.locator('#account-overview a[href="/settings"]').count(), 1);

      // Long titles remain available to assistive technology and in the link title.
      const longTitle = 'Synthetic unbroken title '.repeat(20);
      payload.groups[0].rows[0].title = longTitle;
      await refresh('ready');
      assert.equal(await page.locator('[data-overview-group="tasks"] .account-overview-row a').first().getAttribute('title'), longTitle);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      payload.groups[0] = { id: 'tasks', state: 'unavailable', rows: [], count: null };
      await refresh('partial');
      assert.equal(await page.locator('[data-overview-group="tasks"] .account-overview-count').isVisible(), false);
      assert.equal(await page.locator('[data-overview-group="chats"] .account-overview-row').count(), 2);
      fail = true; await refresh('error');
      assert.equal(await page.locator('.account-overview-count:visible').count(), 0);
      fail = false;
      payload.groups = payload.groups.map(g => ({ id: g.id, rows: [], count: 0, state: 'empty' }));
      await refresh('ready');
      assert.equal(await page.locator('.account-overview-row').count(), 0);
      assert.equal(await page.locator('.account-overview-state:visible').count(), 7);

      preferences.hiddenSections = settings.sections.map(s => s.id); requests.length = 0;
      payload = overviewData();
      await page.reload(); await waitForOverview('ready');
      assert.deepEqual(requests, []);
      assert.equal(await page.locator('.account-card:visible').count(), 0);
      assert.equal(await page.locator('.account-overview-row').count(), 12);
      console.log(`PASS ${width}px: compact scrolling overview, keyboard controls, bounded/long previews, empty/error/retry states, hidden-card independence.`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
