/* Standalone, development-only browser review for the final chapter.
 * Disposable synthetic camps unlock content; all playthrough actions use the
 * shipped keyboard and dialogs. No engine state is changed during a fight. */
'use strict';
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const C = require('../../games/lumenwild/js/core');
const { nextAction } = require('../helpers/lumenwildPilot');
const root = path.resolve(__dirname, '../..');
const output = process.env.LUMENWILD_REVIEW_OUTPUT || '/tmp/lumenwild-finale-review';
const checks = [], errors = [], failures = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
const completeCamp = () => C.profile({
  runs: 1, rescues: 3, memories: C.MEMORIES.map((_, i) => i), relics: C.RELICS.map(r => r.id),
  trails: Object.fromEntries(C.TRAILS.map(t => [t.id, 1])), regions: C.BIOMES.map(() => ({ clears: 1 })),
  guardians: Object.fromEntries(C.GUARDIANS.filter(b => !b.hidden).map(b => [b.id, 1])),
  upgrades: Object.fromEntries(C.UPGRADES.map(u => [u.id, u.costs.length])),
  selectedArt: 'firstlight', selectedCharm: 'keeper', gentle: true,
});
async function press(page, key) { await page.waitForTimeout(120); await page.keyboard.press(key); }
async function shot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }

async function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript({ content: `window.__nextAction = ${nextAction.toString()};` });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Lumenwild', { configurable: true, set(api) {
      const create = api.createExpedition, read = api.readSave;
      api.createExpedition = (...args) => { const game = create(...args); window.__game = game; return game; };
      api.readSave = (...args) => { const data = read(...args); window.__game = data.game; return data; };
      Object.defineProperty(window, 'Lumenwild', { value: api, configurable: true });
    } });
  });
}
async function openCamp(browser, base, profile, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport }); await observe(page);
  if (profile) await page.addInitScript(({ profile, version }) => {
    if (!sessionStorage.getItem('finaleFixture')) {
      localStorage.setItem('lumenwild.garden.v1', JSON.stringify({ version, profile, run: null }));
      sessionStorage.setItem('finaleFixture', 'ready');
    }
  }, { profile, version: C.VERSION });
  await page.goto(base); await page.locator('#mainAction:enabled').waitFor(); return page;
}
async function play(page, prefix, options = {}) {
  const seen = new Set(); let reloaded = false;
  for (let i = 0; i < 2400; i += 1) {
    const next = await page.evaluate(() => {
      const g = window.__game, C = window.Lumenwild;
      if (['won', 'lost'].includes(g.status)) return { status: g.status, elapsed: g.elapsed, boss: g.boss && { elapsed: g.boss.elapsed, stage: g.boss.stage, hits: g.boss.hitsTaken } };
      if (g.status === 'blessing') {
        const choices = g.choices(); return { blessing: (choices.find(b => b.id === 'radiance') || choices[0]).id };
      }
      if (document.querySelector('#dialog').open) return { awaken: g.boss?.state === 'sleeping' && document.querySelector('#dialogTitle').textContent === C.GUARDIANS.find(b => b.id === g.boss.id)?.name, close: true };
      const input = window.__nextAction(g, C), boss = g.boss;
      const keys = { attack: 'Space', guard: 'KeyG', art: 'KeyR', shift: 'KeyQ', dash: 'Shift', medicine: 'Digit1', bomb: 'Digit2', thread: 'Digit3', interact: 'KeyE', wait: 'Period', awaken: 'KeyE' };
      return { key: input.action === 'move' ? ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][input.direction] : keys[input.action], depth: g.depth,
        mode: boss?.state === 'active' ? `${boss.stage}-${boss.mode}-${boss.beat}` : 'maze', beat: boss?.beat, fighting: boss?.state === 'active' };
    });
    if (next.status) return next;
    if (next.blessing) { await page.locator(`[data-blessing="${next.blessing}"]`).click(); continue; }
    if (next.awaken) { await page.locator('#dialogActions button').first().click(); continue; }
    if (next.close) { await page.locator('#closeDialog').click(); continue; }
    const key = `${next.depth}-${next.mode}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (next.mode === 'maze' || next.mode === '1-windup-1' || next.mode === '4-windup-4' || next.mode === '4-recovery-4') {
        // Capture the live rendered scene without modifying game state.
        await shot(page, `${prefix}-${key}`); console.log(`REVIEW ${prefix} ${key}`);
      }
    }
    if (options.reload && !reloaded && next.fighting && next.beat === 2) {
      await press(page, 'Escape'); const before = await page.evaluate(() => window.__game.snapshot());
      await page.getByRole('button', { name: 'Save and return to camp' }).click();
      await page.reload(); await page.locator('#mainAction:enabled').waitFor();
      const restored = await page.evaluate(() => window.__game.snapshot());
      if (!isDeepStrictEqual(before, restored)) {
        fs.writeFileSync(path.join(output, 'reload-mismatch.json'), JSON.stringify({ before, restored }, null, 2));
        console.error('Reload changed fields:', Object.keys(before).filter(key => !isDeepStrictEqual(before[key], restored[key])));
      }
      check('hidden mid-sequence reload preserves current, preview and queued attacks exactly', isDeepStrictEqual(before, restored));
      await page.locator('#continueButton').click(); reloaded = true; continue;
    }
    if (options.phone && !options.phone.done && next.fighting && next.beat === 3) {
      await press(page, 'Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#closeDialog').click(); await shot(page, 'hidden-phone-portrait'); await press(page, 'Escape');
      check('phone portrait has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
      await page.setViewportSize({ width: 844, height: 390 });
      await page.locator('#closeDialog').click(); await shot(page, 'hidden-phone-landscape'); await press(page, 'Escape');
      check('phone landscape keeps the guardian HUD and controls visible', await page.locator('#guardianHud').isVisible() && await page.locator('[data-action="attack"]').isVisible());
      check('phone landscape has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
      await page.waitForTimeout(300); const paused = await page.evaluate(() => JSON.stringify(window.__game.snapshot()));
      await page.waitForTimeout(500); check('paused hidden fight does not advance', await page.evaluate(s => JSON.stringify(window.__game.snapshot()) === s, paused));
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('#closeDialog').click(); options.phone.done = true;
      continue;
    }
    await press(page, next.key);
  }
  throw new Error(`Bounded keyboard playthrough expired: ${prefix}`);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const app = express(); app.use('/css', express.static(path.join(root, 'public/css'))); app.use('/lumenwild', express.static(path.join(root, 'games/lumenwild')));
  const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
    const base = `http://127.0.0.1:${server.address().port}/lumenwild/`;
    let story = null;
    if (process.env.LUMENWILD_REVIEW_PART !== 'hidden') {
      const fresh = await openCamp(browser, base);
      check('all gameplay sprites load with no fallback', (await fresh.locator('#loadStatus').textContent()).includes('Ready when you are'));
      check('fresh camp hides the ending and secret', await fresh.locator('#secretButton').isHidden() && await fresh.locator('#endingButton').isHidden());
      await fresh.locator('#journalButton').click();
      check('journal lists all 138 pages and 69 relics', await fresh.locator('.journal-entry').count() === 138 && await fresh.locator('.relic-card').count() === 69);
      check('locked collection panel contains no boss name or entry', !(await fresh.locator('#dialogBody').textContent()).includes('The Hollow Star') && await fresh.locator('[data-secret]').count() === 0);
      await shot(fresh, 'collection-locked'); await fresh.close();

      const finale = await openCamp(browser, base, C.profile({ runs: 1, selectedTrail: 'finale', trails: { unwritten: 1 } }));
      await finale.locator('#mainAction').click();
      check('final chapter starts in Dawnroot Approach with starter gear', await finale.evaluate(() => window.__game.region === 21 && window.__game.stats().maxHp === 7));
      story = await play(finale, 'finale'); check('both final gardens and First Keeper complete via keyboard', story.status === 'won');
      check('final chapter shows the illustrated ending', await finale.locator('#dialogTitle').textContent() === 'The garden is home.' && await finale.locator('.ending-illustration').isVisible());
      await shot(finale, 'ending');
      const banked = await finale.evaluate(() => JSON.parse(localStorage.getItem('lumenwild.garden.v1')));
      check('final chapter and gifts are saved with no active checkpoint', banked.profile.trails.finale === 1 && banked.profile.guardians.firstkeeper === 1 && banked.run === null);
      await finale.locator('#dialogActions button').first().click(); await finale.locator('#endingButton').click(); await finale.locator('#dialogActions button').first().click();
      check('ending replay cannot duplicate rewards', await finale.evaluate(profile => JSON.stringify(JSON.parse(localStorage.getItem('lumenwild.garden.v1')).profile) === JSON.stringify(profile), banked.profile));
      await finale.close();

      const incomplete = completeCamp(); incomplete.relics.pop();
      const collecting = await openCamp(browser, base, incomplete, { width: 390, height: 844 });
      check('one missing relic keeps the hidden stage locked', await collecting.locator('#secretButton').isHidden());
      await collecting.locator('#journalButton').click(); await collecting.locator('#missingOnly').check();
      check('missing-only filter leaves the final region as a useful next destination', await collecting.locator('.journal-region-section:visible').count() === 1 && await collecting.locator('[data-find-region="22"]').count() === 1);
      await collecting.locator('.journal-region-section:visible summary').click(); await shot(collecting, 'collection-phone'); await collecting.close();

    }
    const hidden = await openCamp(browser, base, completeCamp());
    check('full collection reveals the hidden stage automatically', await hidden.locator('#secretButton').isVisible());
    await hidden.locator('#secretButton').click(); await shot(hidden, 'hidden-introduction');
    check('mastery introduction explains limited supplies and fixed difficulty', (await hidden.locator('#dialogBody').textContent()).includes('Gentle mode does not apply') && (await hidden.locator('#dialogBody').textContent()).includes('two tonics and two seedbombs'));
    await hidden.locator('[data-secret-start]').click();
    check('secret entry keeps equipment but standardizes the supply kit', await hidden.evaluate(() => { const g = window.__game; return g.art === 'firstlight' && g.charm === 'keeper' && !g.gentle && g.inventory.medicine === 2 && g.inventory.bomb === 2 && g.inventory.thread === 0; }));
    const mastery = await play(hidden, 'hidden', { reload: true, phone: {} });
    check('Hollow Star completes all four phases through real keyboard inputs', mastery.status === 'won' && mastery.boss.stage === 4);
    check('mastery victory records time, damage and the title', await hidden.locator('#dialogTitle').textContent() === 'Unfading Keeper' && await hidden.locator('.mastery-record').isVisible());
    await shot(hidden, 'mastery-victory'); await hidden.locator('#dialogActions button').click();
    check('camp displays the permanent Unfading Keeper title', await hidden.locator('#keeperTitle').isVisible());
    await hidden.reload(); await hidden.locator('#mainAction:enabled').waitFor(); await hidden.locator('#secretButton').click();
    check('hidden challenge can be replayed with a saved personal record', (await hidden.locator('.mastery-record').textContent()).includes('1 clears') && await hidden.locator('[data-secret-start]').isEnabled());
    check('no browser runtime exceptions', errors.length === 0); check('no failed asset requests', failures.length === 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, story, mastery, errors, failures }, null, 2));
    console.log(`COMPLETE ${checks.length} browser checks; screenshots: ${output}`);
  } finally {
    if (errors.length || failures.length) console.error({ errors, failures });
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
