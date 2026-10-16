/* Synthetic UI only: no application startup, credentials, model requests or database. */
const assert = require('node:assert/strict');
const express = require('express');
const pug = require('pug');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const job = { id: '01234567-89ab-cdef-0123-456789abcdef', type: 'llm.chat', state: 'needs_review', reason: 'remote_outcome_uncertain',
    next_attempt_at: null, created_at: new Date(), attempts: [{ id: 'attempt-1', status: 'outcome_unknown', cleanup: 'uncertain', termination_proven: false }],
    request: { model: 'local-model', messages: [{ role: 'user', content: '<script>window.fixtureUnsafe=true</script>' }], max_tokens: 64 }, result: null };
  const app = express(); app.get('/local-ai/queue/test', (req, res) => res.send(pug.renderFile('views/local_ai_queue.pug', { csrfToken: 'a'.repeat(43), job, jobs: [], config: { enabled: true, auto: false } })));
  app.use(express.static('public'));
  app.post('/local-ai/api/v1/jobs/:id/retry', (req, res) => res.status(409).json({ error: { code: 'replacement_not_safe' } }));
  const server = app.listen(0, '127.0.0.1'); let browser;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:${server.address().port}/local-ai/queue/test`);
      await page.locator('summary').click();
      assert.equal(await page.evaluate(() => !!window.fixtureUnsafe), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('[data-action="retry"]').count(), 0);
      await page.getByText('Retry is unavailable until termination and cleanup are proven.').waitFor();
      await page.screenshot({ path: `/tmp/local-ai-queue-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    process.stdout.write('Queue UI: mobile/desktop layout, escaped frozen input and unavailable unsafe retry passed.\n');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
