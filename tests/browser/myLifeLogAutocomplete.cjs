// Local synthetic fixture only; does not start app.js or connect to a database.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome
// BOOTSTRAP_CSS=/path/to/bootstrap-5.3.3.min.css node tests/browser/myLifeLogAutocomplete.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { assets, renderDashboard, cardData, renderLifePanel } = require('../fixtures/accountDashboardLayout');
const malicious = '<img src=x onerror="alert(1)">';
const labels = [' Mood ', 'mood', 'Work', 'Walk', 'Water', 'Vitamin C', malicious, 'LongLabel'.repeat(20)];
async function main() {
  assert(process.env.BOOTSTRAP_CSS, 'Supply Bootstrap 5.3.3 CSS for responsive checks.');
  const app = express(); const writes = []; const reads = [];
  let rejectSave = false;
  app.use(express.json());
  app.get('/mypage', (_req, res) => res.send(renderDashboard()));
  app.get('/mypage/api/cards/:id', (req, res) => res.json(cardData(req.params.id)));
  app.get('/mypage/api/life-panel', (_req, res) => { reads.push('panel'); res.send(renderLifePanel({ labels })); });
  app.get('/mypage/api/life/entries', (_req, res) => { reads.push('entries'); res.json({ entries: [] }); });
  app.post('/mypage/api/life/entry', (req, res) => {
    writes.push(req.body);
    assert.equal(req.get('X-CSRF-Token'), 's'.repeat(43));
    res.status(rejectSave ? 400 : 200).json(rejectSave ? { error: 'Synthetic save rejection' } : { entry: { id: 'synthetic' } });
  });
  app.get('/assets/forms/:revision/:filename', assets.serve);
  app.use('/css', express.static('public/css')); app.use('/js', express.static('public/js'));
  app.get('/i/img_select.jpg', (_req, res) => res.sendFile(path.resolve('public/i/img_select.jpg')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true });
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 720, reducedMotion: 'reduce' });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css')) return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.BOOTSTRAP_CSS, 'utf8') });
        if (!url.startsWith(origin + '/')) return route.abort();
        if (route.request().resourceType() === 'script' && !['account_dashboard.js', 'mypage_tasks.js', 'my_life_log.js', 'nav.js'].some(name => url.endsWith('/' + name))) return route.abort();
        return route.continue();
      });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/mypage');
      const card = page.locator('[data-section="life"]');
      await card.locator('.account-collapse').click();
      await page.locator('[data-panel-loaded="true"]').waitFor();
      const input = page.getByRole('combobox', { name: 'Label', exact: true });
      const list = page.getByRole('listbox', { name: 'Existing labels' });
      const options = list.getByRole('option');
      await input.tap();
      assert.deepEqual(await options.allTextContents(), ['Mood', 'Work', 'Walk', 'Water', 'Vitamin C']);
      assert.equal(await input.getAttribute('aria-expanded'), 'true');
      const writeCount = writes.length;
      await options.getByText('Work', { exact: true }).tap(); // Actual touchscreen tap, not dispatchEvent/click().
      assert.equal(await input.inputValue(), 'Work'); assert.equal(await list.isVisible(), false);
      assert.equal(await input.evaluate(el => el === document.activeElement), true);
      assert.equal(writes.length, writeCount, 'Selecting must not submit');
      await input.fill(' wa'); assert.deepEqual(await options.allTextContents(), ['Walk', 'Water']);
      await options.getByText('Water', { exact: true }).tap(); assert.equal(await input.inputValue(), 'Water');
      await input.fill('New Mixed CASE'); assert.equal(await list.isVisible(), false);
      assert.equal(await input.inputValue(), 'New Mixed CASE');
      await page.locator('#life-log-value').fill('1');
      await page.getByRole('button', { name: 'Save entry', exact: true }).tap();
      await page.waitForFunction(() => document.getElementById('life-log-status').textContent === 'Saved.');
      assert.equal(writes.length, writeCount + 1); assert.equal(writes.at(-1).label, 'New Mixed CASE');
      assert.equal(await input.inputValue(), '');
      await input.tap(); assert.equal((await options.allTextContents())[0], 'New Mixed CASE');
      await input.fill('wo'); await input.press('ArrowDown');
      const activeId = await input.getAttribute('aria-activedescendant');
      assert.equal(await page.locator('#' + activeId).getAttribute('aria-selected'), 'true');
      await input.press('Enter'); assert.equal(await input.inputValue(), 'Work'); assert.equal(writes.length, writeCount + 1);
      await input.press('ArrowDown'); await input.press('Escape');
      assert.equal(await list.isVisible(), false); assert.equal(await input.inputValue(), 'Work');
      await input.press('ArrowDown'); await input.press('Tab');
      assert.equal(await page.locator('#life-log-value').evaluate(el => el === document.activeElement), true);
      assert.equal(await input.inputValue(), 'Work'); assert.equal(await list.isVisible(), false);
      // Closing the popup leaves normal implicit form submission intact.
      await page.locator('#life-log-value').fill('2'); await input.click(); await input.press('Escape');
      await input.press('Enter');
      await page.waitForFunction(() => document.getElementById('life-log-label').value === '');
      assert.equal(writes.length, writeCount + 2); assert.equal(writes.at(-1).label, 'Work');
      rejectSave = true;
      await input.fill('Unsaved'); await page.getByRole('button', { name: 'Save entry', exact: true }).tap();
      await page.waitForFunction(() => document.getElementById('life-log-status').textContent === 'Synthetic save rejection');
      assert.equal(await input.inputValue(), 'Unsaved'); rejectSave = false;
      await input.fill('<img'); assert.deepEqual(await options.allTextContents(), [malicious]);
      assert.equal(await list.locator('img').count(), 0);
      await options.first().tap(); assert.equal(await input.inputValue(), malicious);
      await input.fill('LongLabel');
      const bounds = await options.first().boundingBox(); assert(bounds.height >= 44);
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await input.fill('');
      await input.scrollIntoViewIfNeeded();
      await page.locator('.life-log-label-field').screenshot({ path: path.join(os.tmpdir(), `life-log-autocomplete-${width}.png`) });
      if (width < 720) {
        const cdp = await context.newCDPSession(page);
        const box = await options.first().boundingBox();
        const x = box.x + box.width / 2; const y = box.y + box.height / 2;
        const before = await page.evaluate(() => scrollY);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let d = 15; d <= 120; d += 15) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - d }] });
          await page.waitForTimeout(20);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(previous => scrollY > previous + 20, before);
        assert.equal(await input.inputValue(), '', 'Page swipe over suggestion must not select');
        await cdp.detach();
      }
      // Repeated dashboard refresh preserves the mounted form and locally learned labels.
      await input.fill('New Mixed');
      const readCount = reads.length;
      await card.locator('.account-refresh').click();
      await page.waitForFunction(() => !document.querySelector('[data-section="life"]').hasAttribute('aria-busy'));
      await input.tap(); assert.deepEqual(await options.allTextContents(), ['New Mixed CASE']);
      assert.equal(reads.length, readCount, 'Autocomplete must not fetch history or remount the panel');
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: real taps, typing, free-text/Enter save, keyboard/Tab, safe labels, refresh, 44px targets, no horizontal overflow${width < 720 ? ', document swipe across popup' : ''}.`);
      await context.close();
    }
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
