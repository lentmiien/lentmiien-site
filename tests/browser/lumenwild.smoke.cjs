/* Optional development-only browser QA. Starts a static fixture, never app.js,
 * a database, a scheduler, or the prestart pipeline. No test hooks are shipped. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { nextAction } = require('../helpers/lumenwildPilot');
const root = path.resolve(__dirname, '../..');
const output = process.env.LUMENWILD_REVIEW_OUTPUT || '/tmp/lumenwild-review';
const checks = [], errors = [], failedRequests = [], requests = [];
const check = (label, condition) => { assert.ok(condition, label); checks.push(label); console.log(`PASS ${label}`); };

async function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript({ content: `window.__lumenNextAction = ${nextAction.toString()};` });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Lumenwild', { configurable: true, set(api) {
      const Original = api.Game, restore = Original.restore, create = api.createExpedition;
      api.createExpedition = (...args) => { const game = create(...args); window.__lumenGame = game; return game; };
      Original.restore = snapshot => { const game = restore(snapshot); window.__lumenGame = game; return game; };
      api.Game = class extends Original { constructor(...args) { super(...args); window.__lumenGame = this; } };
      Object.defineProperty(window, 'Lumenwild', { value: api, configurable: true });
    } });
    if (window.AudioContext) {
      const OriginalAudio = window.AudioContext;
      window.AudioContext = class extends OriginalAudio { constructor(...args) { super(...args); window.__lumenAudio = this; } };
    }
  });
}

async function press(page, key) {
  // Preserve the shipped input cadence; do not bypass cooldowns or mutate state.
  await page.waitForTimeout(120);
  await page.keyboard.press(key);
}

async function screenshot(page, name) {
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}

async function completeViaKeyboard(page) {
  const seen = new Set();
  for (let i = 0; i < 1600; i += 1) {
    const next = await page.evaluate(() => {
      const g = window.__lumenGame, C = window.Lumenwild;
      if (g.status === 'won' || g.status === 'lost') return { status: g.status };
      if (g.status === 'blessing') {
        const choices = g.choices();
        return { blessing: (choices.find(b => b.id === 'radiance') || choices.find(b => b.id === 'harvest') || choices[0]).id };
      }
      if (document.querySelector('#dialog').open) return { close: true };
      const input = window.__lumenNextAction(g, C);
      const keys = { attack: 'Space', guard: 'KeyG', art: 'KeyR', shift: 'KeyQ', dash: 'Shift', medicine: 'Digit1', bomb: 'Digit2', thread: 'Digit3', interact: 'KeyE', wait: 'Period' };
      return { key: input.action === 'move' ? ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][input.direction] : keys[input.action], depth: g.depth };
    });
    if (next.status) return next.status;
    if (next.close) { await page.locator('#closeDialog').click(); continue; }
    if (next.blessing) {
      await screenshot(page, `blessing-${seen.size}`);
      await page.locator(`[data-blessing="${next.blessing}"]`).click();
      continue;
    }
    if (!seen.has(next.depth)) {
      seen.add(next.depth);
      console.log(`PLAYING garden ${next.depth + 1} through real keyboard input`);
    }
    await press(page, next.key);
    if (i % 55 === 35) await screenshot(page, `garden-${next.depth + 1}`);
  }
  throw new Error('Playthrough exceeded input limit');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/css', express.static(path.join(root, 'public/css')));
  app.use('/lumenwild', express.static(path.join(root, 'games/lumenwild')));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/lumenwild/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await observe(page); await page.goto(base); await page.locator('#mainAction:enabled').waitFor();
    check('all generated sprites and terrain load', (await page.locator('#loadStatus').textContent()).includes('Ready when you are'));
    check('desktop camp has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    await screenshot(page, '01-camp');
    await page.locator('#soundButton').click();
    await page.waitForFunction(() => window.__lumenAudio?.state === 'running');
    check('audio starts from a real gesture', true);
    await page.locator('#mainAction').click();
    check('welcome dialog captures focus', await page.locator('#dialog').evaluate(el => el.contains(document.activeElement)));
    await page.getByRole('button', { name: 'Light the lantern' }).click();
    await press(page, 'ArrowRight');
    check('keyboard movement collects the first starlight', await page.evaluate(() => window.__lumenGame.light === 1 && window.__lumenGame.player.x === 4));
    await page.waitForTimeout(120);
    await page.keyboard.down('ArrowLeft');
    const afterMove = await page.evaluate(() => window.__lumenGame.turn);
    await page.keyboard.press('Space'); await page.keyboard.up('ArrowLeft');
    check('abilities respond immediately during held movement', await page.evaluate(turn => window.__lumenGame.turn === turn + 1, afterMove));
    const bloom = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
    await press(page, 'KeyQ'); await page.waitForTimeout(500);
    check('fold switches realm and changes actual canvas pixels', await page.evaluate(() => window.__lumenGame.phase === 1) && await page.locator('#world').evaluate(canvas => canvas.toDataURL()) !== bloom);
    await screenshot(page, '02-echo');
    await press(page, 'KeyM');
    const turn = await page.evaluate(() => window.__lumenGame.turn);
    const pausedClock = await page.evaluate(() => window.__lumenGame.elapsed);
    await page.waitForTimeout(1200);
    check('map freezes the combat clock', await page.evaluate(t => window.__lumenGame.elapsed === t, pausedClock));
    await press(page, 'ArrowRight');
    check('map pauses gameplay and is keyboard dismissible', await page.evaluate(t => window.__lumenGame.turn === t && document.querySelector('#dialog').open, turn));
    await screenshot(page, '03-atlas'); await press(page, 'KeyM');
    await press(page, 'Digit3');
    check('guiding thread consumes exactly one charge', await page.evaluate(() => window.__lumenGame.inventory.thread === 2 && window.__lumenGame.guideTurns === 40));
    await press(page, 'Escape');
    const before = await page.evaluate(() => window.__lumenGame.snapshot());
    await page.getByRole('button', { name: 'Save and return to camp' }).click();
    await page.reload(); await page.locator('#mainAction:enabled').waitFor(); await page.locator('#continueButton').click();
    check('reload and Continue preserve the exact expedition', await page.evaluate(snapshot => JSON.stringify(window.__lumenGame.snapshot().entities) === JSON.stringify(snapshot.entities) && window.__lumenGame.turn === snapshot.turn && window.__lumenGame.phase === snapshot.phase && window.__lumenGame.player.x === snapshot.player.x && window.__lumenGame.inventory.thread === snapshot.inventory.thread, before));
    check('all three gardens complete through normal keyboard actions', await completeViaKeyboard(page) === 'won');
    await page.waitForFunction(() => document.querySelector('#dialogTitle').textContent === 'And the world opened.');
    await screenshot(page, '04-ending');
    const banked = await page.evaluate(() => JSON.parse(localStorage.getItem('lumenwild.garden.v1')));
    check('victory banks rewards once and clears the checkpoint', banked.profile.wins === 1 && banked.profile.light > 0 && banked.run === null);
    await page.reload(); await page.locator('#mainAction:enabled').waitFor();
    check('reloading the ending cannot duplicate rewards', await page.evaluate(p => JSON.parse(localStorage.getItem('lumenwild.garden.v1')).profile.light === p.light, banked.profile));
    await page.locator('#workshopButton').click();
    await page.locator('[data-upgrade="hearth"]').click();
    check('camp purchase persists and spends the displayed cost', await page.evaluate(p => { const now = JSON.parse(localStorage.getItem('lumenwild.garden.v1')).profile; return now.upgrades.hearth === 1 && now.light === p.light - 18; }, banked.profile));
    await page.locator('#closeDialog').click();
    await page.locator('#journeysButton').click();
    check('frontier unlocks after the first chapter', await page.locator('[data-trail="frontier"]').isEnabled());
    await screenshot(page, '08-world-atlas');
    await page.locator('[data-trail="frontier"]').click();
    await page.locator('#mainAction').click();
    check('new chapter starts in the marsh', await page.evaluate(() => window.__lumenGame.region === 3));
    await screenshot(page, '09-marsh');
    await press(page, 'Escape'); await page.getByRole('button', { name: 'Save and return to camp' }).click();
    await page.locator('#dailyButton').click(); await page.getByRole('button', { name: 'Begin a new journey' }).click();
    check('daily loadout excludes purchased upgrades', await page.evaluate(() => window.__lumenGame.daily && window.__lumenGame.player.hp === 7 && window.__lumenGame.upgrades.hearth === 0));

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await observe(phone); await phone.goto(base); await phone.locator('#mainAction:enabled').waitFor();
    await screenshot(phone, '05-phone-camp');
    check('phone camp has no horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    await phone.locator('#mainAction').click(); await phone.getByRole('button', { name: 'Light the lantern' }).click();
    await phone.locator('[data-dir="1"]').tap();
    check('touch direction pad moves and collects', await phone.evaluate(() => window.__lumenGame.player.x === 4 && window.__lumenGame.light === 1));
    await phone.waitForTimeout(150); await phone.locator('[data-action="shift"]').tap();
    check('touch abilities shift the world', await phone.evaluate(() => window.__lumenGame.phase === 1));
    await screenshot(phone, '06-phone-garden');
    check('all ten touch abilities fit on screen', await phone.locator('.action-deck button').evaluateAll(buttons => buttons.length === 10 && buttons.every(button => { const r = button.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })));
    await phone.setViewportSize({ width: 844, height: 390 }); await phone.waitForTimeout(250);
    await screenshot(phone, '07-phone-landscape');
    check('landscape stage and controls remain visible', await phone.locator('#world').evaluate(el => el.getBoundingClientRect().height >= 160) && await phone.locator('.action-deck').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('focus loss pauses and clears controls', await phone.locator('#dialogTitle').textContent() === 'The garden can wait.');

    const blocked = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await observe(blocked);
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    await blocked.goto(base); await blocked.locator('#mainAction:enabled').waitFor(); await blocked.locator('#mainAction').click();
    await blocked.getByRole('button', { name: 'Light the lantern' }).click();
    check('blocked storage gives a visible notice without blocking play', await blocked.locator('#storageNotice').isVisible());
    await press(blocked, 'ArrowRight');
    check('reduced-motion play still collects items', await blocked.evaluate(() => window.__lumenGame.light === 1));
    check('no browser exceptions', errors.length === 0);
    check('no failed asset requests', failedRequests.length === 0);
    check('runtime makes no external requests', requests.every(url => url.startsWith(new URL(base).origin)));
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors, failedRequests, requestCount: requests.length }, null, 2));
    console.log(`Verified ${checks.length} browser checks; screenshots in ${output}`);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
