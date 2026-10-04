/* Optional browser validation. Pass an installed Playwright module path as the
 * first argument, and a static preview origin as the second. No app/database
 * startup is needed. This script is a development check, not a runtime asset. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.argv[2] || 'playwright');
const physics = require('../../js/physics');
const terrain = require('../../js/terrain');
const origin = process.argv[3] || 'http://127.0.0.1:8095';
const output = process.argv[4] || __dirname;
const initial = physics.createState();
const flight = physics.buildFlight(terrain.height(initial.x, initial.z));

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const options = { headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] };
  const browser = await chromium.launch(options);
  const errors = [], requests = [], checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push(message.text()); });
    page.on('request', request => requests.push(request.url()));
    const ready = async () => {
      await page.goto(`${origin}/moon-landing/`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Begin descent' }).waitFor({ state: 'visible', timeout: 60000 });
    };
    const render = async () => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const shot = async name => {
      await render();
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      process.stdout.write(`Captured ${name}\n`);
    };
    const seek = async seconds => {
      await page.locator('#timeline').fill(seconds.toFixed(1));
      await render();
    };
    await ready();
    assert.equal(await page.locator('#altitude').innerText(), '24.0');
    await shot('01-preview');
    await page.getByRole('button', { name: 'Begin descent' }).click();
    await page.waitForFunction(() => Number(document.getElementById('timeline').value) > .2);
    await page.getByRole('button', { name: 'Pause descent', exact: true }).click();
    const held = await page.locator('#timeline').inputValue();
    await render();
    assert.equal(await page.locator('#timeline').inputValue(), held);
    checks.push('Begin and pause advance, then hold the flight clock.');
    await page.locator('#speed').selectOption('5');
    await page.getByRole('button', { name: 'Play descent', exact: true }).click();
    await page.waitForFunction(t => Number(document.getElementById('timeline').value) > t + 1, Number(held));
    await page.getByRole('button', { name: 'Pause descent', exact: true }).click();
    checks.push('Five-times playback advances and can be paused.');
    await page.locator('[data-phase="approach"]').click();
    await page.waitForFunction(() => document.getElementById('altitude').textContent === '1,000');
    await shot('02-one-kilometre');
    await page.locator('[data-phase="contact"]').click();
    await page.waitForFunction(() => document.getElementById('altitude').textContent === '5.0');
    await shot('03-final-approach');
    await page.locator('[data-camera="surface"]').click();
    await shot('04-surface-approach');
    await seek(flight.contactTime + .35);
    await page.waitForFunction(() => document.getElementById('engineState').textContent === 'ENGINE STOPPED');
    await shot('05-touchdown');
    await seek(flight.contactTime + 3);
    await shot('06-dust-settling');
    await seek(flight.duration - .1);
    await shot('07-at-rest');
    await page.getByRole('button', { name: 'Play descent', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('statusText').textContent.includes('LANDING COMPLETE'));
    assert.equal(await page.locator('#velocity').innerText(), '0.00');
    assert.equal(await page.locator('#throttle').innerText(), '0%');
    assert.equal(await page.getByRole('button', { name: 'Play descent', exact: true }).count(), 1);
    checks.push('Playback reaches stable rest with zero speed and thrust, then stops.');
    await page.getByRole('button', { name: 'Play descent', exact: true }).click();
    await page.waitForFunction(() => Number(document.getElementById('timeline').value) < 2);
    await page.getByRole('button', { name: 'Pause descent', exact: true }).click();
    checks.push('Replay returns from completed landing to the one-kilometre approach.');
    await page.locator('[data-phase="terminal"]').click();
    await page.locator('[data-camera="onboard"]').click();
    await shot('08-onboard');
    await page.locator('[data-camera="wide"]').click();
    await shot('09-wide');
    await page.locator('[data-camera="tracking"]').click();
    const canvas = page.locator('#scene');
    await canvas.focus();
    await page.keyboard.press('h');
    assert.equal(await page.locator('#showInterface').isVisible(), true);
    await page.locator('#showInterface').click();
    await canvas.focus();
    await page.keyboard.press('3');
    assert.equal(await page.locator('[data-camera="surface"]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('r');
    await page.waitForFunction(() => document.getElementById('playLabel').textContent === 'Pause');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#playLabel').innerText(), 'Play');
    checks.push('Keyboard cameras, pause, restart, and instrument visibility work.');
    await page.locator('#notesButton').click();
    assert.equal(await page.locator('#notes').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#notes').isVisible(), false);
    checks.push('Accessible mission notes open and close with Escape.');
    await page.setViewportSize({ width: 390, height: 844 });
    await ready();
    await shot('10-phone');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Begin descent' }).click();
    await page.locator('[data-phase="settled"]').click();
    await shot('11-phone-landed');
    await page.setViewportSize({ width: 844, height: 390 });
    await shot('12-landscape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const telemetryBox = await page.locator('.telemetry').boundingBox();
    const consoleBox = await page.locator('.console').boundingBox();
    assert.ok(telemetryBox.y + telemetryBox.height < consoleBox.y, 'Landscape instruments must clear the playback console.');
    checks.push('Phone portrait and landscape controls fit without horizontal overflow.');
    const blocked = await browser.newPage();
    await blocked.route('**/apollo-lunar-module.glb', route => route.abort());
    await blocked.goto(`${origin}/moon-landing/`);
    await blocked.locator('#failure').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await blocked.locator('#playButton').isDisabled(), true);
    await blocked.close();
    checks.push('Missing model presents the recoverable load error and disables play.');
    const noGpu = await browser.newPage();
    await noGpu.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
        return type.startsWith('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await noGpu.goto(`${origin}/moon-landing/`);
    await noGpu.locator('#failure').waitFor({ state: 'visible' });
    assert.equal(await noGpu.locator('#playButton').isDisabled(), true);
    await noGpu.close();
    checks.push('Unavailable WebGL presents the recoverable graphics error.');
    const external = requests.filter(url => !url.startsWith(`${origin}/`) && !url.startsWith('blob:'));
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    checks.push('No external requests, browser warnings/errors, or persistent browser data.');
    const report = { checks, browser: await browser.version(), viewport: '1440×1000 / 390×844 / 844×390', errors, externalRequests: external, contactTime: flight.contactTime, duration: flight.duration, touchdownSpeed: flight.frames.at(-1).touchdownSpeed, remainingFuel: flight.frames.at(-1).fuel };
    fs.writeFileSync(path.join(output, 'browser-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
