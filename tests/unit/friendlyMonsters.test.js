const fs = require('fs');
const path = require('path');
const core = require('../../games/friendly-monsters/core');
const image = 'assets/images/bg01.webp';
const audio = 'assets/audio/c01-b001-837fa2b83d61.mp3';
const beat = () => ({ text: '森へ行こう。', scene: 1, background: image, sprites: [], audio, duration: 5 });
const book = () => ({ version: 1, chapters: Array.from({ length: 17 }, (_, i) => ({ title: `第${i}章`, beats: [beat(), beat()] })) });

describe('Friendly Monsters public asset contract', () => {
  test.each(['../x.webp', '/private_data/a.webp', 'assets/images/../x.webp', 'assets/images/%2e%2e.webp', 'https://example.org/x.webp', '//host/x.webp', 'assets/images/x.webp?foo=1', 'assets\\images\\x.webp', 'assets/images/x.svg', 'assets/images/a.webp\n'])('rejects unsafe image path %s', value => {
    expect(() => core.assetPath(value, 'image')).toThrow();
  });
  test('accepts only confined image/audio filenames', () => {
    expect(core.assetPath(image, 'image')).toBe(image);
    expect(core.assetPath(audio, 'audio')).toBe(audio);
    expect(() => core.assetPath(image, 'audio')).toThrow();
    expect(() => core.assetPath('assets/audio/../../secret.mp3', 'audio')).toThrow();
  });
  test('rejects malformed manifests, excessive work, and nested unsafe paths', () => {
    expect(core.validateBook(book()).chapters).toHaveLength(17);
    for (const mutate of [b => b.chapters.pop(), b => b.chapters[0].beats[0].sprites.push('//evil/x.webp'), b => b.chapters[0].beats[0].duration = Infinity, b => b.chapters[0].beats[0].text = 'a'.repeat(221), b => b.chapters[0].beats = Array(301).fill(beat())]) {
      const value = book(); mutate(value); expect(() => core.validateBook(value)).toThrow();
    }
  });
  test.each([null, '', '{', 'null', '[]', 'x'.repeat(1001), '{"version":2}'])('recovers invalid stored state %s', value => {
    expect(core.readSave(value, book())).toEqual(core.defaults);
  });
  test('validates each stored field and never restores autoplay', () => {
    expect(core.readSave(JSON.stringify({ version: 1, chapter: -1, beat: 99, rate: '1.5', volume: 9, font: null, voice: 'false', auto: true }), book())).toEqual(core.defaults);
    expect(core.readSave(JSON.stringify({ version: 1, chapter: 16, beat: 1, rate: 1.25, volume: 0, voice: false, auto: true }), book())).toMatchObject({ chapter: 16, beat: 1, rate: 1.25, volume: 0, voice: false, auto: false });
  });
  test('preloads only a bounded adjacent window, with duplicates removed', () => {
    const value = book(); value.chapters[0].beats = Array.from({ length: 100 }, (_, i) => ({ ...beat(), background: `assets/images/bg${i}.webp`, sprites: [image, 'assets/images/sam-joy.webp'] }));
    expect(core.preloadPaths(value, 0, 5)).toEqual(['assets/images/bg5.webp', image, 'assets/images/sam-joy.webp', 'assets/images/bg6.webp']);
  });
});

describe('Friendly Monsters audio lifecycle', () => {
  let instances, callbacks, player;
  beforeEach(() => {
    jest.useFakeTimers(); instances = [];
    callbacks = Object.fromEntries(['error', 'loading', 'playing', 'progress', 'ended'].map(k => [k, jest.fn()]));
    player = new core.Playback(() => { const a = { play: jest.fn().mockResolvedValue(), pause: jest.fn(), load: jest.fn(), removeAttribute: jest.fn(), currentTime: 2, duration: 5 }; instances.push(a); return a; }, callbacks);
  });
  afterEach(() => { player.stop(); jest.useRealTimers(); });
  test('cancels stale events, releases source and reports real audio progress', async () => {
    await player.play(beat(), core.defaults);
    const oldEnded = instances[0].onended, oldError = instances[0].onerror;
    await player.play(beat(), core.defaults);
    oldEnded(); oldError();
    expect(callbacks.ended).not.toHaveBeenCalled(); expect(callbacks.error).not.toHaveBeenCalled();
    expect(instances[0].pause).toHaveBeenCalled(); expect(instances[0].removeAttribute).toHaveBeenCalledWith('src');
    instances[1].ontimeupdate(); expect(callbacks.progress).toHaveBeenLastCalledWith(0.4);
    instances[1].onended(); expect(callbacks.ended).toHaveBeenCalledTimes(1);
  });
  test('old rejected play promise cannot cancel a later chapter', async () => {
    let reject;
    const original = player.createAudio;
    player.createAudio = () => { const a = original(); if (instances.length === 1) a.play = () => new Promise((_, no) => { reject = no; }); return a; };
    const old = player.play(beat(), core.defaults);
    await player.play(beat(), core.defaults); reject(new Error('stale')); await old;
    expect(callbacks.error).not.toHaveBeenCalled(); expect(player.audio).toBe(instances[1]);
  });
  test('blocked, failed, and stalled audio expose recovery without ending', async () => {
    const original = player.createAudio;
    player.createAudio = () => { const a = original(); a.play.mockRejectedValue(new Error('blocked')); return a; };
    await player.play(beat(), core.defaults); expect(callbacks.error).toHaveBeenCalledTimes(1);
    player.createAudio = original; await player.play(beat(), core.defaults);
    jest.advanceTimersByTime(20001); expect(callbacks.error).toHaveBeenCalledTimes(2);
    expect(callbacks.ended).not.toHaveBeenCalled();
  });
});

describe('release assets', () => {
  const root = path.resolve(__dirname, '../../games/friendly-monsters');
  test('all 17 substantive chapters and referenced audio/images exist without symlinks', () => {
    const story = core.validateBook(JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8')));
    const paths = new Set();
    let chars = 0;
    for (const chapter of story.chapters) {
      expect(chapter.beats.length).toBeGreaterThanOrEqual(12);
      for (const b of chapter.beats) {
        chars += b.text.length; [b.background, ...b.sprites, b.audio].forEach(p => paths.add(p));
        expect(b.duration).toBeGreaterThan(0);
      }
    }
    expect(chars).toBeGreaterThan(25000);
    for (const p of paths) {
      const filename = path.join(root, p);
      expect(fs.lstatSync(filename).isSymbolicLink()).toBe(false);
      expect(fs.statSync(filename).size).toBeGreaterThan(1000);
      expect(fs.realpathSync(filename).startsWith(root + path.sep)).toBe(true);
    }
  });
});
