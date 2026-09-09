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
  w.fetch = fetch || jest.fn().mockResolvedValue(response(job()));
  w.URL.createObjectURL = jest.fn().mockReturnValue('blob:fixture'); w.URL.revokeObjectURL = jest.fn();
  w.audios = []; w.Audio = class {
    constructor(url) { this.src = url; this.play = jest.fn().mockResolvedValue(); this.pause = jest.fn(); this.load = jest.fn(); this.removeAttribute = jest.fn(); w.audios.push(this); }
  };
  w.phases = []; w.addEventListener('miien:voice', event => w.phases.push(event.detail.phase));
  vm.runInContext(source, dom.getInternalVMContext());
  w.MiienVoice.setLatestMessage(messageId);
  if (savedJob) w.MiienVoice.resume();
  return w;
}
const status = w => w.document.getElementById('speech-status').textContent;
const readyFetch = () => jest.fn().mockResolvedValue(response(job('ready'))).mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response(job('ready'))).mockResolvedValueOnce({ ok: true, headers: { get: () => 'audio/wav' }, blob: async () => ({ size: 100 }) });
test('slow Anny preparation is thinking, leaves input usable, and Stop discards late job results', async () => {
  const w = setup(); w.MiienVoice.speak('private text', true, messageId); await settle();
  expect(status(w)).toContain('Preparing Anny'); expect(w.phases).not.toContain('playing');
  expect(w.document.getElementById('message').disabled).toBe(false);
  expect(JSON.parse(w.fetch.mock.calls[0][1].body)).toEqual({ messageId, voiceId: 'anny_en' });
  expect(w.fetch.mock.calls[0][1].body).not.toContain('private text');
  const poll = [...w.timers.values()].find(t => t.ms === 5000).fn;
  w.MiienVoice.stop(); await poll(); expect(w.fetch).toHaveBeenCalledTimes(2);
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
  expect(w.fetch).toHaveBeenCalledTimes(4);
});
test('reload resumes status only, never speaks old history or resubmits', async () => {
  const w = setup({ savedJob: job(), fetch: jest.fn().mockResolvedValue(response(job('ready'))) }); await settle();
  expect(w.fetch).toHaveBeenCalledTimes(1); expect(w.fetch.mock.calls[0][0]).toContain('/speech/' + handle);
  expect(w.audios).toHaveLength(0); expect(status(w)).toContain('Press Replay');
});
test.each(['failed', 'timeout'])('terminal %s stops polling and does not retry', async state => {
  const w = setup({ fetch: jest.fn().mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response({ ...job(state), error: 'Terminal fixture failure' })) });
  w.MiienVoice.speak('reply', true, messageId); await settle();
  expect(w.timers.size).toBe(0); expect(w.fetch).toHaveBeenCalledTimes(2); expect(status(w)).toContain('Terminal fixture');
});
test('restart loss and revoked session terminate with readable fallback', async () => {
  const w = setup({ savedJob: job(), fetch: jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Speech audio expired or was lost after restart.' }) }) });
  await settle(); expect(w.timers.size).toBe(0); expect(status(w)).toContain('lost after restart'); expect(w.phases.at(-1)).toBe('idle');
});
test('stopped in-flight submission and audio fetch never retain a late URL or start playback', async () => {
  let resolve;
  const w = setup({ fetch: jest.fn().mockImplementation(() => new Promise(r => { resolve = r; })) });
  w.MiienVoice.speak('reply', true, messageId); w.MiienVoice.stop(); resolve(response(job())); await settle();
  expect(w.fetch).toHaveBeenCalledTimes(1); expect(w.audios).toHaveLength(0);
  w.fetch = readyFetch().mockReset().mockResolvedValueOnce(response(job())).mockResolvedValueOnce(response(job('ready')))
    .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
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
