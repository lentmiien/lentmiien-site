// Developer-only instrumentation is injected by Playwright; no test API ships in the app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TREE_GROWTH_URL || 'http://127.0.0.1:8768/';
const output = process.env.TREE_GROWTH_OUTPUT || '/tmp/tree-growth-validation';
const checks = [], errors = [], requests = [], renders = [];
const check = (name, condition) => {
  assert.ok(condition, name); checks.push(name);
  if (checks.length % 10 === 0) console.log(`${checks.length} checks passed: ${name}`);
};

async function instrument(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'TreeGrowth', { configurable: true, set(api) {
      const Original = api.Simulation;
      api.Simulation = class extends Original { constructor(...args) { super(...args); window.__simulation = this; } };
      Object.defineProperty(window, 'TreeGrowth', { value: api, configurable: true });
    } });
  });
  await page.route('**/renderer.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace('this.canvas = canvas;', 'this.canvas = canvas; window.__view = this;') });
  });
}

async function open(page) {
  await instrument(page); await page.goto(base);
  await page.locator('#playButton:enabled').waitFor({ timeout: 60000 });
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, v) => { element.value = v; element.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}

async function inspectRender(page) {
  return page.evaluate(() => {
    const view = window.__view;
    return { calls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles, geometries: view.renderer.info.memory.geometries, textures: view.renderer.info.memory.textures, leafCapacity: view.leaves.instanceMatrix.count, age: window.__simulation.age };
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await open(page);
    check('opens as a paused seed with real WebGL output', await page.evaluate(() => !window.__simulation.playing && window.__simulation.age === 0 && window.__view.renderer.info.render.calls > 0));
    await page.screenshot({ path: path.join(output, '01-seed-desktop.png') });
    await page.locator('#playButton').click();
    await page.waitForFunction(() => window.__simulation.age > .15);
    check('play germinates the seed', await page.locator('#stage').textContent() === 'Seedling');
    await page.locator('#playButton').click();
    const pausedAge = await page.evaluate(() => window.__simulation.age);
    await page.waitForTimeout(200);
    check('pause freezes tree age', await page.evaluate(age => window.__simulation.age === age, pausedAge));
    await range(page, 'speed', 1000);
    check('continuous speed slider reaches 200 years per second while paused', await page.evaluate(() => window.__simulation.speed === 200 && !window.__simulation.playing));
    await page.locator('#playButton').click();
    await page.waitForFunction(age => window.__simulation.age > age + 5, pausedAge);
    await range(page, 'speed', 0);
    check('speed changes while playing without pausing', await page.evaluate(() => window.__simulation.speed === .1 && window.__simulation.playing));
    await page.locator('[data-age="5"]').click();
    check('timeline shortcuts seek and pause', await page.evaluate(() => window.__simulation.age === 5 && !window.__simulation.playing));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, '02-sapling-desktop.png') });
    for (const age of [50, 500, 3000, 0, 500, 50, 3000]) {
      await page.locator(`[data-age="${age}"]`).click();
      await page.waitForFunction(value => window.__view.lastAge === value, age);
      renders.push(await inspectRender(page));
    }
    check('3,000-year tree completes and stays inspectable', await page.locator('#playButton').isDisabled() && await page.locator('#stage').textContent() === 'Ancient giant');
    await page.screenshot({ path: path.join(output, '03-ancient-desktop.png') });
    const box = await page.locator('#scene').boundingBox();
    const theta = await page.evaluate(() => window.__view.theta);
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .65 + 100, box.y + box.height * .4 + 25, { steps: 8 }); await page.mouse.up();
    check('mouse drag rotates around the tree', await page.evaluate(old => window.__view.theta !== old, theta));
    await page.locator('#scene').focus();
    await page.keyboard.press('w');
    check('vertical keyboard control updates the elevation slider', Number(await page.locator('#elevation').inputValue()) > 45);
    await range(page, 'elevation', 85);
    check('elevation slider moves the camera focus', await page.evaluate(() => window.__view.elevation === .85));
    await page.locator('#scene').focus(); await page.keyboard.press('+');
    check('zoom responds to keyboard', await page.evaluate(() => window.__view.zoom < 1));
    await page.locator('#fitButton').click();
    check('reset view restores framing and focus', await page.evaluate(() => window.__view.zoom === 1 && window.__view.elevation === .45 && window.__view.phi === 1.37));
    await page.locator('#raiseButton').click(); await page.locator('#lowerButton').click();
    check('vertical buttons remain usable when growth is complete', await page.evaluate(() => Math.abs(window.__view.elevation - .45) < .00001));
    await page.locator('#zoomInButton').click(); await page.locator('#zoomInButton').click();
    await page.screenshot({ path: path.join(output, '04-bark-detail.png') });
    await page.locator('#fitButton').click();
    await page.locator('#orbitButton').click();
    const orbitTheta = await page.evaluate(() => window.__view.theta);
    await page.waitForFunction(t => window.__view.theta !== t, orbitTheta);
    check('automatic orbit moves without advancing completed age', await page.evaluate(t => window.__view.theta !== t && window.__simulation.age === 3000, orbitTheta));
    await page.locator('#orbitButton').click();
    await range(page, 'timeline', 9990); await range(page, 'speed', 1000);
    await page.locator('#playButton').click();
    await page.waitForFunction(() => window.__simulation.age === 3000);
    check('playback naturally reaches the maximum age and stops', await page.evaluate(() => !window.__simulation.playing));
    await page.locator('#restartButton').click();
    check('new beginning returns to seed and preserves selected speed', await page.evaluate(() => window.__simulation.age === 0 && !window.__simulation.playing && window.__simulation.speed === 200 && window.__view.zoom === 1));
    await range(page, 'speed', 303);
    await page.locator('#scene').focus(); await page.keyboard.press('Space');
    check('Space on scene starts playback', await page.evaluate(() => window.__simulation.playing));
    await page.locator('#aboutButton').click();
    check('field notes pause simulation', await page.evaluate(() => !window.__simulation.playing));
    await page.locator('#aboutTitle').evaluate(element => { element.tabIndex = -1; element.focus(); });
    await page.keyboard.press('Space');
    check('Space does not play through the modal', await page.evaluate(() => !window.__simulation.playing));
    if (await page.locator('#aboutDialog').isVisible()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__simulation.playing);
    check('closing notes resumes previously playing tree', await page.evaluate(() => window.__simulation.playing));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hiddenAge = await page.evaluate(() => window.__simulation.age);
    await page.waitForTimeout(250);
    check('hidden tabs freeze rather than accumulating offline growth', await page.evaluate(age => window.__simulation.age === age, hiddenAge));
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(age => window.__simulation.age > age, hiddenAge);
    check('visible tab resumes normally', true);
    await page.locator('#playButton').click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('[data-age="500"]').click();
    await page.screenshot({ path: path.join(output, '05-laptop.png') });
    check('laptop has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    check('laptop statistics and estimate note fit inside their panel', await page.evaluate(() => document.querySelector('.model-note').getBoundingClientRect().bottom <= document.querySelector('.properties').getBoundingClientRect().bottom));
    await page.close();

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await open(phone); await phone.locator('[data-age="500"]').click();
    await phone.waitForFunction(() => window.__view.lastAge === 500);
    await phone.evaluate(() => scrollTo(0, 0));
    await phone.screenshot({ path: path.join(output, '06-mobile.png'), fullPage: true });
    check('mobile layout has no horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    check('mobile offers touch-accessible playback and property panel', await phone.locator('#playButton').isVisible() && await phone.locator('.properties').isVisible());
    const canvas = await phone.locator('#scene').boundingBox();
    const session = await phone.context().newCDPSession(phone);
    const cx = canvas.x + canvas.width * .45, cy = canvas.y + canvas.height * .57;
    const beforeTouch = await phone.evaluate(() => ({ theta: window.__view.theta, zoom: window.__view.zoom, elevation: window.__view.elevation }));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx, y: cy }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx + 35, y: cy + 10 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check('single-finger orbit works', await phone.evaluate(t => window.__view.theta !== t, beforeTouch.theta));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx - 50, y: cy + 30 }, { id: 2, x: cx + 50, y: cy + 30 }] });
    check('two-finger gesture zooms and raises focus', await phone.evaluate(before => window.__view.zoom < before.zoom && window.__view.elevation > before.elevation, beforeTouch));
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    check('touch cancellation releases all pointers', await phone.evaluate(() => window.__view.pointers.size === 0));
    await phone.locator('#fitButton').click();
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.screenshot({ path: path.join(output, '07-mobile-landscape.png'), fullPage: true });
    check('landscape retains access to controls without horizontal overflow', await phone.evaluate(() => document.documentElement.scrollWidth === innerWidth) && await phone.locator('#playButton').isVisible());
    await phone.close();

    const reduced = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    await open(reduced);
    check('reduced motion disables decorative orbit and wind', await reduced.locator('#orbitButton').isDisabled() && await reduced.evaluate(() => window.__view.wind.value === 0));
    await reduced.locator('[data-age="50"]').click();
    await reduced.waitForFunction(() => window.__view.lastAge === 50);
    check('reduced motion still permits timeline growth', await reduced.locator('#stage').textContent() === 'Young tree');
    await reduced.close();

    const noGl = await browser.newPage();
    await noGl.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (name, ...args) { return name === 'webgl2' ? null : get.call(this, name, ...args); }; });
    await noGl.goto(base); await noGl.locator('#failure').waitFor();
    check('WebGL denial gives visible recovery guidance and disabled growth controls', await noGl.locator('#failureText').textContent().then(text => text.includes('WebGL 2')) && await noGl.locator('#playButton').isDisabled());
    await noGl.close();
    const missing = await browser.newPage();
    await missing.route('**/vendor/three.core.min.js', route => route.abort());
    await missing.goto(base); await missing.locator('#failure').waitFor();
    check('missing local renderer module fails visibly', await missing.locator('#loading').isHidden());
    await missing.close();
    const lost = await browser.newPage(); await open(lost);
    await lost.locator('#playButton').click();
    await lost.evaluate(() => document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    check('context loss stops time and shows reload guidance', await lost.locator('#failure').isVisible() && await lost.evaluate(() => !window.__simulation.playing));
    await lost.close();
    console.log('Render budgets:', JSON.stringify(renders));
    check('geometry and textures remain bounded across repeated scrubbing', renders.every(r => r.geometries === renders[0].geometries && r.textures === renders[0].textures && r.leafCapacity === 20160));
    check('render uses fewer than 50 calls and 200,000 triangles', renders.every(r => r.calls < 50 && r.triangles < 200000));
    check('runtime only requests local assets', requests.every(url => url.startsWith(base)));
    check('no uncaught runtime errors during normal use', errors.length === 0);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ checks, renders, errors, browser: await browser.version(), renderer: 'Headless Chromium with SwiftShader; physical GPU and touch hardware unverified' }, null, 2) + '\n');
    console.log(`${checks.length} browser checks passed; ${errors.length} uncaught errors.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
