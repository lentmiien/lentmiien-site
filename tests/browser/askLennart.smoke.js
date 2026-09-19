/* Synthetic local UI check; never imports app.js or connects to MongoDB.
 * PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome
 *   node tests/browser/askLennart.smoke.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const pug = require('pug');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const source = [
    '# Review the sample change',
    'Read this **important detail** and *supporting note* before responding.',
    '## Checks\n\n- Inspect the sample\n- Confirm the result\n\n1. Review\n2. Respond',
    '> This is a synthetic request for layout testing.',
    '[Open Codex](/codex/turns/example) and [External reference](https://example.org/guide).',
    `Long URL: https://example.org/${'long-path-segment'.repeat(40)}`,
    `Long word: ${'unbroken'.repeat(80)}`,
    `Inline code: \`${'sample'.repeat(60)}\``,
    '```js\nconst sample = "' + 'long code line '.repeat(40) + '";\n// <script>inert()</script>\n```',
    '| Check | Status |\n| --- | --- |\n| Formatting | Ready |',
    '<img src="/unexpected-image" onerror="alert(1)"><script>alert(1)</script>',
    '[Unsafe](javascript:alert%281%29)',
    'Final paragraph: the response form follows the full request.',
  ].join('\n\n');
  const render = pug.compileFile('views/admin_ask_lennart.pug');
  const writes = [];
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.get('/admin/ask-lennart', (_req, res) => res.send(render({
    pendingRequests: [{ _id: 'synthetic-request', toolName: 'ask_lennart_for_codex', variant: 'codex', prompt: source, createdAt: '2026-09-19T00:00:00Z' }],
    recentRequests: [{ _id: 'synthetic-history', toolName: 'ask_lennart', prompt: '**Historical prompt**', response: '*Historical response*', status: 'responded' }],
    feedback: null, maxResponseChars: 20000, autoRefreshMs: 30000,
    csrfToken: 'synthetic-csrf', loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [],
  })));
  app.post('/admin/ask-lennart/synthetic-request/respond', (req, res) => {
    writes.push(req.body);
    res.send('Synthetic response received');
  });
  app.use('/vendor/dompurify', express.static('node_modules/dompurify/dist'));
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  let browser;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Serve the exact pinned Markdown dependency locally; allow the layout's styles.
    await page.route('https://cdn.jsdelivr.net/npm/marked@18.0.6/lib/marked.umd.js', route => route.fulfill({
      path: path.resolve('node_modules/marked/lib/marked.umd.js'), contentType: 'application/javascript',
    }));
    // Isolate this page from navigation scripts and unrelated layout integrations.
    await page.route(/\/(?:nav|layout)\.js$|bootstrap\.bundle\.min\.js$/, route => route.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.addInitScript(() => {
      window.setInterval = callback => { window.syntheticRefresh = callback; return 42; };
    });
    const url = `http://127.0.0.1:${server.address().port}/admin/ask-lennart`;
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      const prompt = page.locator('[data-pending-prompt]');
      await prompt.locator('h1').waitFor();
      assert.ok(await prompt.locator('strong').isVisible());
      assert.equal(await prompt.locator('img, script, a[href^="javascript:"]').count(), 0);
      assert.equal(await prompt.getByRole('link', { name: 'Open Codex' }).getAttribute('href'), '/codex/turns/example');
      assert.equal(await prompt.getByRole('link', { name: 'External reference' }).getAttribute('rel'), 'noopener noreferrer nofollow');
      const dimensions = await prompt.evaluate(node => ({
        viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
        height: node.clientHeight, scrollHeight: node.scrollHeight, maxHeight: getComputedStyle(node).maxHeight,
        codeWidth: node.querySelector('pre').clientWidth, codeScrollWidth: node.querySelector('pre').scrollWidth,
      }));
      assert.ok(dimensions.page <= dimensions.viewport, `Page overflow at ${width}px: ${JSON.stringify(dimensions)}`);
      assert.equal(dimensions.maxHeight, 'none');
      assert.ok(dimensions.height > 420 && dimensions.scrollHeight <= dimensions.height + 1);
      assert.ok(dimensions.codeScrollWidth > dimensions.codeWidth);
      await prompt.locator('pre').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('[data-pending-prompt] pre').scrollLeft > 0);
      const response = page.locator('[data-human-response-input]');
      await response.focus();
      await page.evaluate(() => { window.syntheticRefresh(); });
      assert.ok(await response.evaluate(node => document.activeElement === node));
      await response.fill('Synthetic response');
      await response.blur();
      await page.evaluate(() => { window.syntheticRefresh(); });
      assert.equal(await response.inputValue(), 'Synthetic response');
      await page.locator('.ask-lennart-history summary').click();
      assert.equal(await page.locator('.ask-lennart-history .ask-lennart-prompt').textContent(), '**Historical prompt**');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/ask-lennart-${width}.png`, fullPage: true });
      console.log(`PASS ${width}px: formatted Markdown, full prompt height, no page overflow, keyboard code scrolling, safe links, retained drafts/history`);
    }
    await Promise.all([
      page.waitForURL('**/synthetic-request/respond'),
      page.getByRole('button', { name: 'Send response' }).click(),
    ]);
    assert.deepEqual(writes, [{ _csrf: 'synthetic-csrf', response: 'Synthetic response' }]);
    await page.goto(url);
    await page.locator('[data-pending-prompt] h1').waitFor();
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => { window.syntheticRefresh(); }),
    ]);
    await page.locator('[data-pending-prompt] h1').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS response submission with CSRF and Markdown after automatic reload; no page errors');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
