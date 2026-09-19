// Synthetic loopback fixture; no app startup, credentials, database or production requests.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome
// BOOTSTRAP_CSS=/path/to/bootstrap-5.3.3.min.css node tests/browser/accountDashboardLayout.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { assets, settings, renderDashboard, cardData, renderLifePanel, lifeEntries } = require('../fixtures/accountDashboardLayout');

async function main() {
  assert(process.env.BOOTSTRAP_CSS, 'Supply the layout’s Bootstrap 5.3.3 CSS for accurate responsive checks.');
  const app = express();
  let preferences = structuredClone(settings);
  let rowCount = 12;
  let followupCount = 12;
  const requests = [];
  app.use(express.json());
  app.get('/mypage', (_req, res) => res.send(renderDashboard(preferences)));
  app.get('/mypage/api/cards/:id', (req, res) => {
    requests.push(req.params.id); res.json(cardData(req.params.id, rowCount));
  });
  app.get('/mypage/api/life-panel', (_req, res) => res.send(renderLifePanel()));
  app.get('/mypage/api/life/entries', (_req, res) => res.json(lifeEntries(followupCount)));
  app.post('/mypage/api/settings', (req, res) => {
    preferences = { ...preferences, ...req.body };
    res.json({ ok: true, settings: preferences });
  });
  app.get('/assets/forms/:revision/:filename', assets.serve);
  app.use('/css', express.static('public/css'));
  app.use('/js', express.static('public/js'));
  app.get('/i/img_select.jpg', (_req, res) => res.sendFile(path.resolve('public/i/img_select.jpg')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css')) {
        return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.BOOTSTRAP_CSS, 'utf8') });
      }
      if (!url.startsWith(origin + '/')) return route.abort();
      if (route.request().resourceType() === 'script' && !['account_dashboard.js', 'mypage_tasks.js', 'my_life_log.js', 'nav.js'].some(name => url.endsWith('/' + name))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const card = id => page.locator(`[data-section="${id}"]`);
    const settled = () => page.waitForFunction(() => [...document.querySelectorAll('.account-card')].every(el =>
      el.hidden || el.querySelector('.account-card-content').hidden || el.dataset.state === 'ready' && !el.hasAttribute('aria-busy')));
    const inspect = async width => {
      const result = await page.evaluate(() => {
        const grid = document.querySelector('.account-grid');
        // Graphics clip their coordinate surfaces deliberately. Native form controls
        // and the task hold indicator are controls, not dashboard content viewports.
        const excluded = '.life-log-visual-canvas, .life-log-visual-canvas *, .life-log-followup-preview, .life-log-followup-preview *, .mypage-task-progress, .mypage-task-progress *, input, select, textarea, option, datalist';
        const visible = [...grid.querySelectorAll('*')].filter(el => el.getClientRects().length && !el.matches(excluded));
        const describe = el => `${el.tagName}#${el.id}.${el.className}`;
        const constrained = visible.filter(el => {
          const s = getComputedStyle(el);
          return /auto|scroll|hidden|clip/.test(s.overflowY) || s.maxHeight !== 'none' || /contain|none/.test(s.overscrollBehaviorY);
        }).map(describe);
        const horizontal = visible.filter(el => {
          const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1;
        }).map(describe);
        const lists = [...grid.querySelectorAll('.account-rows, .account-task-list, .life-log-point-list, .life-log-followups-list, .life-log-reminder-list')]
          .filter(el => el.getClientRects().length).map(el => ({ name: describe(el), height: el.clientHeight, scroll: el.scrollHeight }));
        const overflowCards = [...grid.querySelectorAll('.account-card')].filter(el => el.getClientRects().length && el.scrollHeight > el.clientHeight + 1).map(describe);
        return { constrained, horizontal, lists, overflowCards,
          pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length };
      });
      assert.deepEqual(result.constrained, [], `${width}px content constraints`);
      assert.deepEqual(result.horizontal, [], `${width}px overflowing descendants`);
      assert.deepEqual(result.overflowCards, [], `${width}px card clipping/overlap`);
      assert(result.pageWidth <= result.viewport, `${width}px page overflow: ${JSON.stringify(result)}`);
      assert.equal(result.columns, width <= 720 ? 1 : 2);
      for (const list of result.lists) {
        assert(list.height > 350, `${width}px list too short: ${JSON.stringify(list)}`);
        assert(list.scroll <= list.height + 1, `${width}px nested viewport: ${JSON.stringify(list)}`);
      }
    };
    const cdp = await context.newCDPSession(page);
    const swipe = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(Math.min(700, box.y + Math.min(box.height / 2, 300)));
      const before = await page.evaluate(() => scrollY);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let offset = 20; offset <= 140; offset += 20) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(previous => scrollY > previous + 20, before);
    };
    for (const width of [320, 390, 1440]) {
      requests.length = 0; rowCount = 12; followupCount = 12; preferences = structuredClone(settings);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + '/mypage'); await settled();
      assert(!requests.includes('models') && !requests.includes('gateway') && !requests.includes('life'));
      await inspect(width);
      await page.screenshot({ path: path.join(os.tmpdir(), `mypage-layout-${width}.png`) });
      const chats = card('chats').locator('.account-rows');
      const oldHeight = await chats.evaluate(el => el.clientHeight);
      rowCount = 18;
      for (const id of ['chats', 'tasks', 'accounting', 'jobs', 'gateway']) {
        await card(id).locator('.account-refresh').click(); await settled();
        assert.equal(await card(id).locator('.account-row, .account-task-row').count(), 18);
      }
      assert(await chats.evaluate(el => el.clientHeight) > oldHeight);
      await card('chats').locator('.account-collapse').click();
      assert.equal(await card('chats').locator('.account-collapse').getAttribute('aria-expanded'), 'false');
      assert.equal(await chats.isVisible(), false);
      await card('chats').locator('.account-collapse').click(); await settled();
      await card('life').locator('.account-collapse').click(); await settled();
      await page.locator('[data-panel-loaded="true"]').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.life-log-followup-item').length === 12);
      const hitbox = page.locator('#llv-img-hitbox');
      for (let i = 0; i < 12; i++) {
        await page.locator('.point-item-add').click();
        await hitbox.tap();
      }
      assert.equal(await page.locator('.point-item').count(), 12);
      await inspect(width);
      await page.locator('.life-log-visual').screenshot({ path: path.join(os.tmpdir(), `mypage-layout-life-${width}.png`) });
      followupCount = 18;
      await page.locator('#llv-followups-refresh').click();
      await page.waitForFunction(() => document.querySelectorAll('.life-log-followup-item').length === 18);
      await card('life').locator('.account-refresh').click(); await settled();
      assert.equal(await page.locator('.point-item').count(), 12);
      await inspect(width);
      await chats.scrollIntoViewIfNeeded();
      const bounds = await chats.boundingBox();
      await page.mouse.move(bounds.x + 30, Math.max(50, bounds.y + 50));
      const beforeWheel = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 240);
      await page.waitForFunction(before => scrollY > before, beforeWheel);
      if (width < 720) {
        await swipe(chats);
        await swipe(card('tasks').locator('.schedule-task-pill').first());
        await swipe(page.locator('.life-log-point-list'));
        await swipe(hitbox);
        assert.equal(await page.locator('.point-item').count(), 12, 'Swiping the map must not create points');
      }
      await page.getByRole('button', { name: 'Customize account', exact: true }).click();
      assert.equal(await page.locator('#account-customizer').evaluate(el => el.open), true);
      await page.locator('[data-setting-id="chats"] [data-collapsed]').check();
      await page.locator('[data-setting-id="models"] [data-visible]').check();
      await Promise.all([page.waitForEvent('load'), page.locator('#account-save').click()]);
      await page.waitForFunction(() => document.querySelector('[data-section="chats"] .account-card-content').hidden);
      await settled();
      assert.equal(await card('chats').locator('.account-card-content').isVisible(), false);
      assert.equal(await card('models').isVisible(), true);
      await card('chats').locator('.account-collapse').click(); await settled();
      await inspect(width);
      console.log(`PASS ${width}px: all sections, refreshed/lazy content, card growth, collapse/preferences, document wheel/touch scrolling, no horizontal overflow.`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
