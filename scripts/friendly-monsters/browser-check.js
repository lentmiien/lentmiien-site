#!/usr/bin/env node
'use strict';
// Development-only QA. Run preview.js first. Playwright is optional, never a runtime dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.VN_REVIEW_OUTPUT || '/tmp/friendly-monsters-review2';
const book = require('../../games/friendly-monsters/story.json');
const base = 'http://127.0.0.1:8097/games/friendly-monsters/';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Observe genuine HTMLAudioElements; do not mock decoding, clocks, play or ended.
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.observedAudio = []; window.overlap = false;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args); window.observedAudio.push(audio);
      audio.addEventListener('playing', () => {
        if (window.observedAudio.filter(a => !a.paused && !a.ended).length > 1) window.overlap = true;
      });
      return audio;
    };
  });
  const click = id => page.locator('#' + id).click();
  const currentTime = () => page.evaluate(() => window.observedAudio.at(-1).currentTime);
  async function savedAt(chapter, beat, voice = true, font = 1) {
    await page.goto(base);
    await page.evaluate(value => localStorage.setItem('friendly-monsters-v1', JSON.stringify(value)), { version: 1, chapter, beat, voice, font });
    await page.reload();
    await click(chapter || beat ? 'resume' : 'start');
  }
  async function readyArt() {
    await page.locator('#background').evaluate(async image => { await image.decode(); });
    await page.locator('#sprites img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  }
  async function screenshot(name) {
    await readyArt(); await page.waitForTimeout(450); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  }
  try {
    await page.goto(base); await click('start');
    await page.waitForFunction(() => window.observedAudio.at(-1)?.currentTime > 1);
    await screenshot('desktop');
    await click('play'); const paused = await currentTime();
    await page.waitForTimeout(400); assert.equal(await currentTime(), paused);
    await click('play'); await page.waitForFunction(time => window.observedAudio.at(-1).currentTime > time + 0.3, paused);
    assert.equal(await page.evaluate(() => window.observedAudio.length), 1);
    await click('mute'); assert.equal(await page.evaluate(() => window.observedAudio.at(-1).muted), true);
    await click('mute'); await click('menu');
    const menuTime = await currentTime(); await page.locator('#volume').fill('0.3');
    await page.locator('#rate').selectOption('1.5'); await click('close-menu'); await click('play');
    await page.waitForFunction(time => window.observedAudio.at(-1).currentTime > time, menuTime);
    assert.deepEqual(await page.evaluate(() => { const a = window.observedAudio.at(-1); return [a.volume, a.playbackRate]; }), [0.3, 1.5]);
    await click('next'); await page.waitForFunction(() => window.observedAudio.at(-1).currentTime > 0.1);
    assert.equal(await page.evaluate(() => window.observedAudio[0].getAttribute('src')), null);
    assert.equal(await page.evaluate(() => window.overlap), false);
    await page.reload(); await click('resume'); assert.equal(await page.locator('#position').textContent(), `2 / ${book.chapters[0].beats.length}`);
    console.log('PASS real audio: decoding, clock, pause/resume, menu, volume/rate/mute, navigation, reload, no overlap');

    // Let two complete clips end naturally; no seek, fabricated events or audio mocks.
    await savedAt(0, 0); await click('auto');
    await page.waitForFunction(() => document.querySelector('#position').textContent.startsWith('3 /'), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.overlap), false);
    console.log('PASS two complete real clips advance naturally');
    await savedAt(0, book.chapters[0].beats.length - 1); await click('auto');
    await page.waitForFunction(() => document.querySelector('#chapter-label').textContent.startsWith('第2章'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.observedAudio.at(-1).currentTime > 0.1);
    assert.equal(await page.evaluate(() => window.overlap), false);
    console.log('PASS real chapter-boundary autoplay');

    // Text-only traversal tests every real DOM scene and loads each displayed image.
    await savedAt(0, 0, false);
    const cg = new Set();
    for (let c = 0; c < book.chapters.length; c++) {
      for (let b = 0; b < book.chapters[c].beats.length; b++) {
        const beat = book.chapters[c].beats[b];
        assert.equal(await page.locator('#subtitle').textContent(), beat.text);
        assert.equal(await page.locator('#background').getAttribute('src'), beat.background);
        await readyArt();
        if (b === 0) await screenshot(`chapter-${String(c + 1).padStart(2, '0')}`);
        if (beat.background.includes('/cg') && !cg.has(beat.background)) {
          cg.add(beat.background); await screenshot(path.basename(beat.background, '.webp'));
        }
        await page.locator('#next').evaluate(button => button.click());
      }
    }
    assert.equal(cg.size, 17); assert.equal(await page.locator('#ending').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'ending');
    await click('restart'); assert.equal(await page.locator('#ending').isVisible(), false);
    console.log('PASS all narrated text/staging in browser, 17 chapter and 17 CG screenshots, finale/restart');

    const longest = book.chapters.flatMap((c, chapter) => c.beats.map((b, beat) => ({ chapter, beat, length: b.text.length }))).sort((a, b) => b.length - a.length)[0];
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height }); await savedAt(longest.chapter, longest.beat, false, 1.5);
      await screenshot(`readable-${width}x${height}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await click('menu'); await page.screenshot({ path: path.join(output, `settings-${width}x${height}.png`) });
      assert.equal(await page.locator('#settings').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await click('clear-save'); assert.equal(await page.evaluate(() => document.activeElement.id), 'start');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); await savedAt(0, 0, false);
    assert.equal(await page.locator('#sprites img').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    console.log('PASS portrait, small portrait, landscape, 150% text, dialog bounds, reset focus, reduced motion');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/*.mp3', route => route.abort('internetdisconnected'));
    await savedAt(1, 0); await page.locator('#audio-error').waitFor({ state: 'visible' });
    await page.unroute('**/*.mp3'); await click('retry-audio');
    await page.waitForFunction(() => window.observedAudio.at(-1).currentTime > 0.1);
    console.log('PASS genuine network failure and retry');
    let heldRoute;
    await page.route('**/*.mp3', route => { heldRoute = route; });
    await savedAt(2, 0);
    await page.locator('#audio-error').waitFor({ state: 'visible', timeout: 23000 });
    await heldRoute.abort().catch(() => {}); await page.unroute('**/*.mp3');
    await click('retry-audio'); await page.waitForFunction(() => window.observedAudio.at(-1).currentTime > 0.1);
    console.log('PASS real browser hung audio request times out and retries');

    let first = true;
    await page.route('**/*.mp3', route => { if (first) { first = false; heldRoute = route; } else return route.continue(); });
    await savedAt(3, 0); await page.waitForFunction(() => document.querySelector('#audio-status').textContent.includes('読み込み'));
    await click('menu'); await page.locator('#chapters button').nth(16).click();
    await page.waitForFunction(() => window.observedAudio.at(-1).currentTime > 0.1);
    await heldRoute.abort().catch(() => {}); await page.unroute('**/*.mp3');
    assert.equal(await page.locator('#audio-error').isVisible(), false);
    assert.equal(await page.evaluate(() => window.overlap), false);
    console.log('PASS chapter jump during loading ignores old request failure');

    await savedAt(16, book.chapters[16].beats.length - 1); await click('auto');
    await page.locator('#ending').waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'false');
    await screenshot('finale'); await click('restart');
    assert.equal(await page.locator('#position').textContent(), `1 / ${book.chapters[0].beats.length}`);
    console.log('PASS real final closing narration, ending and restart');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mobile.goto(base); await mobile.locator('#start').tap();
    await mobile.waitForFunction(() => document.querySelector('#audio-status').textContent === '朗読中');
    await mobile.locator('#play').tap(); assert.equal(await mobile.locator('#play').textContent(), '朗読を再開');
    await mobile.locator('#play').tap(); await mobile.locator('#auto').tap();
    await mobile.locator('#sprites img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await mobile.waitForTimeout(450);
    await mobile.screenshot({ path: path.join(output, 'mobile-touch.png'), fullPage: true }); await mobile.close();
    console.log('PASS touch/mobile Chromium audio start, pause/resume and controls');

    await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError')); });
    await savedAt(1, 0); await page.locator('#audio-error').waitFor({ state: 'visible' }); await click('text-only'); await click('auto');
    await page.waitForFunction(() => document.querySelector('#position').textContent.startsWith('2 /'), null, { timeout: 30000 });
    console.log('PASS mocked NotAllowedError recovery into text-only autoplay (only audio mock in this run)');
    assert.deepEqual(errors, []);
    console.log(`Chromium ${browser.version()}; screenshots: ${output}; no page exceptions`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
