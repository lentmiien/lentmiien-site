// Optional offline browser QA. Pass installed Playwright module and Chromium paths.
// Serves only synthetic state and allowlisted static assets on loopback.
const fs = require('fs');
const path = require('path');
const http = require('http');
const root = path.resolve(__dirname, '..');
const pug = require('pug');
const output = root + '/documentation/assets/miien-expressions-v1';
const id = 'a'.repeat(24);
const html = pug.renderFile(root + '/views/miien_room.pug', {
  conversation: {
    _id: id,
    title: 'A moment with Miien'
  },
  moods: ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised'],
  canWrite: true,
  canTranscribe: true,
  canSynthesize: true,
  csrfToken: 'synthetic-review-token'
});
const state = {
  pending: false,
  messages: [{
    id: 'c'.repeat(24),
    role: 'assistant',
    text: 'Hello, Lennart. Take your time — I’m here when you’re ready.',
    mood: 'neutral'
  }]
};
const server = http.createServer((req, res) => {
  if (req.url.endsWith('/state')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(state));
  }
  if (req.url === '/chat5/miien/' + id) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Content-Type', 'text/html');
    return res.end(html);
  }
  if (/^\/(?:js\/miien[a-z_]*\.js|css\/(?:miien|color-theme)\.css|i\/miien\/[a-z0-9_./-]+)$/.test(req.url) && !req.url.includes('..')) {
    const target = root + '/public' + req.url;
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' }[path.extname(target)];
    if (type && fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.setHeader('Content-Type', type);
      return fs.createReadStream(target).pipe(res);
    }
  }
  res.statusCode = 404;
  res.end();
});
let browser;
(async () => {
  const { chromium } = require(process.argv[2] || 'playwright');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({
    executablePath: process.argv[3],
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1000
    }
  });
  const artRequests = [];
  page.on('request', r => {
    if (r.url().includes('/i/miien/')) artRequests.push(r.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && m.text().includes('Content Security')) errors.push(m.text());
  });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(...args) {
        super(...args);
        window.fixtureAudio = this;
      }
    };
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/chat5/miien/' + id);
  await page.locator('.miien-rig').waitFor();
  if (artRequests.some(url => /(?:happy|thoughtful|concerned|surprised)-v1/.test(url))) throw Error('Unselected large variants eagerly requested');
  await page.screenshot({
    path: output + '/review-desktop.png'
  });
  // Freeze only idle CSS to capture each facial replacement independently.
  const before = await page.locator('.miien-rig').evaluate(e => getComputedStyle(e).transform);
  await page.waitForTimeout(1400);
  const after = await page.locator('.miien-rig').evaluate(e => getComputedStyle(e).transform);
  if (before === after) throw Error('Breathing clock stopped');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.miien-blink')).opacity === '1');
  await page.evaluate(() => document.getAnimations().forEach(a => {
    a.pause();
    a.currentTime = 0;
  }));
  await page.evaluate(() => {
    document.querySelector('.miien-blink').getAnimations()[0].currentTime = 3100;
  });
  await page.screenshot({
    path: output + '/review-blink.png'
  });
  await page.evaluate(() => {
    document.querySelector('.miien-blink').getAnimations()[0].currentTime = 0;
    window.dispatchEvent(new CustomEvent('miien:voice', {
      detail: {
        phase: 'playing'
      }
    }));
    window.dispatchEvent(new CustomEvent('miien:mouth', {
      detail: {
        shape: 2
      }
    }));
  });
  await page.screenshot({
    path: output + '/review-speaking.png'
  });
  await page.locator('#stop').click();
  if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('Stop left mouth open');
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await page.screenshot({
    path: output + '/review-mobile.png'
  });
  await page.setViewportSize({
    width: 844,
    height: 390
  });
  await page.screenshot({
    path: output + '/review-landscape.png'
  });
  await page.setViewportSize({
    width: 1440,
    height: 1000
  });
  await page.locator('summary').filter({
    hasText: 'Settings'
  }).click();
  for (const mood of ['happy', 'thoughtful', 'concerned', 'surprised']) {
    await page.locator('#mood-override').selectOption(mood);
    await page.waitForFunction(mood => document.querySelector('.miien-base')?.src.includes('/' + mood + '-v1/'), mood);
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: output + '/review-' + mood + '.png'
    });
    await page.locator('summary').filter({
      hasText: 'Settings'
    }).click();
  }
  await page.locator('#motion-enabled').uncheck();
  await page.locator('.miien-rig').waitFor({
    state: 'detached'
  });
  await page.locator('#motion-enabled').check();
  await page.locator('.miien-rig').waitFor();
  await page.emulateMedia({
    reducedMotion: 'reduce'
  });
  await page.locator('.miien-rig').waitFor({
    state: 'detached'
  });
  if (!(await page.locator('#character').isVisible())) throw Error('Reduced motion fallback absent');
  await page.emulateMedia({
    reducedMotion: 'no-preference'
  });
  await page.locator('.miien-rig').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('summary').filter({
    hasText: 'History'
  }).click();
  if (!(await page.locator('#history').isVisible())) throw Error('History not visible');
  await page.keyboard.press('Escape');
  // Browser actually decodes and plays synthetic WAV; voice controller remains real,
  // with only its private service endpoints mocked. No live synthesis requests.
  let calls = 0;
  const job = {
    id: '11111111-1111-1111-1111-111111111111',
    messageId: 'c'.repeat(24),
    voiceId: 'anny_en',
    backendId: 'omni_anny_en',
    status: 'ready',
    deadlineAt: Date.now() + 1200000,
    truncated: false,
    spokenCharacters: 12
  };
  const wav = Buffer.alloc(44 + 16000 * 2 * 3);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 48000; i++) wav.writeInt16LE(Math.round(1500 * Math.sin(i * 2 * Math.PI * 180 / 16000)), 44 + i * 2);
  await page.route('**/speech**', async route => {
    calls++;
    await route.fulfill(route.request().url().endsWith('/audio') ? {
      contentType: 'audio/wav',
      body: wav
    } : {
      contentType: 'application/json',
      body: JSON.stringify(job)
    });
  });
  await page.locator('summary').filter({
    hasText: 'Settings'
  }).click();
  await page.locator('#speech-mode').selectOption('anny_en');
  await page.keyboard.press('Escape');
  for (const mood of ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised']) {
    await page.locator('#replay').click();
    await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
    await page.locator('summary').filter({
      hasText: 'Settings'
    }).click();
    await page.locator('#mood-override').selectOption(mood);
    await page.waitForFunction(mood => document.querySelector('.miien-base')?.src.includes('/' + mood + '-v1/'), mood);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
    await page.locator('#stop').click();
    if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('Switch/Stop left mouth open: ' + mood);
  }
  await page.locator('#replay').click();
  await page.waitForFunction(() => document.querySelector('.stage').dataset.activity === 'speaking');
  await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
  await page.evaluate(() => window.fixtureAudio.pause());
  if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('Pause left mouth open');
  await page.evaluate(() => window.fixtureAudio.play());
  await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
  await page.evaluate(() => {
    window.fixtureAudio.currentTime = 1.5;
  });
  await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
  await page.waitForFunction(() => window.fixtureAudio.ended);
  if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('End left mouth open');
  await page.locator('#replay').click();
  await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
  await page.locator('#stop').click();
  if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('Real media Stop left mouth open');
  await page.waitForTimeout(400);
  if (await page.locator('.miien-mouth:not([hidden])').count()) throw Error('Late mouth after Stop');
  await page.locator('summary').filter({
    hasText: 'Settings'
  }).click();
  await page.locator('#mood-override').selectOption('auto');
  await page.locator('#speech-mode').selectOption('off');
  await page.keyboard.press('Escape');
  for (const mood of ['happy', 'thoughtful', 'concerned', 'surprised']) {
    state.messages = [{
      id: 'd'.repeat(24),
      role: 'assistant',
      text: 'Synthetic expression review: ' + mood,
      mood
    }];
    await page.waitForFunction(mood => document.querySelector('.miien-base')?.src.includes('/' + mood + '-v1/'), mood);
  }
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await page.screenshot({
    path: output + '/review-mobile.png'
  });
  await page.setViewportSize({
    width: 844,
    height: 390
  });
  await page.screenshot({
    path: output + '/review-landscape.png'
  });
  const failed = await browser.newPage();
  await failed.route('**/surprised-v1/blink.webp', route => route.abort());
  await failed.goto(page.url());
  await failed.locator('#art-status').filter({
    hasText: 'layers unavailable'
  }).waitFor();
  if (!(await failed.locator('#character').isVisible()) || (await failed.locator('.miien-rig').count())) throw Error('Broken layer fallback failed');
  await failed.close();
  if (errors.length) throw Error('Browser script or CSP errors: ' + errors.join('; '));
  process.stdout.write(JSON.stringify({
    screenshots: 9,
    browserErrors: errors,
    syntheticSpeechRequests: calls,
    checks: ['desktop/mobile/landscape', 'blink/open registration', 'Stop', 'actual synthetic WAV playing/pause/seek/end/replay/Stop', 'production CSP', 'CSS breathing and timed blink', 'broken layer portrait fallback', 'all four automatic moods', 'all five manual moods during actual media playback', 'lazy loading', 'motion off', 'reduced motion', 'history/settings/Escape']
  }, null, 2));
})().catch(error => {
  require('../utils/logger').error('Miien browser review failed', {
    category: 'chat5_miien_assets',
    metadata: {
      failure: error.message.slice(0, 500)
    }
  });
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  server.close();
});
