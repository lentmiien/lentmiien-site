// Loopback-only synthetic UI fixture. No database, application startup or live inference.
// PLAYWRIGHT_MODULE=/path/to/playwright BOOTSTRAP_CSS=/path/to/bootstrap.min.css node tests/browser/decisions.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createRouter } = require('../../routes/decisions');
const { buildPayload } = require('../../services/decisionsService');
const sharp = require('sharp');

async function main() {
  assert(process.env.BOOTSTRAP_CSS, 'Supply Bootstrap 5.3.3 CSS for accurate layout checks.');
  const app = express();
  app.set('view engine', 'pug'); app.set('views', path.resolve('views'));
  app.use((req, _res, next) => {
    req.user = { _id: 'synthetic-admin', name: 'Synthetic admin', type_user: 'admin' };
    req.isAuthenticated = () => true; req.session = { csrfToken: 'a'.repeat(43) }; next();
  });
  let received;
  app.use('/admin/decisions', createRouter({ reauthorize: async () => {}, roleModel: {}, service: {
    models: async () => ({ models: [{ id: 'liquid-d1-2b-q8', provider: 'local' }, { id: 'd3-mini-q8', provider: 'local' }, { id: 'gpt-6-luna', provider: 'openai', configured: true }] }),
    evaluate: async raw => {
      received = await buildPayload(raw);
      return { model: received.model, answers: raw.questions.map(question => ({ type: question.type, name: question.name || null,
        ...(question.type === 'predicate' ? { probability: 0.95 } : question.type === 'choice' ? { choice: question.choices[0].value, confidence: 0.9 } : { score: 0.8, confidence: 0.85 }) })), usage: { input_tokens: 123, output_tokens: 0 } };
    },
  } }));
  app.use('/css', express.static(path.resolve('public/css')));
  app.use('/js', express.static(path.resolve('public/js')));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css')) return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.BOOTSTRAP_CSS) });
      if (!url.startsWith(origin + '/')) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/admin/decisions`);
    await page.waitForFunction(() => !document.getElementById('run-decision').disabled);
    await page.locator('#decision-input').fill('The customer requests a refund for a duplicate charge.');
    for (const type of ['predicate', 'choice', 'score']) await page.locator(`#add-${type}`).click();
    const questions = page.locator('.question');
    await questions.nth(0).locator('textarea').fill('Does the customer request a refund?');
    await questions.nth(1).locator('textarea').fill('Which department should handle this?');
    await questions.nth(1).locator('.option-row').nth(0).locator('input').nth(0).fill('billing');
    await questions.nth(1).locator('.option-row').nth(1).locator('input').nth(0).fill('technical');
    await questions.nth(2).locator('textarea').fill('Rate the urgency.');
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
    await page.locator('#decision-image').setInputFiles({ name: 'synthetic-red.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => document.getElementById('image-status').textContent.includes('selected.'));
    await page.locator('#run-decision').click();
    await page.waitForFunction(() => document.getElementById('decision-status').textContent === 'Decision request completed.');
    assert.equal(received.input[0].content[1].type, 'input_image');
    assert.equal(await page.locator('.answer').count(), 3);
    const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-layout-'));
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px horizontal overflow`);
      await page.screenshot({ path: path.join(screenshots, `${width}.png`), fullPage: true });
    }
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('run-decision').disabled);
    assert.equal(await page.locator('.answer').count(), 3);
    assert.equal(await page.locator('#decision-image').inputValue(), '');
    const fresh = await context.newPage(); await fresh.goto(`${origin}/admin/decisions`);
    await fresh.waitForFunction(() => !document.getElementById('run-decision').disabled);
    assert.equal(await fresh.locator('#decision-input').inputValue(), '');
    assert.equal(await fresh.locator('.answer').count(), 0);
    await page.locator('#clear-session').click();
    assert.equal(await page.locator('#decision-input').inputValue(), '');
    assert.equal(await page.locator('.answer').count(), 0);
    assert.deepEqual(errors, []);
    process.stdout.write(`Decision UI smoke passed; desktop/mobile screenshots: ${screenshots}\n`);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
