/* Optional actual WebGL/UI checks. No production test hooks; fixture instrumentation lives here only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ISLAND_URL || 'http://127.0.0.1:8765/';
const output = path.join(__dirname, '../docs/validation');
const checks = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    const requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'IslandSimulation', {
        configurable: true,
        set(value) {
          const Original = value.Simulation;
          value.Simulation = class extends Original {
            constructor(...args) {
              super(...args);
              window.__driveFixture = this;
            }
          };
          Object.defineProperty(window, 'IslandSimulation', { value, configurable: true });
        },
      });
    });
    await page.goto(base);
    await page.locator('#start:enabled').waitFor({ timeout: 60000 });
    check('WebGL island loads', await page.locator('#failure').isHidden());
    await page.screenshot({ path: path.join(output, '01-selection.png') });
    await page.locator('[data-car="sport"]').click();
    check(
      'Car selection updates',
      (await page.locator('[data-car="sport"]').getAttribute('aria-pressed')) === 'true'
    );
    await page.locator('#welcome').click();
    await page.waitForFunction(() => !document.querySelector('#audioCaption').hidden);
    check(
      'Local narration decodes',
      await page.evaluate(async () => {
        const audio = new Audio('assets/audio/welcome.wav');
        await new Promise((yes, no) => {
          audio.onloadedmetadata = yes;
          audio.onerror = no;
          audio.load();
        });
        return audio.duration > 11 && audio.duration < 13;
      })
    );
    await page.locator('[data-car="rover"]').click();
    await page.locator('#start').click();
    await page.waitForTimeout(800);
    const townShot = await page.screenshot({ path: path.join(output, '02-town-drive.png') });
    const pixels = await sharp(townShot).removeAlpha().raw().toBuffer();
    let black = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 8) black++;
    check(
      'Terrain renders with visible colour instead of a black texture',
      black / (pixels.length / 3) < 0.15
    );
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1800);
    await page.keyboard.up('ArrowUp');
    check('Keyboard accelerates car', Number(await page.locator('#speed').innerText()) > 5);
    await page.keyboard.press('KeyP');
    const paused = await page.evaluate(() => window.__driveFixture.state.elapsed);
    await page.waitForTimeout(300);
    check(
      'Pause freezes simulation',
      (await page.evaluate(() => window.__driveFixture.state.elapsed)) === paused
    );
    await page.locator('#help').click();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
    check(
      'Pause shortcut cannot resume behind the help modal',
      await page.evaluate(() => window.__driveFixture.state.paused)
    );
    check(
      'Help displays scoring rule',
      (await page.locator('#helpDialog').innerText()).includes('5 per collision')
    );
    await page.locator('#closeHelp').click();
    await page.locator('#pauseMap').click();
    await page.screenshot({ path: path.join(output, '03-island-map.png') });
    await page.locator('#closeMap').click();
    await page.locator('#resume').click();
    // Move the instrumented instance to an actual authored highland road to inspect terrain/camera.
    await page.evaluate(() => {
      const sim = window.__driveFixture;
      const r = sim.world.roads.find((r) => r.name === 'North ridge');
      const a = r.points[Math.floor(r.points.length * 0.7)],
        b = r.points[Math.floor(r.points.length * 0.7) + 1];
      Object.assign(sim.state, {
        x: a.x,
        z: a.z,
        heading: Math.atan2(b.x - a.x, b.z - a.z),
        speed: 0,
        vx: 0,
        vz: 0,
      });
    });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(output, '04-highland-drive.png') });
    await page.evaluate(() => {
      const sim = window.__driveFixture;
      const r = sim.world.roads[0];
      const a = r.points.find((p) => p.x > 790 && p.z > 0);
      const i = r.points.indexOf(a),
        b = r.points[i + 1];
      Object.assign(sim.state, {
        x: a.x,
        z: a.z,
        heading: Math.atan2(b.x - a.x, b.z - a.z),
        speed: 0,
        vx: 0,
        vz: 0,
      });
    });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(output, '05-coast-drive.png') });
    // Check the complete water -> summary -> restart UI using the real simulation.
    await page.evaluate(() => {
      const s = window.__driveFixture.state;
      s.x = 1230;
      s.z = 0;
      s.speed = 2;
      s.vx = 2;
      s.vz = 0;
    });
    await page.locator('#endDialog[open]').waitFor();
    check(
      'Water shows session summary',
      (await page.locator('#endStats').innerText()).includes('On-road distance')
    );
    await page.screenshot({ path: path.join(output, '06-water-summary.png') });
    await page.locator('#again').click();
    check(
      'Restart clears distance and collisions',
      await page.evaluate(() => {
        const s = window.__driveFixture.state;
        return s.distance === 0 && s.collisions === 0 && s.collected === 0 && !s.ended;
      })
    );
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('Focus loss pauses', await page.locator('#pauseDialog').isVisible());
    await page.locator('#resume').click();
    await page.locator('#sound').click();
    check(
      'Optional synthesized engine can be enabled',
      (await page.locator('#sound').getAttribute('aria-pressed')) === 'true'
    );
    check('No page script errors', errors.length === 0);
    check(
      'All requests stay local',
      requests.every((url) => url.startsWith(base))
    );
    // A required missing asset must produce a readable error.
    const missing = await browser.newPage();
    await missing.route('**/assets/images/terrain.png', (route) => route.abort());
    await missing.goto(base);
    await missing.locator('#failure:not([hidden])').waitFor();
    check('Missing texture fails visibly', await missing.locator('#failureMessage').isVisible());
    await missing.close();
    const noGL = await browser.newPage();
    await noGL.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : get.call(this, type, ...args);
      };
    });
    await noGL.goto(base);
    await noGL.locator('#failure:not([hidden])').waitFor();
    check('Missing WebGL fails visibly', await noGL.locator('#failureMessage').isVisible());
    await noGL.close();
    await page.close();
    // New contexts ensure touch/viewport behavior is checked independently.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const phone = await mobile.newPage();
    await phone.goto(base);
    await phone.locator('#start:enabled').waitFor({ timeout: 60000 });
    await phone.screenshot({ path: path.join(output, '07-mobile-selection.png') });
    await phone.locator('#start').click();
    check('Touch controls are visible', await phone.locator('#touchControls').isVisible());
    check(
      'Mobile has no horizontal overflow',
      await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    );
    const pedal = await phone.locator('[data-input="forward"]').boundingBox();
    const cdp = await mobile.newCDPSession(phone);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: pedal.x + pedal.width / 2, y: pedal.y + pedal.height / 2 }],
    });
    await phone.waitForFunction(
      () => Number(document.querySelector('#speed').textContent) > 5,
      {},
      { timeout: 10000 }
    );
    check(
      'Holding the touch accelerator moves the car',
      Number(await phone.locator('#speed').innerText()) > 5
    );
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(
      'Touch release clears the pressed state',
      !((await phone.locator('[data-input="forward"]').getAttribute('class')) || '').includes(
        'pressed'
      )
    );
    check('Mobile game has no failure overlay', await phone.locator('#failure').isHidden());
    await phone.screenshot({ path: path.join(output, '08-mobile-drive.png') });
    await phone.locator('#pause').tap();
    check('Touch pause is usable', await phone.locator('#pauseDialog').isVisible());
    await mobile.close();
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify(
        {
          checks: checks.length,
          passed: checks,
          errors,
          renderer: 'Chromium / SwiftShader WebGL2',
          viewport: '1440 × 1000 and 390 × 844',
        },
        null,
        2
      ) + '\n'
    );
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
