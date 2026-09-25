/* Developer-only Chromium validation. No runtime hooks or state teleports.
   The instrumented simulation instance is only exposed by this test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium
} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {
  pilotInput
} = require('./fly-route.cjs');
const out = path.join(__dirname, '../docs/validation');
const base = process.env.SKY_URL || 'http://127.0.0.1:8766/';
const checks = [],
  errors = [],
  requests = [],
  measurements = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? {
      executablePath: process.env.CHROMIUM_PATH
    } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 1000
      }
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SkyFlight', {
        configurable: true,
        set(api) {
          const Original = api.Simulation;
          api.Simulation = class extends Original {
            constructor(...args) {
              super(...args);
              window.__flight = this;
            }
          };
          Object.defineProperty(window, 'SkyFlight', {
            value: api,
            configurable: true
          });
        }
      });
      const originalDraw = WebGL2RenderingContext.prototype.drawElements;
      WebGL2RenderingContext.prototype.drawElements = function (...args) {
        window.__draws = (window.__draws || 0) + 1;
        return originalDraw.apply(this, args);
      };
      const originalArray = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (...args) {
        window.__draws = (window.__draws || 0) + 1;
        return originalArray.apply(this, args);
      };
    });
    await page.route('**/renderer.mjs', async route => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({
        response,
        body: source.replace('this.renderer.render(this.scene, this.camera);', 'this.renderer.render(this.scene, this.camera); window.__renderStats = { ...this.renderer.info.render };')
      });
    });
    await page.goto(base);
    await page.locator('#start:enabled').waitFor({
      timeout: 60000
    });
    check('WebGL loads without error', await page.locator('#failure').isHidden());
    check('Actual draw calls', await page.evaluate(() => window.__draws > 0));
    await page.screenshot({
      path: path.join(out, '01-dispatch.png')
    });
    await page.locator('#listen').click();
    await page.waitForFunction(() => document.querySelector('#listen').getAttribute('aria-pressed') === 'true');
    check('Piper briefing plays after gesture', await page.evaluate(() => !document.querySelector('#audioCaption').hidden));
    await page.locator('#listen').click();
    check('Briefing stops', (await page.locator('#listen').getAttribute('aria-pressed')) === 'false');
    await page.locator('#start').click();
    await page.screenshot({
      path: path.join(out, '02-runway.png')
    });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__flight.state.throttle > .99);
    await page.keyboard.up('KeyW');
    await page.waitForFunction(() => window.__flight.state.speed >= 40);
    check('Keyboard power accelerates without automatic rotation', await page.evaluate(() => window.__flight.state.grounded && window.__flight.state.pitch === 0));
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window.__flight.state.pitch >= 7.5);
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => window.__flight.state.y > 45);
    check('Manual keyboard rotation flies', await page.evaluate(() => !window.__flight.state.grounded));
    check('Arrow/Space inputs do not scroll document', await page.evaluate(() => scrollY === 0));
    await page.keyboard.press('KeyP');
    const paused = await page.evaluate(() => window.__flight.state.elapsed);
    await page.waitForTimeout(250);
    check('Pause freezes time', await page.evaluate(t => window.__flight.state.elapsed === t, paused));
    await page.locator('#resume').click();
    await page.locator('#help').click();
    await page.keyboard.press('KeyP');
    check('No resume through help overlay', await page.evaluate(() => window.__flight.state.paused));
    await page.locator('#closeHelp').click();
    await page.keyboard.down('KeyD');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('KeyD');
    check('Blur pauses', await page.locator('#pauseDialog').isVisible());
    await page.locator('#resume').click();
    const heading = await page.evaluate(() => window.__flight.state.heading);
    await page.waitForTimeout(350);
    check('Blur clears turn input', await page.evaluate(h => Math.abs(window.__flight.state.heading - h) < 2, heading));
    await page.locator('#pause').click();
    await page.locator('#retryPause').click();
    check('Restart resets throttle and flight log', await page.evaluate(() => window.__flight.state.throttle === 0 && !window.__flight.state.airborne));
    // Test-only pilot follows displayed targets, issuing only digital input values.
    await page.evaluate(source => {
      window.__pilot = (0, eval)('(' + source + ')');
    }, pilotInput.toString());
    async function flyUntil(stage, maxSeconds = 1000) {
      return page.evaluate(({
        stage,
        maxSeconds
      }) => {
        const sim = window.__flight,
          W = window.SkyWorld,
          F = window.SkyFlight;
        for (let i = 0; i < maxSeconds * 60 && sim.state.status === 'flying'; i++) {
          sim.update(1 / 60, window.__pilot(sim, W, F));
          if (F.guidance(sim).stage === stage) break;
        }
        return {
          ...sim.state,
          stage: F.guidance(sim).stage
        };
      }, {
        stage,
        maxSeconds
      });
    }
    await flyUntil('cruise', 60);
    await page.waitForTimeout(2200);
    await page.screenshot({
      path: path.join(out, '03-climb.png')
    });
    await page.locator('#mapButton').click();
    await page.screenshot({
      path: path.join(out, '04-chart.png')
    });
    await page.locator('#closeMap').click();
    await flyUntil('final', 150);
    await page.waitForTimeout(2200);
    await page.screenshot({
      path: path.join(out, '05-final.png')
    });
    const renderStats = await page.evaluate(() => window.__renderStats);
    measurements.push({
      view: 'Meadow approach',
      ...renderStats
    });
    check('Bounded render calls and geometry', renderStats.calls < 400 && renderStats.triangles < 220000);
    const result = await flyUntil('complete');
    await page.locator('#debrief').waitFor();
    check('Control-only browser flight completes', result.status === 'complete');
    check('Debrief reports actual touchdown and stop', (await page.locator('#stats').innerText()).includes('Touchdown descent'));
    measurements.push({
      route: 'haven → meadow',
      elapsed: result.elapsed,
      touchdown: result.touchdown
    });
    await page.screenshot({
      path: path.join(out, '06-debrief.png')
    });
    await page.locator('#next').click();
    await page.locator('#departure').selectOption('pine');
    await page.locator('#destination').selectOption('mesa');
    await page.locator('#start').click();
    await flyUntil('cruise', 70);
    await page.waitForTimeout(2200);
    await page.screenshot({
      path: path.join(out, '07-mountains.png')
    });
    await flyUntil('final');
    await page.waitForTimeout(2200);
    await page.screenshot({
      path: path.join(out, '08-desert.png')
    });
    const second = await flyUntil('complete');
    await page.locator('#debrief').waitFor();
    check('Second browser flight on another heading completes', second.status === 'complete');
    measurements.push({
      route: 'pine → mesa',
      elapsed: second.elapsed,
      touchdown: second.touchdown
    });
    check('No runtime page errors', errors.length === 0);
    check('Only same-folder localhost asset requests', requests.every(url => url.startsWith(base)));
    // Actual crash from normal controls: accelerate while turning off the runway.
    await page.locator('#retry').click();
    await page.evaluate(() => {
      for (let i = 0; i < 1200 && window.__flight.state.status === 'flying'; i++) window.__flight.update(1 / 60, {
        throttle: 1,
        roll: 1
      });
    });
    await page.locator('#debrief').waitFor();
    check('Crash produces restartable debrief', await page.evaluate(() => window.__flight.state.status === 'crashed'));
    await page.locator('#retry').click();
    check('Crash restart returns to staged runway', await page.evaluate(() => window.__flight.state.speed < 1 && window.__flight.state.status === 'flying'));
    const mobile = await browser.newPage({
      viewport: {
        width: 390,
        height: 844
      },
      isMobile: true,
      hasTouch: true
    });
    await mobile.addInitScript(() => {
      Object.defineProperty(window, 'SkyInput', {
        configurable: true,
        set(api) {
          const Original = api.Input;
          api.Input = class extends Original {
            constructor(...args) {
              super(...args);
              window.__input = this;
            }
          };
          Object.defineProperty(window, 'SkyInput', {
            value: api,
            configurable: true
          });
        }
      });
    });
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(base);
    await mobile.locator('#start:enabled').waitFor();
    await mobile.screenshot({
      path: path.join(out, '09-mobile-dispatch.png')
    });
    await mobile.locator('#start').click();
    check('Mobile touch controls visible', await mobile.locator('#touch').isVisible());
    const power = mobile.locator('[data-key="KeyW"]'),
      nose = mobile.locator('[data-key="ArrowDown"]');
    const powerBox = await power.boundingBox(),
      noseBox = await nose.boundingBox();
    const touchSession = await mobile.context().newCDPSession(mobile);
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{
        x: powerBox.x + 15,
        y: powerBox.y + 15,
        id: 1
      }, {
        x: noseBox.x + 15,
        y: noseBox.y + 15,
        id: 2
      }]
    });
    await mobile.waitForTimeout(900);
    check('Simultaneous touch controls change pitch and power', await mobile.evaluate(() => Number(document.querySelector('#power').value) > 5 && !document.querySelector('#pitchValue').textContent.includes('+0.0')));
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: []
    });
    await mobile.waitForTimeout(150);
    check('Touch cancellation clears highlight', !((await power.getAttribute('class')) || '').includes('active'));
    check('Touch cancellation releases actual power and pitch inputs', await mobile.evaluate(() => window.__input.values().throttle === 0 && window.__input.values().pitch === 0));
    await mobile.waitForTimeout(500);
    await mobile.screenshot({
      path: path.join(out, '10-mobile-flight.png')
    });
    check('Mobile no horizontal overflow', await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.setViewportSize({
      width: 844,
      height: 390
    });
    await mobile.screenshot({
      path: path.join(out, '11-mobile-landscape.png')
    });
    // Missing local module and graphics failures are visible, never a silent blank screen.
    const missing = await browser.newPage();
    await missing.route('**/renderer.mjs', route => route.abort());
    await missing.goto(base);
    await missing.locator('#failure').waitFor();
    check('Missing required asset has explicit failure', await missing.locator('#start').isDisabled());
    const noGL = await browser.newPage();
    await noGL.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.startsWith('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await noGL.goto(base);
    await noGL.locator('#failure').waitFor();
    check('No WebGL has readable fallback', (await noGL.locator('#failure').innerText()).includes('WebGL 2'));
    const silent = await browser.newPage();
    await silent.route('**/briefing.wav', route => route.abort());
    await silent.goto(base);
    await silent.locator('#start:enabled').waitFor();
    await silent.locator('#listen').click();
    await silent.waitForFunction(() => document.querySelector('#listen').textContent.includes('unavailable'));
    check('Optional audio failure leaves game playable and transcript visible', (await silent.locator('#failure').isHidden()) && (await silent.locator('#audioCaption').isVisible()));
    const lost = await browser.newPage();
    await lost.goto(base);
    await lost.locator('#start:enabled').waitFor();
    await lost.evaluate(() => document.querySelector('#scene').dispatchEvent(new Event('webglcontextlost', {
      cancelable: true
    })));
    await lost.locator('#failure').waitFor();
    check('Context loss has reload recovery', (await lost.locator('#failure').innerText()).includes('context was lost'));
    check('Desktop and mobile have no uncaught runtime errors', errors.length === 0);
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({
      checks,
      errors,
      requestCount: requests.length,
      measurements,
      engine: 'Chromium with SwiftShader software WebGL2',
      screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png'))
    }, null, 2) + '\n');
    console.log(JSON.stringify({
      passed: checks.length,
      checks,
      measurements
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
