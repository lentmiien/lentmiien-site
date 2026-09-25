/* Developer-only browser instrumentation. The shipped game exposes no test API.
   Completion/failure flights exclusively call ordinary three-button model inputs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pilotInput, makePilot } = require('./fly-stage.cjs');
const out = path.join(__dirname, '../docs/validation');
const base = process.env.DESCENT_URL || 'http://127.0.0.1:8767/';
const checks = [], errors = [], requests = [], flights = [], renders = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
async function instrument(page) {
  await page.addInitScript(() => {
    for (const [key, Class, target] of [['Descent', 'Simulation', '__sim'], ['DescentInput', 'Input', '__input']]) {
      Object.defineProperty(window, key, { configurable: true, set(api) {
        const Original = api[Class];
        api[Class] = class extends Original { constructor(...args) { super(...args); window[target] = this; } };
        Object.defineProperty(window, key, { value: api, configurable: true });
      } });
    }
    if (window.AudioContext) {
      const originalGain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () { const g = originalGain.call(this); window.__gain = g; return g; };
    }
    const original = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) { window.__draws = (window.__draws || 0) + 1; return original.apply(this, args); };
  });
  await page.route('**/renderer.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace('this.renderer.render(this.scene, this.camera);', 'this.renderer.render(this.scene, this.camera); window.__renderStats = { ...this.renderer.info.render, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, main: this.mainFlame.visible, leftNozzle: this.sideFlames[0].visible, rightNozzle: this.sideFlames[1].visible };') });
  });
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(out, name + '.png') }); }
async function complete(page) {
  await page.addScriptTag({ content: `window.__pilotInput = ${pilotInput.toString()}; window.__makePilot = ${makePilot.toString()}; var C = Descent.C, clamp = Descent.clamp;` });
  return page.evaluate(() => {
    const sim = window.__sim, pilot = window.__makePilot();
    let input = {};
    for (let i = 0; i < 21600 && !['landed', 'crashed'].includes(sim.state.status); i++) {
      if (i % 12 === 0) input = window.__pilotInput(sim, pilot);
      sim.step(input);
    }
    return { stage: sim.stage.id, mode: sim.mode, status: sim.state.status, fuel: sim.state.fuel, touchdown: sim.state.touchdown };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await instrument(page);
    await page.goto(base); await page.locator('#launch:enabled').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => window.__draws > 0);
    check('WebGL draws actual scene', await page.locator('#failure').isHidden());
    await screenshot(page, '01-menu');
    await page.locator('#mute').click(); check('audio is gesture enabled', await page.locator('#mute').getAttribute('aria-pressed') === 'true');
    await page.locator('#launch').click();
    await screenshot(page, '02-flight');
    await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__sim.state.y > 8);
    await page.keyboard.down('KeyD'); await page.waitForFunction(() => window.__sim.state.angle > .1 && window.__renderStats.leftNozzle);
    check('main thrust and correct opposing rotation plume', await page.evaluate(() => window.__renderStats.main && window.__renderStats.leftNozzle && !window.__renderStats.rightNozzle));
    await screenshot(page, '03-exhaust');
    await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyP');
    const elapsed = await page.evaluate(() => window.__sim.state.elapsed); await page.waitForTimeout(150);
    check('pause freezes physics and clears all held keys', await page.evaluate(t => window.__sim.state.elapsed === t && !window.__input.values().main, elapsed));
    await page.locator('#resume').click(); await page.keyboard.down('ArrowLeft');
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('ArrowLeft');
    check('blur pauses and clears rotation', await page.evaluate(() => window.__sim.state.paused && !window.__input.values().left));
    await page.locator('#resume').click(); await page.locator('#help').click(); await page.keyboard.press('KeyP');
    check('help cannot resume through its overlay', await page.evaluate(() => window.__sim.state.paused));
    await page.locator('#closeHelp').click(); await page.keyboard.press('KeyR');
    check('retry restores fresh normal start', await page.evaluate(() => window.__sim.state.grounded === 'start' && window.__sim.state.fuel === 160));
    await page.evaluate(() => { for (let i = 0; i < 2000; i++) window.__sim.step({ main: true }); });
    await page.locator('#resultDialog[open]').waitFor();
    check('ordinary main-only flight fails visibly', await page.locator('#resultText').textContent().then(t => t.includes('sector')));
    await screenshot(page, '04-failure');
    await page.locator('#resultDialog [data-action=retry]').click();
    flights.push(await complete(page)); await page.locator('#resultDialog[open]').waitFor();
    check('retry reaches real finite goal result', flights[0].status === 'landed');
    await screenshot(page, '05-success');
    check('finite grade and record shown', await page.locator('#resultMark').textContent() === 'S' && await page.evaluate(() => JSON.parse(localStorage.getItem('ember-descent.records.v1')).selene > .7));
    for (const id of ['ochre', 'verdant', 'nacre', 'cinder', 'atlas']) {
      await page.locator('#next').click(); await page.waitForFunction(id => window.__sim.stage.id === id, id);
      await screenshot(page, `planet-${id}`); renders.push(await page.evaluate(() => window.__renderStats));
      flights.push(await complete(page)); await page.locator('#resultDialog[open]').waitFor();
      check(`${id} finite browser flight lands`, flights.at(-1).status === 'landed');
    }
    await page.locator('#resultDialog [data-action=menu]').click();
    const recordsBefore = await page.evaluate(() => localStorage.getItem('ember-descent.records.v1'));
    await page.locator('input[value=practice]').check(); await page.locator('#launch').click();
    flights.push(await complete(page)); await page.locator('#resultDialog[open]').waitFor();
    check('practice succeeds with infinity and no rank', await page.locator('#resultMark').textContent() === '∞' && flights.at(-1).fuel === 160);
    check('practice preserves finite records', await page.evaluate(() => localStorage.getItem('ember-descent.records.v1')) === recordsBefore);
    await screenshot(page, '06-practice');
    await page.locator('#resultDialog [data-action=menu]').click(); await page.reload(); await page.locator('#launch:enabled').waitFor();
    check('standard records survive reload', await page.locator('#best').textContent().then(t => t.includes('S /')));
    await page.locator('#clearRecords').click(); check('record deletion works', await page.evaluate(() => localStorage.getItem('ember-descent.records.v1') === null));
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    phone.on('pageerror', e => errors.push(e.message)); await instrument(phone); await phone.goto(base); await phone.locator('#launch:enabled').waitFor();
    await screenshot(phone, '07-mobile-menu');
    check('phone menu has no horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    await phone.locator('[data-stage=nacre]').click(); await phone.locator('#launch').click();
    await screenshot(phone, '08-mobile-flight');
    check('phone rocket is not covered by guidance or controls', await phone.evaluate(() => {
      const canvas = document.querySelector('#scene').getBoundingClientRect();
      const rocketY = canvas.height / 2 + (15 - window.__sim.state.y) / 66 * canvas.height;
      return [...document.querySelectorAll('.guidance,#touch')].every(e => { const r = e.getBoundingClientRect(); return rocketY < r.top || rocketY > r.bottom; });
    }));
    check('phone flight has all instruments and touch buttons', await phone.locator('#touch button').count() === 3 && await phone.locator('#hint').isVisible());
    const main = await phone.locator('[data-control=main]').boundingBox(), right = await phone.locator('[data-control=right]').boundingBox();
    const session = await phone.context().newCDPSession(phone);
    const point = (rect, id) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(main, 1)] });
    await phone.waitForFunction(() => window.__sim.state.y > 9);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(main, 1), point(right, 2)] });
    await phone.waitForFunction(() => window.__input.values().main && window.__input.values().right);
    check('two simultaneous touch engines work', true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    check('touch cancellation releases both engines', await phone.evaluate(() => !window.__input.values().main && !window.__input.values().right));
    await phone.keyboard.down('Space');
    await phone.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('hidden tab pauses and clears input', await phone.evaluate(() => window.__sim.state.paused && !window.__input.values().main));
    await phone.evaluate(() => { delete document.hidden; });
    await phone.keyboard.up('Space');
    await phone.locator('#resume').click();
    await phone.locator('#pause').click(); await phone.locator('#pauseDialog [data-action=retry]').click();
    await phone.evaluate(() => { while (window.__sim.state.y < 43 && window.__sim.state.status === 'flying') window.__sim.step({ main: true }); });
    await phone.waitForTimeout(50);
    check('high-altitude portrait camera keeps rocket below instruments', await phone.evaluate(() => window.__sim.state.y >= 43 && window.__sim.state.status === 'flying'));
    await screenshot(phone, '10-mobile-high-flight');
    await phone.keyboard.press('KeyR');
    await phone.setViewportSize({ width: 844, height: 390 }); await screenshot(phone, '09-mobile-landscape');
    check('landscape buttons remain in viewport', await phone.locator('[data-control=main]').boundingBox().then(b => b.y >= 0 && b.y + b.height <= 390));
    // Load/context/storage/audio denial paths are separate pages, not gameplay state edits.
    const lost = await browser.newPage(); await instrument(lost); await lost.goto(base); await lost.locator('#launch:enabled').waitFor();
    await lost.locator('#mute').click(); await lost.locator('#launch').click(); await lost.keyboard.down('KeyW');
    await lost.waitForFunction(() => window.__gain && window.__gain.gain.value > .01);
    await lost.evaluate(() => document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    check('context loss shows visible reload guidance', await lost.locator('#failure').isVisible());
    await lost.waitForTimeout(250);
    check('context loss silences a running engine', await lost.evaluate(() => window.__gain.gain.value < .001));
    await lost.close();
    const missing = await browser.newPage(); await missing.route('**/vendor/three.core.min.js', r => r.abort()); await missing.goto(base); await missing.locator('#failure').waitFor();
    check('missing required local module is visible', true); await missing.close();
    const noGL = await browser.newPage(); await noGL.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (name, ...rest) { return name === 'webgl2' ? null : get.call(this, name, ...rest); }; });
    await noGL.goto(base); await noGL.locator('#failure').waitFor(); check('WebGL unavailable is visible', true); await noGL.close();
    const restricted = await browser.newPage(); await restricted.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('Denied'); } }); window.AudioContext = class { constructor() { throw Error('Denied'); } }; });
    await restricted.goto(base); await restricted.locator('#launch:enabled').waitFor(); await restricted.locator('#mute').click(); await restricted.locator('#launch').click();
    check('storage/audio unavailable still permits flight', await restricted.locator('#hud').isVisible() && await restricted.locator('#failure').isHidden()); await restricted.close();
    check('no unexpected runtime errors', errors.length === 0);
    check('all runtime requests stay local', requests.every(url => url.startsWith(base)));
    check('rendering bounded below 500 draw calls', renders.every(r => r.calls < 500 && r.geometries < 350));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ checks, flights, renders, errors, browser: await browser.version(), renderer: 'Chromium headless SwiftShader; physical GPU/mobile unverified' }, null, 2) + '\n');
    console.log(`${checks.length} browser checks passed; ${flights.length} input-only browser arrivals; ${errors.length} errors.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
