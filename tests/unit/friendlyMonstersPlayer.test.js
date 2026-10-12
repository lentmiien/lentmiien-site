const fs = require('fs');
const path = require('path');
const core = require('../../games/friendly-monsters/core');
const root = path.resolve(__dirname, '../../games/friendly-monsters');
const syntheticBook = () => ({ version: 1, chapters: Array.from({ length: 17 }, (_, c) => ({ title: `物語${c}`, beats: Array.from({ length: 3 }, (_, i) => ({ scene: c + 1, text: `物語${c}の文章${i}。`, background: 'assets/images/bg01.webp', sprites: [], audio: 'assets/audio/c01-b001-837fa2b83d61.mp3', duration: 5 })) })) });
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });

describe('Friendly Monsters reader interactions', () => {
  let dom, w, audio, fetch;
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const click = id => w.document.getElementById(id).click();
  const element = id => w.document.getElementById(id);
  async function setup({ blockedStorage = false, saved, failure = false, story = syntheticBook() } = {}) {
    dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://example.test/games/friendly-monsters/', runScripts: 'outside-only', pretendToBeVisual: true });
    w = dom.window; audio = [];
    w.MonsterVN = core;
    w.Audio = function () { const a = { play: jest.fn().mockResolvedValue(), pause: jest.fn(), load: jest.fn(), removeAttribute: jest.fn(), currentTime: 0, duration: 5 }; audio.push(a); return a; };
    w.Image = function () { return { removeAttribute: jest.fn() }; };
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    fetch = jest.fn().mockResolvedValue({ ok: !failure, text: async () => JSON.stringify(story) }); w.fetch = fetch;
    if (saved) w.localStorage.setItem('friendly-monsters-v1', JSON.stringify(saved));
    if (blockedStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
    w.eval(fs.readFileSync(path.join(root, 'player.js'), 'utf8')); await flush();
  }
  afterEach(() => { if (w) w.dispatchEvent(new w.Event('pagehide')); dom?.window.close(); });
  test('loads public manifest and reads through every chapter to the ending', async () => {
    await setup(); expect(fetch).toHaveBeenCalledWith('story.json', expect.objectContaining({ credentials: 'omit' }));
    click('start'); await flush(); expect(element('subtitle').textContent).toBe('物語0の文章0。');
    for (let i = 0; i < 51; i++) click('next');
    expect(element('chapter-label').textContent).toContain('第17章'); expect(element('ending').hidden).toBe(false);
    expect(element('next').disabled).toBe(true);
    click('previous'); expect(element('subtitle').textContent).toBe('物語16の文章1。');
  });
  test('the actual release script reaches every narrated beat and the final ending', async () => {
    const story = JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8'));
    await setup({ story }); click('start');
    for (const chapter of story.chapters) {
      for (const beat of chapter.beats) {
        expect(element('subtitle').textContent).toBe(beat.text);
        expect(element('background').getAttribute('src')).toBe(beat.background);
        click('next');
      }
    }
    expect(element('ending').hidden).toBe(false);
    expect(element('chapter-label').textContent).toContain('第17章');
  });
  test('resume, chapter selection and menu stop old playback', async () => {
    await setup({ saved: { version: 1, chapter: 5, beat: 1, auto: true } });
    expect(element('resume').hidden).toBe(false); click('resume'); await flush();
    expect(element('chapter-label').textContent).toContain('第6章');
    expect(element('auto').getAttribute('aria-pressed')).toBe('false');
    const old = audio[0]; click('menu'); expect(old.pause).toHaveBeenCalled(); expect(element('settings').open).toBe(true);
    element('chapters').children[16].firstChild.click(); await flush();
    expect(element('chapter-label').textContent).toContain('第17章'); expect(element('settings').open).toBe(false);
    expect(JSON.parse(w.localStorage.getItem('friendly-monsters-v1'))).toMatchObject({ chapter: 16, beat: 0 });
  });
  test('storage denial is visible and does not stop navigation', async () => {
    await setup({ blockedStorage: true }); click('start'); click('next');
    expect(element('subtitle').textContent).toBe('物語0の文章1。'); expect(element('save-status').textContent).toContain('保存できません');
  });
  test('asset and audio errors offer retry and text-only recovery', async () => {
    await setup(); click('start'); await flush();
    element('background').onerror(); expect(element('art-error').hidden).toBe(false);
    click('retry-art'); expect(element('art-error').hidden).toBe(true);
    audio[0].onerror(); expect(element('audio-error').hidden).toBe(false);
    click('retry-audio'); await flush(); expect(audio).toHaveLength(2);
    audio[1].onerror(); click('text-only'); expect(element('audio-error').hidden).toBe(true);
    click('next'); expect(audio).toHaveLength(2); expect(element('subtitle').getAttribute('aria-live')).toBe('polite');
  });
  test('manifest failure can recover without reloading the page', async () => {
    await setup({ failure: true }); expect(element('reload').hidden).toBe(false); expect(element('start').disabled).toBe(true);
    fetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify(syntheticBook()) }); click('reload'); await flush();
    expect(element('start').disabled).toBe(false); expect(element('chapters').children.length).toBe(17);
  });
  test('automatic progression waits for audio end and stale end cannot jump chapters', async () => {
    jest.useFakeTimers();
    try {
      await setup(); w.setTimeout = setTimeout; w.clearTimeout = clearTimeout;
      click('start'); await flush(); audio[0].onplaying(); click('auto');
      jest.advanceTimersByTime(6000);
      expect(element('subtitle').textContent).toBe('物語0の文章0。');
      const stale = audio[0].onended; audio[0].onended(); jest.advanceTimersByTime(651); await flush();
      expect(element('subtitle').textContent).toBe('物語0の文章1。');
      click('menu'); element('chapters').children[5].firstChild.click(); await flush(); stale(); jest.advanceTimersByTime(1000);
      expect(element('subtitle').textContent).toBe('物語5の文章0。');
      click('menu'); element('voice').checked = false; element('voice').dispatchEvent(new w.Event('change')); click('close-menu'); click('auto');
      jest.advanceTimersByTime(4001); expect(element('subtitle').textContent).toBe('物語5の文章1。');
    } finally { w.dispatchEvent(new w.Event('pagehide')); jest.useRealTimers(); }
  });
  test('replay during the automatic end gap cancels the pending advance', async () => {
    jest.useFakeTimers();
    try {
      await setup(); w.setTimeout = setTimeout; w.clearTimeout = clearTimeout;
      click('start'); click('auto'); audio[0].onended();
      jest.advanceTimersByTime(200); click('play'); await flush();
      jest.advanceTimersByTime(651); expect(element('position').textContent).toBe('1 / 3');
      audio[1].onended(); jest.advanceTimersByTime(651);
      expect(element('position').textContent).toBe('2 / 3');
    } finally { w.dispatchEvent(new w.Event('pagehide')); jest.useRealTimers(); }
  });
  test('audio-ended autoplay visits every real beat and chapter, then stops at the finale', async () => {
    jest.useFakeTimers();
    try {
      const story = JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8'));
      await setup({ story }); w.setTimeout = setTimeout; w.clearTimeout = clearTimeout;
      click('start'); click('auto');
      for (const chapter of story.chapters) for (const beat of chapter.beats) {
        expect(element('subtitle').textContent).toBe(beat.text);
        audio.at(-1).onended(); jest.advanceTimersByTime(651); await flush();
      }
      expect(element('ending').hidden).toBe(false); expect(element('auto').getAttribute('aria-pressed')).toBe('false');
      jest.advanceTimersByTime(30000); expect(element('ending').hidden).toBe(false);
    } finally { w.dispatchEvent(new w.Event('pagehide')); jest.useRealTimers(); }
  });
  test('pause, menu, mute and settings resume the same clip without overlap', async () => {
    await setup(); click('start'); await flush(); audio[0].onplaying(); audio[0].currentTime = 2;
    click('auto'); click('play');
    expect(element('auto').getAttribute('aria-pressed')).toBe('false');
    expect(element('play').textContent).toBe('朗読を再開');
    click('mute'); click('play'); await flush();
    expect(audio).toHaveLength(1); expect(audio[0].muted).toBe(true); expect(audio[0].currentTime).toBe(2);
    click('menu'); element('volume').value = '0.3'; element('volume').dispatchEvent(new w.Event('input'));
    element('rate').value = '1.5'; element('rate').dispatchEvent(new w.Event('input'));
    click('close-menu'); click('play'); await flush();
    expect(audio).toHaveLength(1); expect(audio[0]).toMatchObject({ volume: 0.3, playbackRate: 1.5, currentTime: 2 });
    click('next'); expect(audio[0].removeAttribute).toHaveBeenCalledWith('src'); expect(audio).toHaveLength(2);
  });
  test('story strings remain inert text and storage cannot supply media or markup', async () => {
    const story = syntheticBook(); story.chapters[0].title = '<img src=x onerror=alert(1)>';
    story.chapters[0].beats[0].text = '<script>alert(1)</script>';
    await setup({ story, saved: { version: 1, chapter: 0, beat: 0, audio: '//evil/track', muted: 'false', html: '<img src=x>' } });
    click('start');
    expect(element('subtitle').textContent).toBe('<script>alert(1)</script>');
    expect(element('subtitle').children).toHaveLength(0); expect(element('chapter-label').children).toHaveLength(0);
    expect(audio[0].src).toBe(story.chapters[0].beats[0].audio); expect(audio[0].muted).toBe(false);
  });
  test('keyboard leaves editable, link and summary interactions untouched', async () => {
    await setup(); click('start'); const text = element('subtitle').textContent;
    for (const tag of ['input', 'select', 'textarea', 'button', 'a', 'summary', 'div']) {
      const target = w.document.createElement(tag);
      if (tag === 'div') target.setAttribute('contenteditable', 'true');
      w.document.body.append(target);
      const event = new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
      expect(element('subtitle').textContent).toBe(text);
    }
  });
  test('focus recovers at boundaries, reset and replay after ending', async () => {
    await setup(); click('start'); click('next'); element('previous').focus(); click('previous');
    expect(w.document.activeElement).toBe(element('subtitle'));
    click('menu'); element('chapters').children[16].firstChild.click();
    click('next'); click('next'); element('next').focus(); click('next');
    expect(w.document.activeElement).toBe(element('ending'));
    click('restart'); expect(element('position').textContent).toBe('1 / 3'); expect(element('ending').hidden).toBe(true);
    click('menu'); click('clear-save'); expect(w.document.activeElement).toBe(element('start'));
  });
  test('preload follows the next beat even when current art has not changed', async () => {
    const story = syntheticBook(); story.chapters[0].beats[2].background = 'assets/images/bg02.webp';
    await setup({ story }); const images = []; w.Image = function () { const image = { removeAttribute: jest.fn() }; images.push(image); return image; };
    click('start'); expect(images).toHaveLength(0); click('next');
    expect(images.map(i => i.src)).toContain('assets/images/bg02.webp');
  });
  test('save reset returns home and keyboard navigation remains usable', async () => {
    await setup(); click('start');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(element('subtitle').textContent).toBe('物語0の文章1。');
    click('menu'); click('clear-save'); expect(element('welcome').hidden).toBe(false); expect(w.localStorage.getItem('friendly-monsters-v1')).toBeNull();
  });
});
