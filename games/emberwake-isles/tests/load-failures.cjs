const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const checks = [];
  try {
    const missing = await browser.newPage();
    await missing.route('**/vendor/three.core.min.js', route => route.abort());
    await missing.goto('http://127.0.0.1:8770/');
    await missing.locator('#fatal').waitFor({ state: 'visible' });
    assert.match(await missing.locator('#fatalText').textContent(), /module could not load/);
    checks.push('Missing local dependency shows module fallback, never an endless loading screen');
    await missing.close();
    const context = await browser.newPage();
    await context.goto('http://127.0.0.1:8770/');
    await context.locator('#welcome').waitFor({ state: 'visible' });
    await context.locator('#newGame').click();
    await context.locator('#panel[open]').waitFor();
    await context.locator('#resume').click();
    await context.evaluate(() => document.getElementById('world').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await context.locator('#fatal').waitFor({ state: 'visible' });
    assert.equal(await context.evaluate(() => !!document.pointerLockElement), false);
    checks.push('WebGL context loss pauses play, releases pointer and displays recovery UI');
    await context.close();
    fs.writeFileSync(path.join(__dirname, '../docs/validation/load-failures.json'), JSON.stringify({ checks }, null, 2));
    console.log(checks.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
