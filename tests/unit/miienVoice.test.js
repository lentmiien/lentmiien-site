const fs = require('fs');
const vm = require('vm');
const pug = require('pug');
let JSDOM, dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());
const source = fs.readFileSync('public/js/miien_voice.js', 'utf8');
const messageId = 'c'.repeat(24), handle = '11111111-1111-1111-1111-111111111111';
const job = (status = 'preparing') => ({ id: handle, messageId, voiceId: 'anny_en', backendId: 'omni_anny_en', status, deadlineAt: Date.now() + 1200000, truncated: true, spokenCharacters: 600 });
const response = data => ({ ok: true, json: async () => data });
const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function setup({ mode = 'anny_en', savedJob, fetch } = {}) {
  dom = new JSDOM(pug.renderFile('views/miien_room.pug', { conversation: { _id: 'a'.repeat(24), title: 'Fixture' }, moods: ['neutral'], canWrite: true, canSynthesize: true, csrfToken: 'token' }), {
    url: 'https://fixture.invalid/chat5/miien/' + 'a'.repeat(24), runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window; let timerId = 0;
  w.timers = new Map(); w.setTimeout = (fn, ms) => { const id = ++timerId; w.timers.set(id, { fn, ms }); return id; }; w.clearTimeout = id => w.timers.delete(id);
  w.sessionStorage.setItem('miienVoice', JSON.stringify({ mode, enabled: true }));
  if (savedJob) w.sessionStorage.setItem('miienSpeech:' + 'a'.repeat(24), JSON.stringify(savedJob));
  w.fetch = withAdmission(fetch || jest.fn().mockResolvedValue(response(job())));
  w.URL.createObjectURL = jest.fn().mockReturnValue('blob:fixture'); w.URL.revokeObjectURL = jest.fn();
  w.audios = []; w.Audio = class {
    constructor(url) { this.src = url; this.play = jest.fn().mockResolvedValue(); this.pause = jest.fn(); this.load = jest.fn(); this.removeAttribute = jest.fn(); w.audios.push(this); }
  };
  w.phases = []; w.addEventListener('miien:voice', event => w.phases.push(event.detail.phase));
  w.speechMotion = { start: jest.fn(), stop: jest.fn() };
  w.MiienSpeechMotion = { create: () => w.speechMotion };
  vm.runInContext(source, dom.getInternalVMContext());
  w.MiienVoice.setLatestMessage(messageId);
  if (savedJob) w.MiienVoice.resume();
  return w;
}
const status = w => w.document.getElementById('speech-status').textContent;
const withAdmission = transport => jest.fn((url, options) => url.includes('/speech-admission/')
  ? Promise.resolve(response({ state: 'available' })) : transport(url, options));
const readyFetch = () => jest.fn().mockResolvedValue(response(job('ready'))).mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response(job('ready'))).mockResolvedValueOnce({ ok: true, headers: { get: () => 'audio/wav' }, blob: async () => ({ size: 100 }) });
test('slow Anny preparation is thinking, leaves input usable, and Stop discards late job results', async () => {
  const w = setup(); w.MiienVoice.speak('private text', true, messageId); await settle();
  expect(status(w)).toContain('Preparing Anny'); expect(w.phases).not.toContain('playing');
  expect(w.document.getElementById('message').disabled).toBe(false);
  expect(JSON.parse(w.fetch.mock.calls[1][1].body)).toEqual({ messageId, voiceId: 'anny_en' });
  expect(w.fetch.mock.calls[1][1].body).not.toContain('private text');
  const poll = [...w.timers.values()].find(t => t.ms === 5000).fn;
  w.MiienVoice.stop(); await poll(); expect(w.fetch).toHaveBeenCalledTimes(3);
  expect(status(w)).toContain('may continue'); expect(w.phases.at(-1)).toBe('idle');
});
test('speaking follows actual playing; end, stale events and replay are safe', async () => {
  const w = setup({ fetch: readyFetch() }); w.MiienVoice.speak('reply', true, messageId); await settle();
  const audio = w.audios[0]; expect(audio.play).toHaveBeenCalled(); expect(w.phases).not.toContain('playing');
  const oldPlaying = audio.onplaying; audio.onplaying(); expect(w.phases.at(-1)).toBe('playing');
  audio.onended(); expect(w.phases.at(-1)).toBe('idle'); oldPlaying(); expect(w.phases.at(-1)).toBe('idle');
  w.MiienVoice.speak('reply', true, messageId); await settle(); expect(audio.play).toHaveBeenCalledTimes(2);
  w.MiienVoice.stop(); expect(w.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture'); oldPlaying(); expect(w.phases.at(-1)).toBe('idle');
});
test('autoplay rejection keeps audio for freshly authorized Replay without resynthesis', async () => {
  const w = setup({ fetch: readyFetch() });
  const original = w.Audio;
  w.Audio = class extends original { constructor(url) { super(url); this.play.mockRejectedValueOnce(new Error('blocked')); } };
  w.MiienVoice.speak('reply', true, messageId); await settle();
  expect(status(w)).toContain('press Replay'); expect(w.phases.at(-1)).toBe('idle');
  w.MiienVoice.speak('reply', true, messageId); await settle(); expect(w.audios[0].play).toHaveBeenCalledTimes(2);
  expect(w.fetch).toHaveBeenCalledTimes(5);
});
test('reload resumes status only, never speaks old history or resubmits', async () => {
  const w = setup({ savedJob: job(), fetch: jest.fn().mockResolvedValue(response(job('ready'))) }); await settle();
  expect(w.fetch).toHaveBeenCalledTimes(1); expect(w.fetch.mock.calls[0][0]).toContain('/speech/' + handle);
  expect(w.audios).toHaveLength(0); expect(status(w)).toContain('Press Replay');
});
test.each(['failed', 'timeout'])('terminal %s stops polling and does not retry', async state => {
  const w = setup({ fetch: jest.fn().mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response({ ...job(state), error: 'Terminal fixture failure' })) });
  w.MiienVoice.speak('reply', true, messageId); await settle();
  expect(w.timers.size).toBe(0); expect(w.fetch).toHaveBeenCalledTimes(3); expect(status(w)).toContain('Terminal fixture');
});
test('restart loss and revoked session terminate with readable fallback', async () => {
  const w = setup({ savedJob: job(), fetch: jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Speech audio expired or was lost after restart.' }) }) });
  await settle(); expect(w.timers.size).toBe(0); expect(status(w)).toContain('lost after restart'); expect(w.phases.at(-1)).toBe('idle');
});
test('stopped in-flight submission and audio fetch never retain a late URL or start playback', async () => {
  let resolve;
  const w = setup({ fetch: jest.fn().mockImplementation(() => new Promise(r => { resolve = r; })) });
  w.MiienVoice.speak('reply', true, messageId); await settle(); w.MiienVoice.stop(); resolve(response(job())); await settle();
  expect(w.fetch).toHaveBeenCalledTimes(2); expect(w.audios).toHaveLength(0);
  w.fetch = withAdmission(jest.fn().mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response(job('ready')))
    .mockImplementationOnce(() => new Promise(r => { resolve = r; })));
  w.MiienVoice.speak('reply', true, messageId); await settle(); w.MiienVoice.stop();
  resolve({ ok: true, headers: { get: () => 'audio/wav' }, blob: async () => ({ size: 100 }) }); await settle();
  expect(w.URL.createObjectURL).not.toHaveBeenCalled();
});
test('Off never speaks even on Replay and opting out stops pending work locally', async () => {
  const w = setup({ mode: 'off' }); w.MiienVoice.speak('reply', true, messageId); expect(w.fetch).not.toHaveBeenCalled();
  w.document.getElementById('speech-mode').value = 'anny_en'; w.MiienVoice.speak('reply', true, messageId); await settle();
  const mode = w.document.getElementById('speech-mode'); mode.value = 'off'; mode.dispatchEvent(new w.Event('change'));
  expect(w.timers.size).toBe(0); expect(w.phases.at(-1)).toBe('idle');
});
test('expired preparing handle terminates while completed late audio remains recoverable by status', async () => {
  const expired = { ...job(), deadlineAt: Date.now() - 60000 };
  const w = setup({ savedJob: { ...job(), status: undefined, deadlineAt: expired.deadlineAt }, fetch: jest.fn().mockResolvedValue(response(expired)) });
  await settle(); expect(w.timers.size).toBe(0); expect(status(w)).toContain('deadline');
  dom.window.close();
  const x = setup({ savedJob: { ...job(), status: undefined, deadlineAt: expired.deadlineAt }, fetch: jest.fn().mockResolvedValue(response({ ...expired, status: 'ready' })) });
  await settle(); expect(status(x)).toContain('Press Replay'); expect(x.audios).toHaveLength(0);
});
test('a restored result for an older reply is discarded after history advances', async () => {
  const w = setup({ savedJob: job(), fetch: jest.fn().mockResolvedValue(response(job('ready'))) });
  w.MiienVoice.setLatestMessage('d'.repeat(24)); await settle();
  expect(w.audios).toHaveLength(0); expect(status(w)).toMatch(/latest reply|earlier reply/); expect(w.timers.size).toBe(0);
});

test.each([{ id: '22222222-2222-2222-2222-222222222222' }, { messageId: 'd'.repeat(24) }, { backendId: 'anny_en' }, { backendId: undefined }, { voiceId: 'omni_anny_en' }])('rejects a mismatched status result: %p', async patch => {
  const w = setup({ fetch: jest.fn().mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response({ ...job('ready'), ...patch })) });
  w.MiienVoice.speak('reply', true, messageId); await settle();
  expect(w.audios).toHaveLength(0); expect(w.URL.createObjectURL).not.toHaveBeenCalled();
  expect(status(w)).toContain('does not match'); expect(w.timers.size).toBe(0);
});
test('cached Replay reauthorizes and destroys audio if access was revoked', async () => {
  const w = setup({ fetch: readyFetch() }); w.MiienVoice.speak('reply', true, messageId); await settle();
  const audio = w.audios[0]; audio.onended();
  w.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Permission revoked' }) });
  w.MiienVoice.speak('reply', true, messageId);
  expect(audio.play).toHaveBeenCalledTimes(1); await settle();
  expect(audio.play).toHaveBeenCalledTimes(1); expect(w.URL.revokeObjectURL).toHaveBeenCalled();
  expect(w.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  expect(status(w)).toContain('permission could not be verified');
});
test('Stop during cached Replay authorization discards a late success', async () => {
  const w = setup({ fetch: readyFetch() }); w.MiienVoice.speak('reply', true, messageId); await settle();
  let resolve; w.fetch.mockImplementation(() => new Promise(r => { resolve = r; }));
  const audio = w.audios[0]; w.MiienVoice.speak('reply', true, messageId); w.MiienVoice.stop();
  resolve(response(job('ready'))); await settle(); expect(audio.play).toHaveBeenCalledTimes(1);
});
test('legacy restored handles lacking backend/message attribution fail closed without fetching', async () => {
  const w = setup({ savedJob: { id: handle, deadlineAt: Date.now() + 1200000 } }); await settle();
  expect(w.fetch).not.toHaveBeenCalled(); expect(status(w)).toContain('does not match');
});

test('speech animation follows playing, pause, buffering, seeking, end, error and teardown', async () => {
  const w = setup({ fetch: readyFetch() }); w.MiienVoice.speak('reply', true, messageId); await settle();
  const audio = w.audios[0]; expect(w.speechMotion.start).not.toHaveBeenCalled();
  audio.onplaying(); expect(w.speechMotion.start).toHaveBeenLastCalledWith(audio);
  for (const event of ['onpause', 'onwaiting', 'onstalled', 'onseeking']) {
    audio.onplaying(); const count = w.speechMotion.stop.mock.calls.length;
    audio[event](); expect(w.speechMotion.stop).toHaveBeenCalledTimes(count + 1);
    expect(w.phases.at(-1)).not.toBe('playing');
  }
  audio.paused = true; audio.readyState = 4; audio.onseeked(); expect(w.phases.at(-1)).toBe('idle');
  audio.paused = false; audio.onseeked(); expect(w.phases.at(-1)).toBe('playing');
  const old = audio.onplaying; audio.onended(); old(); expect(w.phases.at(-1)).toBe('idle');
  w.MiienVoice.speak('reply', true, messageId); await settle();
  audio.onplaying(); audio.onerror(); expect(w.phases.at(-1)).toBe('idle');
  expect(audio.onseeking).toBeNull();
  w.dispatchEvent(new w.Event('pagehide')); expect(w.speechMotion.stop).toHaveBeenCalled();
});

test('browser speech pause/resume and stale events reset the independent speech envelope', () => {
  const w = setup({ mode: 'browser' }); let utterance;
  w.SpeechSynthesisUtterance = class {};
  w.speechSynthesis = { cancel: jest.fn(), getVoices: () => [], addEventListener: jest.fn(), speak: value => { utterance = value; } };
  vm.runInContext(source, dom.getInternalVMContext());
  w.MiienVoice.speak('Short reply', true);
  expect(w.speechMotion.start).not.toHaveBeenCalled();
  utterance.onstart(); expect(w.phases.at(-1)).toBe('playing');
  utterance.onpause(); expect(w.phases.at(-1)).toBe('idle');
  utterance.onresume(); expect(w.phases.at(-1)).toBe('playing');
  w.MiienVoice.stop(); const count = w.speechMotion.start.mock.calls.length;
  utterance.onresume(); expect(w.speechMotion.start).toHaveBeenCalledTimes(count);
  expect(w.phases.at(-1)).toBe('idle');
});

test('voice adapter checks live local eligibility for manual/automatic entry and delayed audio events', async () => {
  const w = setup({ fetch: readyFetch() }); let allowed = false;
  w.MiienVoice.setEligibility(() => allowed);
  w.MiienVoice.speak('reply', true, messageId); w.MiienVoice.speak('reply', false, messageId);
  expect(w.fetch).not.toHaveBeenCalled();
  allowed = true; w.MiienVoice.speak('reply', false, messageId); await settle();
  const audio = w.audios[0]; allowed = false;
  audio.onplaying(); expect(w.phases).not.toContain('playing');
  w.MiienVoice.stop(); allowed = true; audio.onplaying?.();
  expect(w.phases.at(-1)).toBe('idle');
});

test('buffering and interrupted playback details never claim synthesis is speaking', async () => {
  const w = setup({ fetch: readyFetch() }); w.MiienVoice.speak('reply', true, messageId); await settle();
  const audio = w.audios[0]; expect(w.phases.at(-1)).toBe('preparing');
  audio.onplaying(); audio.onwaiting(); expect(w.phases.at(-1)).toBe('buffering'); expect(status(w)).toContain('Buffering');
  audio.onplaying(); audio.onpause(); expect(w.phases.at(-1)).toBe('idle'); expect(status(w)).toContain('paused');
  audio.paused = false; audio.readyState = 2; audio.onseeked();
  expect(w.phases.at(-1)).toBe('buffering'); expect(status(w)).toContain('Buffering');
});

test.each(['hidden', 'pagehide', 'latest reply'])('%s invalidates an unresolved play promise and saved callbacks', async action => {
  const w = setup({ fetch: readyFetch() }); let rejectPlay;
  const OriginalAudio = w.Audio;
  w.Audio = class extends OriginalAudio { constructor(url) { super(url); this.play.mockImplementation(() => new Promise((resolve, reject) => { rejectPlay = reject; })); } };
  w.MiienVoice.speak('reply', true, messageId); await settle(); const oldPlaying = w.audios[0].onplaying;
  if (action === 'hidden') { Object.defineProperty(w.document, 'hidden', { value: true }); w.document.dispatchEvent(new w.Event('visibilitychange')); }
  if (action === 'pagehide') w.dispatchEvent(new w.Event('pagehide'));
  if (action === 'latest reply') w.MiienVoice.setLatestMessage('d'.repeat(24));
  const stopped = status(w); rejectPlay(new Error('Late autoplay denial')); oldPlaying(); await settle();
  expect(status(w)).toBe(stopped); expect(w.phases.at(-1)).toBe('idle'); expect(w.URL.revokeObjectURL).toHaveBeenCalled();
});

const runWait = async w => {
  const entry = [...w.timers.entries()].find(([, timer]) => timer.ms === 5000);
  if (entry) { w.timers.delete(entry[0]); await entry[1].fn(); await settle(); }
};
test.each([
  [429, { error: 'Too many requests' }],
  [429, { error: 'Storage full' }],
  [403, { error: 'Permission revoked', code: 'speech_admission_occupied' }],
  [400, { error: 'Invalid message' }],
  [503, { error: 'Quota unavailable' }],
  [502, { error: 'Uncertain upstream failure' }],
])('HTTP %s without exact safe deferral contract never retries', async (code, body) => {
  const w = setup();
  w.fetch.mockImplementation(url => Promise.resolve(url.includes('/speech-admission/')
    ? response({ state: 'available' }) : { ok: false, status: code, json: async () => body }));
  w.MiienVoice.speak('reply', true, messageId); await settle(); await runWait(w);
  expect(w.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  expect(w.timers.size).toBe(0); expect(status(w)).toContain(body.error);
});
test.each(['network', 'session HTML', 'invalid capacity', 'blocked', 'full'])('%s during capacity check is terminal without a speech POST', async outcome => {
  const w = setup();
  w.fetch.mockImplementation(async () => {
    if (outcome === 'network') throw new Error('Network unavailable');
    if (outcome === 'session HTML') return { ok: false, status: 401, json: async () => { throw new Error('HTML'); } };
    return response({ state: outcome });
  });
  w.MiienVoice.speak('reply', true, messageId); await settle(); await runWait(w);
  expect(w.fetch).toHaveBeenCalledTimes(1); expect(w.timers.size).toBe(0);
  expect(w.audios).toHaveLength(0);
});
test('racing safe occupied POST defers through GET, spaces one reattempt by a minute, then stops', async () => {
  const w = setup(); let now = Date.now(); w.Date.now = () => now;
  w.fetch.mockImplementation(async url => url.includes('/speech-admission/') ? response({ state: 'available' })
    : { ok: false, status: 429, json: async () => ({ error: 'No job accepted', code: 'speech_admission_occupied' }) });
  const posts = () => w.fetch.mock.calls.filter(([, options]) => options.method === 'POST');
  w.MiienVoice.speak('reply', true, messageId); await settle(); expect(posts()).toHaveLength(1);
  for (let i = 0; i < 11; i++) { now += 5000; await runWait(w); }
  expect(posts()).toHaveLength(1); expect(status(w)).toContain('Waiting');
  now += 5000; await runWait(w); expect(posts()).toHaveLength(2);
  expect(w.timers.size).toBe(0); expect(status(w)).toContain('No further automatic attempt');
  await runWait(w); expect(posts()).toHaveLength(2);
});
test('safe occupied POST can recover once without retrying an accepted job', async () => {
  const w = setup(); let now = Date.now(), posts = 0; w.Date.now = () => now;
  w.fetch.mockImplementation(async (url, options) => {
    if (url.includes('/speech-admission/')) return response({ state: 'available' });
    if (options.method === 'POST' && ++posts === 1) return { ok: false, status: 429, json: async () => ({ code: 'speech_admission_occupied' }) };
    return response(job());
  });
  w.MiienVoice.speak('reply', true, messageId); await settle();
  now += 60000; await runWait(w); await runWait(w);
  expect(posts).toBe(2); expect(status(w)).toContain('Preparing Anny');
});
test('a network failure after POST is uncertain and never retried', async () => {
  const w = setup(); w.fetch.mockImplementation(async url => {
    if (url.includes('/speech-admission/')) return response({ state: 'available' });
    throw new Error('Connection lost');
  });
  w.MiienVoice.speak('reply', true, messageId); await settle(); await runWait(w);
  expect(w.fetch).toHaveBeenCalledTimes(2); expect(w.timers.size).toBe(0);
  expect(status(w)).toContain('No further automatic attempt');
});
test('capacity polling has an independent 240-read ceiling even if the clock moves backwards', async () => {
  const w = setup(); w.fetch.mockResolvedValue(response({ state: 'occupied' }));
  w.MiienVoice.speak('reply', true, messageId); await settle();
  w.Date.now = () => 0;
  for (let i = 0; i < 240; i++) await runWait(w);
  expect(w.fetch).toHaveBeenCalledTimes(240); expect(w.timers.size).toBe(0);
  expect(status(w)).toContain('20 minutes');
});
test('stopped admission response and timeout callback cannot restart or overwrite a newer wait', async () => {
  const w = setup(); let resolve;
  w.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  w.MiienVoice.speak('reply', true, messageId);
  const oldTimeout = [...w.timers.values()].find(timer => timer.ms === 1200000).fn;
  w.MiienVoice.stop(); w.fetch.mockResolvedValue(response({ state: 'occupied' }));
  w.MiienVoice.speak('reply', true, messageId); await settle(); const text = status(w);
  resolve(response({ state: 'available' })); await settle(); oldTimeout();
  expect(status(w)).toBe(text); expect(w.fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
  expect([...w.timers.values()].filter(timer => timer.ms === 5000)).toHaveLength(1);
});

test('a capacity response arriving after the wait deadline cannot submit even before the watchdog runs', async () => {
  const w = setup(); let resolve, now = Date.now(); w.Date.now = () => now;
  w.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  w.MiienVoice.speak('reply', true, messageId); now += 1200000;
  resolve(response({ state: 'available' })); await settle();
  expect(w.fetch).toHaveBeenCalledTimes(1); expect(w.timers.size).toBe(0); expect(status(w)).toContain('20 minutes');
});
