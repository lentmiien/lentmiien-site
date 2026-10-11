/* Synthetic Mori browser regression. Never loads .env, production or a real model. */
const fs = require('fs/promises');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreview } = require('./preview-commons');
async function run() {
  const output = path.resolve(process.env.COMMONS_SCREENSHOTS || 'documentation/commons/validation-mori-ai');
  await fs.mkdir(output, { recursive: true });
  const calls = [], checks = [], errors = [];
  let mode = 'slow';
  const preview = await createPreview({ provider: (_messages, signal) => new Promise((resolve, reject) => {
    calls.push({ signal, resolve });
    if (mode === 'slow') setTimeout(() => resolve('A synthetic welcome after seventeen seconds.'), 17000);
    if (mode === 'failure') reject(Object.assign(new Error('Synthetic connection failure'), { code: 'ECONNREFUSED' }));
  }) });
  let browser;
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const wait = async predicate => {
    const deadline = Date.now() + 6000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'Synthetic state timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.COMMONS_CHROMIUM || undefined });
    const residents = [];
    for (const [resident, viewport, mobile] of [[2, { width: 1440, height: 1000 }, false], [3, { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await context.request.post(preview.url + '/__preview/login', { data: { resident } });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(preview.url + '/commons'); await page.waitForFunction(() => !document.getElementById('enter').disabled);
      await page.click('#enter'); await page.waitForFunction(() => document.getElementById('cover').hidden);
      const player = () => preview.room.state.players.find(p => p.userId === String(resident).padStart(24, '0'));
      const visit = async () => {
        Object.assign(player(), { x: 33, y: 23, scene: 'village' });
        await page.waitForTimeout(600); await page.locator('#nearby-list button').filter({ hasText: 'Mori' }).click();
        await page.waitForTimeout(550);
      };
      residents.push({ page, player, visit });
    }
    const [desktop, mobile] = residents;
    for (const [index, resident] of residents.entries()) {
      await resident.visit(); await resident.page.fill('#npc-text', 'Synthetic hello'); await resident.page.click('#npc-send');
      await resident.page.waitForFunction(() => document.getElementById('npc-answer').textContent.includes('two minutes'));
      check(await resident.page.isDisabled('#npc-send'), 'Duplicate submit disabled ' + index);
      await resident.page.screenshot({ path: path.join(output, index ? 'mobile-pending.png' : 'desktop-pending.png') });
      check(await resident.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow ' + index);
    }
    await desktop.page.click('#close-dialog'); await desktop.page.focus('#world');
    const before = desktop.player().x;
    await desktop.page.keyboard.down('d'); await desktop.page.waitForTimeout(500); await desktop.page.keyboard.up('d');
    check(desktop.player().x > before, 'World movement continues while both NPC slots wait');
    check(preview.npc.active.size === 2, 'Two independent pending conversations');
    await desktop.visit();
    check(await desktop.page.isDisabled('#npc-send'), 'Reopening pending dialogue does not allow duplicate send');
    for (const [index, resident] of residents.entries()) {
      await resident.page.waitForFunction(() => document.getElementById('npc-answer').textContent.includes('AI reply'), { timeout: 25000 });
      check((await resident.page.textContent('#npc-answer')).includes('seventeen seconds'), 'Reply beyond old server and browser deadlines succeeds ' + index);
      await resident.page.screenshot({ path: path.join(output, index ? 'mobile-success.png' : 'desktop-success.png') });
    }
    mode = 'failure';
    await desktop.page.click('#npc-send');
    await desktop.page.waitForFunction(() => document.getElementById('npc-answer').textContent.includes('Local reply · AI unavailable'));
    check(true, 'Enabled failure has truthful fallback label');
    await desktop.page.screenshot({ path: path.join(output, 'desktop-fallback.png') });
    mode = 'pending';
    await mobile.page.click('#npc-send'); await wait(() => calls.length === 4);
    await mobile.page.click('#close-dialog');
    const home = require('../public/commons/world').homes[mobile.player().plot];
    Object.assign(mobile.player(), { x: home.x, y: home.y + 1.2 });
    await mobile.page.waitForTimeout(600);
    await mobile.page.locator('#nearby-list button').filter({ hasText: 'Your cottage' }).click();
    await wait(() => calls[3].signal.aborted && preview.npc.active.size === 0);
    calls[3].resolve('STALE_SYNTHETIC_ANSWER'); await mobile.page.waitForTimeout(200);
    check(!(await mobile.page.textContent('body')).includes('STALE_SYNTHETIC_ANSWER'), 'Scene cancellation discards late reply');
    check(await mobile.page.isEnabled('#npc-send'), 'Scene cancellation resets submit state');
    check(calls.length === 4, 'Exactly four requested calls, no retries or duplicates');
    check(errors.length === 0, 'No browser page errors');
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ synthetic: true, realInference: false, slowReplyMs: 17000, checks, errors }, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ passed: checks.length, errors }) + '\n');
  } finally { await browser?.close(); await preview.stop(); }
}
run().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
