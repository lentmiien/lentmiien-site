const { MiienSpeechService, DEADLINE_MS, RETENTION_MS, MAX_JOBS } = require('../../services/miienSpeechService');
const { MiienError } = require('../../services/miienChatService');
const { validSpeechWav, MAX_SPEECH_BYTES } = require('../../utils/miienAudio');
const user = { _id: 'b'.repeat(24), name: 'owner' }, conversation = 'a'.repeat(24);
const body = { messageId: 'c'.repeat(24), voiceId: 'anny_en' };
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
function wav() {
  const b = Buffer.alloc(48); b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4, 40);
  return b;
}
function fixture() {
  let slot = null;
  const slots = {
    create: jest.fn(async value => { if (slot) throw Object.assign(new Error('duplicate'), { code: 11000 }); slot = value; }),
    deleteOne: jest.fn(async () => { slot = null; }),
  };
  const chat = { speechText: jest.fn().mockResolvedValue('private preview '.repeat(70)) };
  const authorize = jest.fn().mockResolvedValue(user);
  const logger = { warning: jest.fn(), error: jest.fn() };
  const http = { get: jest.fn().mockResolvedValue({ data: { voices: [{ voice_id: 'omni_anny_en' }] } }), post: jest.fn().mockResolvedValue({ data: wav() }) };
  const service = new MiienSpeechService({ chat, slots, authorize, logger, http });
  return { service, slots, chat, authorize, logger, http };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('short submission, bounded preview, exact voice, private memory audio and dedupe', async () => {
  const f = fixture(); const job = await f.service.submit(user, conversation, body);
  expect(job.status).toBe('preparing');
  expect(job).toMatchObject({ voiceId: 'anny_en', backendId: 'omni_anny_en' });
  await flush();
  expect(f.http.post).toHaveBeenCalledTimes(1);
  expect(f.http.post.mock.calls[0][1]).toEqual({ text: ('private preview '.repeat(70)).slice(0, 600), voice_id: 'omni_anny_en', timeout_sec: 600 });
  expect(f.http.post.mock.calls[0][2]).toMatchObject({ maxRedirects: 0, maxContentLength: MAX_SPEECH_BYTES, timeout: DEADLINE_MS });
  expect(await f.service.get(user, conversation, job.id, true)).toEqual(wav());
  expect(await f.service.submit(user, conversation, body)).toMatchObject({ id: job.id, status: 'ready', truncated: true });
  expect(f.slots.create.mock.calls[0][0]).not.toHaveProperty('text');
  expect(f.slots.create.mock.calls[0][0]._id).toBe('miien-anny-en');
  expect(f.slots.deleteOne).toHaveBeenCalled();
  expect(f.authorize).toHaveBeenCalledTimes(2);
});
test.each([{ text: 'injected' }, { voiceId: 'qwen_anny_en' }, { voiceId: 'omni_anny_en' }, { messageId: '../../file' }, { url: 'http://evil' }, { owner: 'foreign' }])('rejects untrusted fields before dispatch: %p', async patch => {
  const f = fixture(); await expect(f.service.submit(user, conversation, { ...body, ...patch })).rejects.toHaveProperty('status', 400);
  expect(f.http.post).not.toHaveBeenCalled();
});
test('foreign saved message denied before claiming capacity', async () => {
  const f = fixture(); f.chat.speechText.mockRejectedValue(new MiienError(404, 'Not found'));
  await expect(f.service.submit(user, conversation, body)).rejects.toHaveProperty('status', 404);
  expect(f.slots.create).not.toHaveBeenCalled();
});
test('one outstanding synthesis, including browser leaving, with no duplicate retries', async () => {
  const f = fixture(); let resolve; f.http.post.mockImplementation(() => new Promise(r => { resolve = r; }));
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(await f.service.submit(user, conversation, body)).toMatchObject({ id: job.id });
  await expect(f.service.submit({ ...user, _id: 'd'.repeat(24) }, conversation, body)).rejects.toHaveProperty('status', 429);
  expect(f.http.post).toHaveBeenCalledTimes(1); expect(f.slots.deleteOne).not.toHaveBeenCalled();
  resolve({ data: wav() }); await flush(); expect(f.slots.deleteOne).toHaveBeenCalled();
});
test('deadline terminates polling; late data is disposed and admission stays until actual settlement', async () => {
  const f = fixture(); let resolve; f.http.post.mockImplementation(() => new Promise(r => { resolve = r; }));
  const job = await f.service.submit(user, conversation, body); await flush();
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ status: 'timeout' });
  expect(f.slots.deleteOne).not.toHaveBeenCalled(); expect(f.service.active).toBe(job.id);
  resolve({ data: wav() }); await flush();
  await expect(f.service.get(user, conversation, job.id, true)).rejects.toHaveProperty('status', 409);
  expect(f.slots.deleteOne).toHaveBeenCalled();
});
test.each([502, undefined])('ambiguous failure %s keeps durable admission and logs no payload', async status => {
  const f = fixture(); f.http.post.mockRejectedValue(Object.assign(new Error('private-secret'), { response: { status, data: 'private audio' } }));
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ status: 'failed' });
  expect(f.slots.deleteOne).not.toHaveBeenCalled();
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toMatch(/private-secret|private audio|private preview/);
  const again = await f.service.submit(user, conversation, { ...body, messageId: 'd'.repeat(24) }); await flush();
  expect(await f.service.get(user, conversation, again.id)).toMatchObject({ status: 'failed' });
  expect(f.http.post).toHaveBeenCalledTimes(1);
});
test.each([400, 404, 422])('explicit upstream validation %s releases admission without retry', async status => {
  const f = fixture(); f.http.post.mockRejectedValue({ response: { status } });
  await f.service.submit(user, conversation, body); await flush();
  expect(f.slots.deleteOne).toHaveBeenCalledTimes(1); expect(f.http.post).toHaveBeenCalledTimes(1);
});
test.each(['anny_en', 'qwen_anny_en'])('catalog absence cannot silently substitute %s', async selector => {
  const f = fixture(); f.http.get.mockResolvedValue({ data: { voices: [{ voice_id: selector }] } });
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ status: 'failed' });
  expect(f.http.post).not.toHaveBeenCalled(); expect(f.slots.deleteOne).toHaveBeenCalled();
});
test('revoked principal before dispatch or completion cannot generate/deliver audio', async () => {
  const f = fixture(); f.authorize.mockResolvedValue(null);
  await f.service.submit(user, conversation, body); await flush(); expect(f.http.post).not.toHaveBeenCalled();
  const g = fixture(); g.authorize.mockResolvedValueOnce(user).mockResolvedValue(null);
  const job = await g.service.submit(user, conversation, body); await flush();
  await expect(g.service.get(user, conversation, job.id, true)).rejects.toHaveProperty('status', 409);
});
test('status and audio recheck membership and principal ownership', async () => {
  const f = fixture(); const job = await f.service.submit(user, conversation, body); await flush();
  await expect(f.service.get({ ...user, _id: 'foreign' }, conversation, job.id, true)).rejects.toHaveProperty('status', 404);
  f.chat.speechText.mockRejectedValue(new MiienError(404, 'Not found'));
  await expect(f.service.get(user, conversation, job.id, true)).rejects.toHaveProperty('status', 404);
  expect(f.service.jobs.get(job.id).audio).toBeNull();
});
test('memory capacity and expiry are bounded; restart reports lost audio and honors durable slot', async () => {
  const f = fixture();
  for (let n = 0; n < MAX_JOBS; n++) { await f.service.submit(user, conversation, { ...body, messageId: n.toString(16).padStart(24, '0') }); await flush(); }
  await expect(f.service.submit(user, conversation, body)).rejects.toHaveProperty('status', 429);
  const job = [...f.service.jobs.values()][0];
  await jest.advanceTimersByTimeAsync(RETENTION_MS + 1001);
  await expect(f.service.get(user, conversation, job.id)).rejects.toHaveProperty('status', 410);
  expect(f.service.jobs.size).toBe(0);
  const g = fixture(); g.http.post.mockImplementation(() => new Promise(() => {}));
  const active = await g.service.submit(user, conversation, body); await flush();
  const restarted = new MiienSpeechService({ ...g, chat: g.chat, slots: g.slots });
  await expect(restarted.get(user, conversation, active.id)).rejects.toHaveProperty('status', 410);
  const next = await restarted.submit(user, conversation, body); await flush();
  expect(await restarted.get(user, conversation, next.id)).toMatchObject({ status: 'failed' });
  expect(g.http.post).toHaveBeenCalledTimes(1);
});
test('WAV bounds reject non-PCM, incorrect sizes, malicious bytes and malformed chunks', () => {
  expect(validSpeechWav(wav())).toBe(true);
  const nonPcm = wav(); nonPcm.writeUInt16LE(3, 20);
  const badSize = wav(); badSize.writeUInt32LE(500, 40);
  for (const value of [nonPcm, badSize, Buffer.from('<script>'), Buffer.alloc(MAX_SPEECH_BYTES + 1), 'not buffer']) expect(validSpeechWav(value)).toBe(false);
});
test('invalid complete WAV fails without retaining content', async () => {
  const f = fixture(); f.http.post.mockResolvedValue({ data: Buffer.from('private bad audio') });
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ status: 'failed' });
  expect(f.slots.deleteOne).toHaveBeenCalled();
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toContain('private bad audio');
});
test('Unicode preview never splits a surrogate pair and never sends more than 600 code points', async () => {
  const f = fixture(); f.chat.speechText.mockResolvedValue('🐱'.repeat(601));
  await f.service.submit(user, conversation, body); await flush();
  expect(f.http.post.mock.calls[0][1].text).toBe('🐱'.repeat(600));
});
test.each(['not-an-origin', 'file:///tmp/audio', 'https://user:password@host.invalid', 'http://host.invalid/tts', 'http://host.invalid/tts/', 'http://host.invalid/?token=x', 'http://host.invalid/#fragment'])('invalid optional origin %s fails only on use, before network or admission', async apiBase => {
  const f = fixture();
  const service = new MiienSpeechService({ ...f, apiBase });
  expect(f.logger.error).not.toHaveBeenCalled();
  await expect(service.submit(user, conversation, body)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Anny is unavailable') });
  await expect(service.voices()).rejects.toHaveProperty('status', 503);
  expect(f.http.get).not.toHaveBeenCalled();
  expect(f.http.post).not.toHaveBeenCalled();
  expect(f.slots.create).not.toHaveBeenCalled();
  expect(service.jobs.size).toBe(0);
  expect(f.logger.error).toHaveBeenCalledWith(expect.stringContaining('check TTS_API_BASE'), { category: 'chat5_miien_speech' });
  expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(apiBase);
});
test.each(['http://gateway.invalid:8080', 'https://gateway.invalid/'])('valid origin %s uses only fixed server endpoints', async apiBase => {
  const f = fixture();
  const service = new MiienSpeechService({ ...f, apiBase });
  await service.submit(user, conversation, body); await flush();
  expect(f.http.get).toHaveBeenCalledWith(`${new URL(apiBase).origin}/tts/voices`, expect.objectContaining({ maxRedirects: 0 }));
  expect(f.http.post).toHaveBeenCalledWith(`${new URL(apiBase).origin}/tts`, expect.any(Object), expect.objectContaining({ maxRedirects: 0 }));
});

test('failure attribution is bounded and never copies arbitrary provider fields', async () => {
  const f = fixture();
  f.http.post.mockRejectedValue({ code: 'SECRET_TOKEN', message: 'private speech', response: { status: 502, data: 'audio secret' } });
  await f.service.submit(user, conversation, body); await flush();
  expect(f.logger.warning).toHaveBeenCalledWith(expect.any(String), {
    category: 'chat5_miien_speech', metadata: { backendId: 'omni_anny_en', stage: 'synthesis', outcome: 'failed', httpStatus: 502, failure: 'provider_or_transport', upstreamUncertain: true },
  });
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toMatch(/SECRET_TOKEN|private speech|audio secret/);
});
