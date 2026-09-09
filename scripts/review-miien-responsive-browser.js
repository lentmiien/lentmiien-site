// Synthetic responsive QA: real room/assets on loopback, no app/database/providers.
// Usage: node scripts/review-miien-responsive-browser.js <playwright> <chromium> [output-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const pug = require('pug');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || '/tmp/miien-responsive-review');
const id = 'a'.repeat(24);
const html = pug.renderFile(path.join(root, 'views/miien_room.pug'), {
  conversation: { _id: id, title: 'Phone layout review' },
  moods: ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised'],
  canWrite: true, canTranscribe: true, canSynthesize: true, csrfToken: 'synthetic-token',
});
const reply = 'A saved synthetic reply. Full captions and history stay readable. ';
const server = http.createServer((req, res) => {
  if (req.url === `/chat5/miien/${id}/state`) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ pending: false, messages: [{ id: 'c'.repeat(24), role: 'assistant', text: reply, mood: 'neutral' }] }));
  }
  if (req.url === `/chat5/miien/${id}`) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.end(html);
  }
  if (/^\/(?:js\/miien[a-z_]*\.js|css\/(?:miien|color-theme)\.css|i\/miien\/[a-z0-9_./-]+)$/.test(req.url) && !req.url.includes('..')) {
    const file = root + '/public' + req.url;
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' }[path.extname(file)];
    if (type && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('Content-Type', type); return fs.createReadStream(file).pipe(res); }
  }
  res.statusCode = 404; res.end();
});
let browser;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const { chromium } = require(process.argv[2] || 'playwright');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true, args: ['--no-sandbox'] });
  const errors = [], results = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security')) errors.push(message.text()); });
  // Stub only permission: never acquire a physical microphone or issue ASR/TTS.
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chat5/miien/${id}`);
  await page.waitForFunction(() => !document.querySelector('#send').disabled && !!document.querySelector('.character-layers'));
  const snapshot = async (name, { mobile = true, minPortrait = 60 } = {}) => {
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, visible: getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' };
      };
      const art = document.querySelector('.character-layers') ? '.character-layers' : '#character';
      return { room: rect('#miien-room'), art: rect(art), bottom: rect('.call-bottom'), composer: rect('.composer'), caption: rect('#latest-reply'),
        controls: ['#message', '#send', '#mic', '#replay', '#stop', '#captions-toggle', '.transcript summary', '.voice-options summary'].map(rect),
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        scrollY, focus: document.activeElement.id };
    });
    await page.screenshot({ path: path.join(output, name + '.png') });
    fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(geometry, null, 2));
    assert.equal(geometry.overflow, false, `${name}: document overflow`);
    assert.equal(geometry.scrollY, 0, `${name}: page scrolled`);
    assert.equal(geometry.art.visible, true, `${name}: hidden portrait`);
    if (mobile) {
      assert.ok(geometry.art.height >= minPortrait, `${name}: portrait only ${geometry.art.height}px`);
      const beside = geometry.art.right <= geometry.bottom.x + 1;
      assert.ok(beside || geometry.art.bottom <= geometry.bottom.y + 1, `${name}: portrait/composer overlap`);
      assert.ok(geometry.composer.height <= 185, `${name}: composer ${geometry.composer.height}px`);
    }
    for (const control of geometry.controls) {
      assert.ok(control.x >= 0 && control.right <= geometry.room.right + 1, `${name}: horizontal control overflow`);
      assert.ok(control.y >= geometry.room.y - 1 && control.bottom <= geometry.room.bottom + 1, `${name}: vertical control overflow`);
      if (mobile) assert.ok(control.height >= 44, `${name}: target height ${control.height}px`);
    }
    results.push({ name, ...geometry });
  };
  for (const [name, width, height] of [['phone', 390, 844], ['small-phone-tall', 320, 640], ['small-phone', 320, 568], ['keyboard', 390, 350], ['small-keyboard', 320, 284], ['landscape', 844, 390], ['small-landscape', 667, 320], ['landscape-keyboard', 844, 200]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#message').fill('A draft that stays editable');
    await page.waitForTimeout(80);
    await snapshot(name);
  }
  // Resize while keeping the same focused textarea, selection and internal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#message').fill('An editable line\n'.repeat(80));
  await page.evaluate(() => { const input = document.querySelector('#message'); input.setSelectionRange(1000, 1004); input.scrollTop = 600; });
  const before = await page.locator('#message').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop }));
  for (const height of [650, 500, 390, 350, 390, 600, 844]) {
    await page.setViewportSize({ width: 390, height }); await page.waitForTimeout(50);
    assert.equal(await page.locator('#message').evaluate(el => document.activeElement === el), true);
    assert.deepEqual(await page.locator('#message').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop })), before);
  }
  results.push({ name: 'focused-resize-selection-scroll', passed: true });
  // Safari-style keyboard: visual viewport shrinks/pans while layout viewport remains tall.
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 390, height: 360, offsetTop: 35, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(80); await snapshot('visual-keyboard');
  await page.locator('#message').evaluate(el => el.blur());
  const afterBlur = await page.locator('.composer').boundingBox();
  await page.locator('#message').focus();
  assert.deepEqual(await page.locator('.composer').boundingBox(), afterBlur);
  results.push({ name: 'focus-blur-stable-composer', passed: true });
  await page.evaluate(() => {
    document.querySelector('#latest-reply').textContent = 'Long caption with no loss of text. '.repeat(300) + 'x'.repeat(300);
    document.querySelector('#speech-status').textContent = 'Synthetic voice failure with guidance. '.repeat(50);
    document.querySelector('#mic-status').textContent = 'Synthetic microphone status. '.repeat(20);
    for (let i = 0; i < 30; i++) {
      const row = document.createElement('p'); row.textContent = 'Older synthetic history entry ' + i;
      document.querySelector('#history').append(row);
    }
  });
  await snapshot('long-caption-status');
  for (const selector of ['#latest-reply', '.composer-status']) {
    await page.locator(selector).focus();
    await page.keyboard.press('End');
    await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, selector);
    assert.ok(await page.locator(selector).evaluate(el => el.scrollHeight > el.clientHeight && el.scrollTop > 0), selector + ' must scroll');
  }
  for (const label of ['History', 'Settings']) {
    await page.getByText(label, { exact: true }).click();
    const drawer = page.locator('details[open] .drawer');
    assert.equal(await drawer.isVisible(), true);
    const box = await drawer.boundingBox(), room = await page.locator('#miien-room').boundingBox();
    assert.ok(box.y >= room.y && box.y + box.height <= room.y + room.height + 1);
    await page.screenshot({ path: path.join(output, 'keyboard-' + label.toLowerCase() + '.png') });
    if (label === 'History') {
      await page.locator('#history').focus(); await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('.transcript .drawer').scrollTop > 0);
    }
    if (label === 'Settings') {
      await page.locator('#motion-enabled').uncheck(); // Scroll to lower settings controls.
      assert.equal(await page.locator('#motion-enabled').isChecked(), false);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('details[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), label);
    results.push({ name: 'keyboard-' + label.toLowerCase(), passed: true });
  }
  await page.locator('#captions-toggle').click();
  assert.equal(await page.locator('#captions').isVisible(), false);
  await page.locator('#captions-toggle').click();
  assert.equal(await page.locator('#captions').isVisible(), true);
  await page.locator('#mic').click();
  assert.equal(await page.locator('#mic').textContent(), 'Requesting microphone…');
  await snapshot('keyboard-mic-permission');
  await page.locator('#mic').evaluate(el => { el.textContent = 'Stop & transcribe'; });
  await snapshot('keyboard-recording-label');
  await page.locator('#stop').click();
  assert.equal(await page.locator('#mic').textContent(), 'Microphone');
  // Fresh desktop restores native viewport and display defaults.
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  await snapshot('desktop', { mobile: false });
  await page.getByText('Settings', { exact: true }).click();
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.keyboard.press('Escape');
  await snapshot('desktop-fullscreen', { mobile: false });
  await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.waitForTimeout(80); await snapshot('desktop-short', { mobile: false });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks: results.length, errors, results }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: results.length, errors, output }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
