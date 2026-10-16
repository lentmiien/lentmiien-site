/* Rendered production template/scripts, synthetic content, intercepted network only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pug = require('pug');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { parseSubmission } = require('../../services/localAi/policy');
(async () => {
  const id = '0123456789abcdef01234567';
  const model = { api_model: 'smollm2:360m', model_name: 'smollm2:360m', provider: 'Local' };
  const html = pug.renderFile('views/chat5_chat.pug', {
    loggedIn: true, permissions: ['chat5'], bookmarks: [], htmlPaths: [],
    conversation: { _id: `  ${id}  `, title: 'Synthetic batch regression', summary: '', category: 'test', tags: [], members: ['test'], messages: [],
      metadata: { model: model.api_model, contextPrompt: '', maxMessages: 25, tools: [], reasoning: 'none', mode: 'standard', verbosity: 'medium', outputFormat: 'text' } },
    conversationSource: 'conversation5', messages: [], chat_models: [model], templates: [], personalities: [], responseTypes: [], ttsVoices: {},
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage(); const submissions = []; const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.io = () => ({ on() {}, emit() {} });
      window.toastui = { Editor: class { on() {} getMarkdown() { return 'synthetic prompt'; } } };
      window.bootstrap = { Modal: class {}, Tooltip: class {}, Tab: { getOrCreateInstance: () => ({ show() {} }) } };
    });
    await page.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: html });
      if (['/js/chat5_5.js', '/js/local-ai-client.js', '/js/local-ai-integrations.js'].includes(pathname)) {
        return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('public' + pathname, 'utf8') });
      }
      if (pathname === '/local-ai/api/v1/config') return route.fulfill({ json: { enabled: true, ownerId: 'synthetic', csrfToken: 'synthetic-csrf' } });
      if (pathname === '/local-ai/api/v1/jobs') {
        submissions.push(route.request().postDataJSON());
        return route.fulfill({ status: 202, json: { id: 'job', url: '/local-ai/queue/job' } });
      }
      return route.fulfill({ contentType: pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    });
    await page.goto('https://fixture.test/fixture');
    assert.equal(await page.locator('#id').evaluate(el => el.tagName), 'P');
    await page.getByRole('button', { name: 'Queue local batch', exact: true }).click();
    await page.getByText('Durably queued.').waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].conversation_id, id);
    assert.equal(submissions[0].settings.model, model.api_model);
    parseSubmission(submissions[0]);
    await page.locator('#id').evaluate(el => { el.textContent = 'NEW'; });
    await page.getByRole('button', { name: 'Queue local batch', exact: true }).click();
    await page.getByText('Save this conversation before batching.').waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(await page.locator('#localAiChatBatch').isDisabled(), true);
    assert.deepEqual(errors, []);
    process.stdout.write('Chromium: actual Chat5 template, scripts, click, trimmed payload and NEW denial passed; all network intercepted.\n');
  } finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
