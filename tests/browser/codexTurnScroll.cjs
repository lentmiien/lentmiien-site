// Synthetic loopback fixture only: no app startup, credentials or database.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome
// BOOTSTRAP_CSS=/path/to/bootstrap-5.3.3.min.css node tests/browser/codexTurnScroll.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { turnScrollFixture } = require('../fixtures/codexTurnScroll');
const { createFormAssets } = require('../../utils/formAssets');

(async () => {
  assert(process.env.BOOTSTRAP_CSS, 'Supply Bootstrap 5.3.3 CSS used by the shared layout.');
  let fixture;
  const writes = [];
  const app = express();
  app.use(express.json());
  app.get('/codex/turns/turn-1', (_req, res) => res.send(fixture.html('turn')));
  app.get('/codex/api/turns/turn-1', (_req, res) => res.json({ ok: true, ...fixture.payload('turn') }));
  app.get('/codex/api/turns/turn-1/events', (_req, res) => res.json({ events: fixture.events, lastSeq: fixture.events.at(-1).seq }));
  app.get('/codex/api/turns/turn-1/raw-events', (_req, res) => res.json({ events: fixture.rawEvents, page: { hasMore: false } }));
  app.post('/codex/api/turns/turn-1/:action', (req, res) => {
    writes.push({ action: req.params.action, body: req.body, csrf: req.headers['x-csrf-token'] });
    res.json({ ok: true });
  });
  app.get('/assets/forms/:revision/:filename', createFormAssets().serve);
  app.use('/css', express.static('public/css'));
  app.use('/js', express.static('public/js'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route('**/*', route => {
      if (route.request().url().includes('bootstrap@5.3.3/dist/css/bootstrap.min.css')) {
        return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.BOOTSTRAP_CSS, 'utf8') });
      }
      return route.request().url().startsWith(origin + '/') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Control time to exercise the real polling callbacks without timing races.
    await page.clock.install();
    const cdp = await context.newCDPSession(page);
    const gesture = async (selector, touch, direction = 1) => {
      const target = page.locator(selector).first();
      await target.evaluate(el => {
        window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 200);
      });
      const box = await target.boundingBox();
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(Math.min(650, box.y + Math.min(box.height / 2, 350)));
      assert(await page.evaluate(({ selector, x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)),
        { selector, x, y }), `Gesture must start inside ${selector}`);
      const before = await page.evaluate(() => scrollY);
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let offset = 20; offset <= 140; offset += 20) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset * direction }] });
          await page.waitForTimeout(30);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, 240 * direction);
      }
      await page.waitForTimeout(350);
      const delta = await page.evaluate(previous => scrollY - previous, before);
      if (process.env.CODEX_SCROLL_BASELINE) {
        console.log(`BASELINE ${page.viewportSize().width}px ${touch ? 'touch' : 'wheel'} ${selector}: document delta ${delta}`);
      } else {
        assert(delta * direction > 20, `${selector}: ${touch ? 'touch' : 'wheel'} document delta ${delta}`);
      }
    };
    const inspect = async () => {
      const result = await page.evaluate(() => {
        const root = document.querySelector('[data-codex-turn-detail]');
        const nodes = [...root.querySelectorAll('.codex-events, .codex-raw-events, .codex-process-sidebar, pre, .codex-transcript-markdown table, .codex-event__markdown table')]
          .filter(el => el.checkVisibility());
        return {
          width: document.documentElement.scrollWidth, viewport: innerWidth,
          constrained: nodes.filter(el => {
            const s = getComputedStyle(el);
            return s.maxHeight !== 'none' || /contain|none/.test(s.overscrollBehaviorY) || el.scrollHeight > el.clientHeight + 1;
          }).map(el => el.className || el.tagName),
          overlap: [...root.querySelectorAll('.codex-transcript__block, .codex-activity-card, .codex-side-card')]
            .filter(el => el.checkVisibility() && el.scrollHeight > el.clientHeight + 1).map(el => el.className),
        };
      });
      assert(result.width <= result.viewport, `Page horizontal overflow: ${JSON.stringify(result)}`);
      assert.deepEqual(result.constrained, [], 'No inner vertical viewport or clipping');
      assert.deepEqual(result.overlap, [], 'Content stays inside its panels');
    };
    for (const width of [320, 390, 1440]) {
      fixture = turnScrollFixture();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + '/codex/turns/turn-1');
      await page.locator('.codex-activity-card').first().waitFor();
      await page.clock.pauseAt(new Date());
      await gesture('[data-events-for]', false);
      await gesture('[data-events-for]', true);
      if (process.env.CODEX_SCROLL_BASELINE) continue;
      await inspect();
      const detail = page.locator('[data-events-for] .codex-activity-detail').first();
      await detail.locator('summary').click();
      for (const selector of ['.codex-transcript-markdown pre', '.codex-transcript-markdown table',
        '[data-events-for] .codex-activity-detail__body pre:last-child', '[data-events-for] .codex-event__markdown pre', '.codex-process-sidebar']) {
        await gesture(selector, false);
        await gesture(selector, false, -1);
        if (width < 720) {
          await gesture(selector, true);
          await gesture(selector, true, -1);
        }
      }
      await inspect();
      await page.getByRole('tab', { name: /Issues/ }).click();
      await page.locator('[data-issues-for] summary').click();
      await gesture('[data-issues-for] pre:last-child', false);
      await inspect();
      await page.getByRole('tab', { name: /Raw events/ }).click();
      await page.locator('.codex-raw-event > summary').first().click();
      await page.locator('.codex-raw-event__body pre').first().waitFor();
      await gesture('.codex-raw-event__body pre', false);
      if (width < 720) await gesture('.codex-raw-event__body pre', true);
      await inspect();
      await page.getByRole('tab', { name: /Activity/ }).click();
      assert(await detail.evaluate(el => el.open), 'Tab changes retain expanded details');
      await page.getByRole('button', { name: 'Pause live', exact: true }).click();
      await page.getByRole('button', { name: 'Resume live', exact: true }).click();
      await page.locator('#codex-additional-message').fill('Synthetic retained draft');
      fixture.state.turns[0].finalResponse = 'Refreshed response\n\n' + fixture.markdown;
      fixture.events.push({ ...fixture.events[3], id: 'event-25', seq: 25, summary: 'Refreshed synthetic command' });
      await page.locator('[data-events-for]').evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top + 400));
      await page.clock.runFor(10000);
      await page.locator('[data-action="show-new-updates"]').waitFor();
      assert.equal(await page.getByText('Refreshed synthetic command', { exact: true }).count(), 0, 'Defer new rows while reading history');
      await page.locator('[data-action="show-new-updates"]').click();
      await page.getByText('Refreshed synthetic command', { exact: true }).waitFor();
      assert(await detail.evaluate(el => el.open), 'Polling retains expanded activity details');
      assert.equal(await page.locator('#codex-additional-message').inputValue(), 'Synthetic retained draft');
      await page.getByText('Refreshed response', { exact: true }).waitFor();
      await gesture('.codex-transcript__block:nth-child(2) pre', false);
      await gesture('.codex-transcript__block:nth-child(2) pre', true);
      await gesture('[data-events-for] .codex-event__markdown pre', true);
      const refreshedDetail = page.locator('[data-events-for] [data-activity-row-key="activity:seq:25"] details');
      await refreshedDetail.locator('summary').click();
      await gesture('[data-events-for] [data-activity-row-key="activity:seq:25"] pre:last-child', false);
      await gesture('[data-events-for] [data-activity-row-key="activity:seq:25"] pre:last-child', true);
      await refreshedDetail.locator('summary').click();
      await inspect();
      await detail.locator('summary').click();
      assert.equal(await detail.evaluate(el => el.open), false);
      await page.locator('[data-plan-sidebar] > summary').click();
      assert.equal(await page.locator('[data-plan-sidebar]').evaluate(el => el.open), false);
      await page.locator('[data-action="toggle-event-order"]').click();
      assert.equal(await page.locator('[data-action="toggle-event-order"]').textContent(), 'Chronological');
      await page.locator('[data-action="toggle-event-order"]').click();
      assert.equal(await page.locator('[data-action="toggle-event-order"]').textContent(), 'Newest first');
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/messages')),
        page.getByRole('button', { name: 'Send message', exact: true }).click(),
      ]);
      assert.deepEqual(writes.at(-1), { action: 'messages', body: { message: 'Synthetic retained draft' }, csrf: 'synthetic-test-token' });
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/cancel')),
        page.getByRole('button', { name: 'Cancel', exact: true }).click(),
      ]);
      assert.deepEqual(writes.at(-1), { action: 'cancel', body: {}, csrf: 'synthetic-test-token' });
      await page.locator('[data-process-activity]').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `/tmp/codex-turn-scroll-${width}.png` });
      console.log(`PASS ${width}px: document wheel/touch, code/Markdown/logs/raw/sidebar, no clipping/overflow, refresh/new updates, tabs/collapse/actions/draft`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
