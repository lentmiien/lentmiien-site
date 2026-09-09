// Synthetic lifecycle QA only: loopback Pug/static fixture, mocked microphone
// and provider responses. Pass installed Playwright and Chromium paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const pug = require('pug');
const root = path.resolve(__dirname, '..');
const id = 'a'.repeat(24), messageId = 'c'.repeat(24);
const html = pug.renderFile(path.join(root, 'views/miien_room.pug'), {
  conversation: { _id: id, title: 'Synthetic turn-taking review' },
  moods: ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised'],
  canWrite: true, canTranscribe: true, canSynthesize: true, csrfToken: 'synthetic-token',
});
const state = { pending: false, messages: [{ id: messageId, role: 'assistant', text: 'Saved synthetic reply', mood: 'neutral' }] };
const server = http.createServer((req, res) => {
  if (req.url.endsWith('/state')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(state)); }
  if (req.url === '/chat5/miien/' + id) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.end(html);
  }
  if (/^\/(?:js\/miien[a-z_]*\.js|css\/(?:miien|color-theme)\.css|i\/miien\/[a-z0-9_./-]+)$/.test(req.url) && !req.url.includes('..')) {
    const target = root + '/public' + req.url;
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' }[path.extname(target)];
    if (type && fs.existsSync(target) && fs.statSync(target).isFile()) { res.setHeader('Content-Type', type); return fs.createReadStream(target).pipe(res); }
  }
  res.statusCode = 404; res.end();
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let browser;
(async () => {
  const { chromium } = require(process.argv[2] || 'playwright');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security')) errors.push(message.text()); });
  await page.addInitScript(() => {
    const timer = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => timer(fn, [1500, 2500, 5000, 12000].includes(ms) ? 50 : ms, ...args);
    const NativeAudio = window.Audio;
    window.fixtureAudios = [];
    window.Audio = class extends NativeAudio { constructor(...args) { super(...args); window.fixtureAudios.push(this); } };
    window.fixtureTracksStopped = 0;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.fixtureGrant = () => resolve({ getTracks: () => [{ stop: () => { window.fixtureTracksStopped++; } }] });
    });
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; }
      start() { this.state = 'recording'; this.onstart?.(); }
      stop() {
        this.state = 'inactive';
        const buffer = new ArrayBuffer(3244), view = new DataView(buffer);
        const ascii = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        ascii(0, 'RIFF'); view.setUint32(4, 3236, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
        view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        ascii(36, 'data'); view.setUint32(40, 3200, true);
        this.ondataavailable?.({ data: new Blob([buffer], { type: this.mimeType }) }); this.onstop?.();
      }
    };
  });
  const wav = Buffer.alloc(44 + 96000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 48000; i++) wav.writeInt16LE(Math.round(1500 * Math.sin(i * 2 * Math.PI * 180 / 16000)), 44 + i * 2);
  let speechGate = deferred(), audioGate = null, asrGate = deferred(), speechCalls = 0, audioCalls = 0, asrCalls = 0, sends = 0;
  const job = () => ({ id: '11111111-1111-1111-1111-111111111111', messageId: state.messages.at(-1).id,
    voiceId: 'anny_en', backendId: 'omni_anny_en', status: 'ready', deadlineAt: Date.now() + 1200000, spokenCharacters: 20 });
  await page.route('**/speech**', async route => {
    if (route.request().url().includes('/speech-admission/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'available' }) });
    if (route.request().url().endsWith('/audio')) {
      audioCalls++; if (audioGate) await audioGate.promise;
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    }
    const result = job(); speechCalls++;
    if (route.request().method() === 'POST' && speechGate) await speechGate.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.route('**/transcribe', async route => {
    asrCalls++; await asrGate.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'Synthetic transcript' }) });
  });
  await page.route('**/messages', async route => {
    sends++; state.pending = true;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
  });
  const presence = text => page.waitForFunction(text => document.querySelector('#presence').textContent.includes(text), text);
  const noMouth = async () => assert.equal(await page.locator('.miien-mouth:not([hidden])').count(), 0);
  const guardedReplay = async () => {
    assert.equal(await page.locator('#replay').isDisabled(), true);
    await page.locator('#replay').dispatchEvent('click');
  };
  const pollUntil = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Synthetic request did not arrive'); };
  await page.goto('http://127.0.0.1:' + server.address().port + '/chat5/miien/' + id);
  await page.waitForFunction(() => !document.querySelector('#replay').disabled);
  assert.equal(speechCalls, 0);
  await page.locator('summary').filter({ hasText: 'Settings' }).click();
  await page.locator('#speech-mode').selectOption('anny_en'); await page.locator('#speech-enabled').check();
  await page.keyboard.press('Escape');
  await page.locator('#replay').click(); await presence('Preparing voice'); await noMouth();
  await page.locator('#mic').click(); await presence('Requesting microphone'); await guardedReplay();
  await page.evaluate(() => window.fixtureGrant()); await presence('Listening'); await guardedReplay();
  await page.locator('#mic').click(); await presence('Transcribing'); await guardedReplay();
  await page.locator('#message').fill('Edited during ASR'); await pollUntil(() => asrCalls === 1);
  asrGate.resolve(); await presence('Review your transcript');
  assert.equal(await page.locator('#message').inputValue(), 'Edited during ASR\nSynthetic transcript'); assert.equal(sends, 0);
  speechGate.resolve(); speechGate = null;
  state.messages = [{ id: 'd'.repeat(24), role: 'assistant', text: 'Late reply after microphone', mood: 'happy' }];
  await page.waitForFunction(() => document.querySelector('#latest-reply').textContent === 'Late reply after microphone');
  assert.equal(audioCalls, 0); await noMouth();
  await page.locator('#send').click(); await presence('Waiting for Chat5'); await guardedReplay();
  audioGate = deferred(); state.pending = false;
  state.messages = [{ id: 'e'.repeat(24), role: 'assistant', text: 'New automatic reply', mood: 'thoughtful' }];
  await pollUntil(() => audioCalls === 1); await presence('Preparing voice'); await noMouth();
  await page.locator('#message').fill('Draft during delayed audio');
  await page.locator('summary').filter({ hasText: 'History' }).click(); assert.equal(await page.locator('#history').isVisible(), true); await page.keyboard.press('Escape');
  await page.locator('#mic').click(); await presence('Requesting microphone'); await page.locator('#stop').click();
  const stopped = await page.evaluate(() => window.fixtureTracksStopped);
  await page.evaluate(() => window.fixtureGrant());
  await page.waitForFunction(stopped => window.fixtureTracksStopped > stopped, stopped);
  audioGate.resolve(); audioGate = null;
  await page.waitForTimeout(150); assert.equal(await page.evaluate(() => window.fixtureAudios.length), 0); await noMouth();
  await page.locator('#replay').click(); await presence('Speaking');
  await page.waitForFunction(() => !!document.querySelector('.miien-mouth:not([hidden])'));
  await page.evaluate(() => window.fixtureAudios.at(-1).dispatchEvent(new Event('waiting')));
  await presence('Buffering'); await noMouth();
  await page.evaluate(() => window.fixtureAudios.at(-1).dispatchEvent(new Event('playing'))); await presence('Speaking');
  await page.locator('#send').click(); await presence('Waiting for Chat5'); await guardedReplay(); await noMouth();
  await page.evaluate(() => window.fixtureAudios.at(-1).dispatchEvent(new Event('playing'))); await presence('Waiting for Chat5'); await noMouth();
  state.pending = false;
  await page.waitForFunction(() => !document.querySelector('#replay').disabled);
  const beforeReload = speechCalls; await page.reload();
  await page.waitForFunction(() => !document.querySelector('#replay').disabled);
  assert.equal(speechCalls, beforeReload); assert.equal(await page.evaluate(() => window.fixtureAudios.length), 0);

  // Exercise actual service admission with native browser audio. The provider
  // promise remains held after the browser aborts A's local polling.
  await page.unroute('**/speech**');
  const { MiienSpeechService, MiienSpeechOccupiedError } = require('../services/miienSpeechService');
  const owner = { _id: 'b'.repeat(24) }, replies = new Map(), generated = [];
  let slot = null, providerGate = deferred(), admissionReads = 0;
  const speechService = new MiienSpeechService({
    chat: { speechText: async (user, roomId, savedId) => {
      assert.equal(user._id, owner._id); assert.equal(roomId, id); assert.ok(replies.has(savedId));
      return replies.get(savedId);
    } }, authorize: async () => owner, logger: require('../utils/logger'),
    slots: { exists: async () => slot ? { _id: slot._id } : null,
      create: async value => { if (slot) throw Object.assign(new Error('occupied'), { code: 11000 }); slot = value; },
      deleteOne: async query => { if (slot?.jobId === query.jobId) slot = null; } },
    http: { get: async () => ({ data: { voices: [{ voice_id: 'omni_anny_en' }] } }),
      post: async (url, body) => { generated.push(body.text); if (providerGate) await providerGate.promise; return { data: wav }; } },
  });
  await page.route('**/speech**', async route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    try {
      let result;
      if (parts.includes('speech-admission')) { admissionReads++; result = await speechService.admission(owner, id, parts.at(-1)); }
      else if (route.request().method() === 'POST') result = await speechService.submit(owner, id, route.request().postDataJSON());
      else {
        const binary = parts.at(-1) === 'audio';
        result = await speechService.get(owner, id, parts.at(binary ? -2 : -1), binary);
        if (binary) return route.fulfill({ contentType: 'audio/wav', body: result });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
    } catch (error) {
      return route.fulfill({ status: error.status || 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic speech failure',
        ...(error instanceof MiienSpeechOccupiedError ? { code: 'speech_admission_occupied' } : {}) }) });
    }
  });
  const nextReply = async (letter, text) => {
    await page.locator('#message').fill('Synthetic explicit turn'); await page.locator('#send').click();
    await presence('Waiting for Chat5');
    const savedId = letter.repeat(24); replies.set(savedId, text);
    state.messages = [{ id: savedId, role: 'assistant', text, mood: 'thoughtful' }]; state.pending = false;
    await page.waitForFunction(text => document.querySelector('#latest-reply').textContent === text, text);
  };
  await nextReply('f', 'Held synthetic A'); await pollUntil(() => generated.length === 1);
  await nextReply('9', 'Latest synthetic B');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('Waiting for previous voice generation'));
  assert.deepEqual(generated, ['Held synthetic A']); await noMouth();
  assert.equal(await page.evaluate(() => window.fixtureAudios.length), 0);
  providerGate.resolve(); providerGate = null; await presence('Speaking');
  assert.deepEqual(generated, ['Held synthetic A', 'Latest synthetic B']);
  assert.equal(await page.evaluate(() => window.fixtureAudios.length), 1);
  providerGate = deferred();
  await nextReply('8', 'Second held synthetic A'); await pollUntil(() => generated.length === 3);
  await nextReply('7', 'Superseded synthetic B');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('Waiting for previous voice generation'));
  await nextReply('6', 'Winning synthetic C');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('Waiting for previous voice generation'));
  providerGate.resolve(); providerGate = null; await presence('Speaking');
  assert.deepEqual(generated, ['Held synthetic A', 'Latest synthetic B', 'Second held synthetic A', 'Winning synthetic C']);
  assert.equal(await page.evaluate(() => window.fixtureAudios.length), 2);
  await page.locator('#stop').click(); await noMouth();
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ synthetic: true, checks: [
    'no initial/reload autoplay', 'delayed synthesis interrupted by permission/capture/ASR', 'Replay handler exclusions',
    'retained ASR edits and explicit review', 'no ASR auto-send', 'late permission track cleanup',
    'delayed audio ignored after Stop', 'real synthetic WAV playback and mouth closure on buffering/Send',
    'pending reply exclusion', 'editable captions/history/draft during preparation', 'production CSP',
    'real service held A then B admission and native playback once', 'waiting B superseded by C without B generation',
  ], speechCalls, audioCalls, asrCalls, sends, admissionReads, composedProviderCalls: generated.length, browserErrors: errors }, null, 2) + '\n');
})().catch(error => {
  require('../utils/logger').error('Miien turn-taking browser review failed', {
    category: 'chat5_miien_lifecycle', metadata: { failure: error.message.slice(0, 500) },
  });
  process.exitCode = 1;
}).finally(async () => { await browser?.close(); server.close(); });
