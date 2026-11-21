// Run with PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, BOOTSTRAP_CSS and BOOTSTRAP_JS
// pointing to local Playwright, Chromium and the layout's Bootstrap 5.3.3 assets.
const assert = require('node:assert/strict');
const path = require('node:path');
const pug = require('pug');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    _id: String(i + 1).padStart(24, '0'), user_id: 'tester', contentType: 'text',
    content: { text: 'Training message ' + i }, timestamp: new Date(0),
  }));
  const html = pug.renderFile('views/chat5_chat.pug', {
    conversation: { _id: 'a'.repeat(24), title: 'Dialog regression', tags: [], members: ['tester'],
      messages: messages.map(m => m._id), metadata: { model: 'test', tools: [] } },
    conversationSource: 'conversation5', messages, chat_models: [], templates: [],
    trainingGroups: [{ groupId: 'test' }], permissions: [], bookmarks: [], htmlPaths: [],
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname.endsWith('/bootstrap.min.css')) return route.fulfill({ path: process.env.BOOTSTRAP_CSS });
      if (url.pathname.endsWith('/bootstrap.bundle.min.js')) return route.fulfill({ path: process.env.BOOTSTRAP_JS });
      if (url.hostname === 'fixture.test' && url.pathname.startsWith('/css/')) {
        return route.fulfill({ path: path.join('public', url.pathname) });
      }
      return route.abort();
    });
    const touch = await page.context().newCDPSession(page);
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.goto('https://fixture.test/fixture');
      for (const [label, id, target] of [
        ['Settings', 'chat5Settings', '#members'],
        ['Add to training', 'chat5Training', '#chat5TrainingSubmit'],
      ]) {
        await page.getByRole('button', { name: label, exact: true }).tap();
        const dialog = page.locator('#' + id);
        const body = dialog.locator('.modal-body');
        await body.waitFor({ state: 'visible' });
        const box = await body.boundingBox();
        assert(box.y >= 0 && box.y + box.height <= viewport.height + 1, label + ' body fits on screen');
        const x = Math.round(box.x + 6);
        const start = Math.round(box.y + box.height * 0.8);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
        for (let i = 1; i <= 5; i++) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start - 20 * i }] });
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(id => document.querySelector('#' + id + ' .modal-body').scrollTop > 0, id);
        await dialog.locator(target).scrollIntoViewIfNeeded();
        const reachable = await dialog.locator(target).evaluate(el => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        });
        assert(reachable, label + ' lower control is reachable');
        await dialog.locator('.modal-header .btn-close').tap();
        await dialog.waitFor({ state: 'hidden' });
      }
    }
    console.log('Settings and training dialogs support touch scrolling in portrait and landscape.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
