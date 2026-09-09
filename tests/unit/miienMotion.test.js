const fs = require('fs');
const crypto = require('crypto');
const { validate, create } = require('../../public/js/miien_motion');
const { create: activityController } = require('../../public/js/miien_activity');
const manifest = require('../../public/i/miien/motion-v1.json');
// Preserve coverage of legacy clip manifests alongside the new layered schema.
const clone = () => { const value = JSON.parse(JSON.stringify(manifest)); delete value.layered; return value; };
const clip = () => ({ state: 'idle', mood: 'neutral', src: '/i/miien/v1/idle-neutral.mp4', poster: '/i/miien/neutral.webp',
  sha256: 'a'.repeat(64), posterSha256: manifest.stills[0].sha256, provenance: '/i/miien/v1/provenance.json', width: 1280, height: 704, fps: 25, durationSeconds: 4.84, silent: true });
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
test('committed manifest honestly declares no clips and matches every approved still hash', () => {
  expect(validate(manifest)).toBe(manifest); expect(manifest.clipStatus).toBe('not-produced'); expect(manifest.clips).toEqual([]);
  for (const still of manifest.stills) expect(crypto.createHash('sha256').update(fs.readFileSync('public' + still.src)).digest('hex')).toBe(still.sha256);
});
test.each(['https://evil.invalid/x.webp', '//evil/x.webp', '/i/miien/../private.webp', '/i/miien/%2e%2e/x.webp', '/i/miien/x.webp?token=x', '/chat5/private.webp', '/i/miien/a\\x.webp'])('rejects unsafe art path %s', path => {
  const m = clone(); m.stills[0].src = path; expect(validate(m)).toBeNull();
});
test('clip metadata, slot count and policies must be bounded', () => {
  const m = clone(); m.clipStatus = 'reviewed'; m.clips = [clip()]; expect(validate(m)).toBe(m);
  for (const patch of [{ silent: false }, { fps: 61 }, { durationSeconds: 11 }, { width: 9999 }, { state: 'error' }, { sha256: 'not-a-hash' }, { poster: '/private.webp' }]) {
    const c = clone(); c.clipStatus = 'reviewed'; c.clips = [{ ...clip(), ...patch }]; expect(validate(c)).toBeNull();
  }
  m.clips = Array(21).fill(clip()); expect(validate(m)).toBeNull();
  m.clips = []; m.policy.crossfadeMs = 500; expect(validate(m)).toBeNull();
});
function fixture({ hidden = false, saveData = false, decode } = {}) {
  const still = { src: '', after: jest.fn() }, status = { textContent: '' }, videos = [];
  const mediaQuery = { matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const connection = { saveData, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const document = { hidden, createElement: () => {
    const video = { pause: jest.fn(), load: jest.fn(), remove: jest.fn(), removeAttribute: jest.fn(), setAttribute: jest.fn(), play: jest.fn().mockResolvedValue() };
    videos.push(video); return video;
  } };
  const adapter = create({ document, still, status, Image: class { decode() { return decode ? decode(this.src) : Promise.resolve(); } }, mediaQuery, connection });
  return { adapter, still, status, videos, mediaQuery, connection };
}
beforeEach(() => jest.useFakeTimers()); afterEach(() => jest.useRealTimers());
test('absent clip uses the appropriate still; ready and stale events cannot show a wrong clip', async () => {
  const f = fixture(); const m = clone(); m.clipStatus = 'reviewed'; m.clips = [clip()];
  await f.adapter.setManifest(m); const video = f.videos[0];
  expect(video.muted).toBe(true); expect(video.playsInline).toBe(true); expect(video.hidden).toBe(true);
  video.oncanplay(); await settle(); expect(video.hidden).toBe(true);
  video.onplaying(); expect(video.hidden).toBe(false);
  await f.adapter.show('happy', 'speaking'); expect(f.still.src).toBe('/i/miien/happy.webp');
  expect(video.remove).toHaveBeenCalled(); const count = video.play.mock.calls.length;
  video.oncanplay(); expect(video.play).toHaveBeenCalledTimes(count);
});
test('reduced motion, manual off, background and failed video all retain the still', async () => {
  const f = fixture(); const m = clone(); m.clipStatus = 'reviewed'; m.clips = [clip()];
  f.mediaQuery.matches = true; await f.adapter.setManifest(m); expect(f.videos).toHaveLength(0);
  f.mediaQuery.matches = false; await f.adapter.enable(false); expect(f.videos).toHaveLength(0);
  await f.adapter.enable(true); f.videos[0].onerror(); expect(f.status.textContent).toContain('portrait');
  await f.adapter.suspend(true); expect(f.videos).toHaveLength(1);
  await f.adapter.suspend(false); expect(f.videos).toHaveLength(2);
  f.mediaQuery.matches = true; await f.mediaQuery.addEventListener.mock.calls[0][1]();
  expect(f.videos[1].remove).toHaveBeenCalled();
  f.adapter.dispose(); expect(f.mediaQuery.removeEventListener).toHaveBeenCalled();
});
test('clip readiness watchdog and autoplay rejection return to still', async () => {
  const f = fixture(); const m = clone(); m.clipStatus = 'reviewed'; m.clips = [clip()];
  await f.adapter.setManifest(m); await jest.advanceTimersByTimeAsync(10000);
  expect(f.videos[0].remove).toHaveBeenCalled();
  await f.adapter.show('neutral', 'idle'); f.videos[1].play.mockRejectedValue(new Error('blocked'));
  f.videos[1].oncanplay(); await settle(); expect(f.videos[1].remove).toHaveBeenCalled();
});
test('activity is orthogonal to mood and reflects real work, then settles centrally', () => {
  const onChange = jest.fn(), activity = activityController(onChange);
  expect(activity.update({ voice: 'preparing' })).toMatchObject({ state: 'thinking', status: expect.stringContaining('Preparing') });
  expect(activity.update({ voice: 'playing' }).state).toBe('speaking');
  expect(activity.update({ voice: 'idle', asr: true })).toMatchObject({ state: 'thinking', status: expect.stringContaining('Transcribing') });
  expect(activity.update({ recording: true }).state).toBe('listening');
  expect(activity.update({ recording: false, asr: false, chat: true })).toMatchObject({ state: 'thinking', status: expect.stringContaining('Chat5') });
  expect(activity.update({ chat: false }).state).toBe('idle');
  expect(activity.update({ voice: 'fake-speaking', mood: 'happy' }).state).toBe('idle');
});

test('matching poster stays under incoming video and failures restore mood portrait', async () => {
  const f = fixture(), m = clone(); m.clipStatus = 'reviewed'; m.clips = [{ ...clip(), poster: '/i/miien/v2-2/idle-neutral.webp' }];
  await f.adapter.setManifest(m); expect(f.still.src).toBe(m.clips[0].poster);
  f.videos[0].onplaying(); expect(f.still.src).toBe(m.clips[0].poster);
  f.videos[0].onerror(); expect(f.still.src).toBe('/i/miien/neutral.webp');
  await f.adapter.show('concerned', 'idle'); expect(f.still.src).toBe('/i/miien/concerned.webp'); expect(f.videos).toHaveLength(1);
  await f.adapter.show('neutral', 'speaking'); expect(f.still.src).toBe('/i/miien/neutral.webp'); expect(f.videos).toHaveLength(1);
});
test.each([{ hidden: true }, { saveData: true }])('initial suspension prevents a decoder: %p', async options => {
  const f = fixture(options), m = clone(); m.clipStatus = 'reviewed'; m.clips = [clip()];
  await f.adapter.setManifest(m); expect(f.videos).toHaveLength(0); expect(f.still.src).toBe('/i/miien/neutral.webp');
});
test('enabling data saver removes the only decoder and restores the still', async () => {
  const f = fixture(), m = clone(); m.clipStatus = 'reviewed'; m.clips = [{ ...clip(), poster: '/i/miien/v2-2/idle-neutral.webp' }];
  await f.adapter.setManifest(m); f.connection.saveData = true;
  await f.connection.addEventListener.mock.calls[0][1]();
  expect(f.videos[0].remove).toHaveBeenCalled(); expect(f.still.src).toBe('/i/miien/neutral.webp');
  f.adapter.dispose(); expect(f.connection.removeEventListener).toHaveBeenCalled();
});
test('late poster decode after a mood switch cannot resurrect the previous clip', async () => {
  let resolve; const f = fixture({ decode: src => src.includes('/v2-2/') ? new Promise(r => { resolve = r; }) : Promise.resolve() });
  const m = clone(); m.clipStatus = 'reviewed'; m.clips = [{ ...clip(), poster: '/i/miien/v2-2/idle-neutral.webp' }];
  const loading = f.adapter.setManifest(m); await settle(); await f.adapter.show('concerned', 'idle');
  resolve(); await loading; expect(f.videos).toHaveLength(0); expect(f.still.src).toBe('/i/miien/concerned.webp');
});
