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
    exists: jest.fn(async () => slot ? { _id: slot._id } : null),
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
    category: 'chat5_miien_speech', metadata: { backendId: 'omni_anny_en', stage: 'synthesis', outcome: 'failed', httpStatus: 502, failure: 'provider_or_transport', upstreamUncertain: true,
      timings: expect.objectContaining({ synthesisMs: expect.any(Number), totalMs: expect.any(Number) }) },
  });
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toMatch(/SECRET_TOKEN|private speech|audio secret/);
});

test('dispatches prepared saved Markdown exactly and keeps payloads/fingerprints out of diagnostics', async () => {
  const f = fixture(); const saved = '# Welcome\n\n**Hello** friend.\n- Read [the guide](https://example.invalid).\n- Enjoy `tea`.';
  f.chat.speechText.mockResolvedValue(saved);
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(f.http.post.mock.calls[0][1]).toEqual({ text: 'Welcome\nHello friend.\nRead the guide.\nEnjoy tea.', voice_id: 'omni_anny_en', timeout_sec: 600 });
  expect(job.preparationVersion).toBe('miien-spoken-v1');
  expect(job).not.toHaveProperty('fingerprint');
  expect(job).not.toHaveProperty('preview');
  expect(JSON.stringify([...f.logger.warning.mock.calls, ...f.logger.error.mock.calls])).not.toContain(saved);
  await expect(f.chat.speechText.mock.results[0].value).resolves.toBe(saved);
});
test.each(['```\ncode only\n```', '![only image](https://example.invalid)', '**', '<script>private secret</script>', '*a '.repeat(3000)])('rejects unspeakable/complex input before all costly admission: %#', async raw => {
  const f = fixture(); f.chat.speechText.mockResolvedValue(raw);
  await expect(f.service.submit(user, conversation, body)).rejects.toHaveProperty('status', 422);
  expect(f.service.jobs.size).toBe(0); expect(f.service.active).toBeNull();
  expect(f.slots.create).not.toHaveBeenCalled(); expect(f.http.get).not.toHaveBeenCalled(); expect(f.http.post).not.toHaveBeenCalled();
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toContain('private secret');
});
test('final authorized reload replaces preview, count and fingerprint consistently', async () => {
  const f = fixture();
  f.chat.speechText.mockResolvedValueOnce('old').mockResolvedValue('```\n' + 'x'.repeat(10000) + '\n```\n**' + '🐱'.repeat(601) + '**');
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(f.chat.speechText).toHaveBeenNthCalledWith(2, user, conversation, body.messageId);
  expect(f.http.post.mock.calls[0][1].text).toBe('🐱'.repeat(600));
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ spokenCharacters: 600, truncated: true, status: 'ready' });
  expect(await f.service.submit(user, conversation, body)).toMatchObject({ id: job.id });
  expect(f.http.post).toHaveBeenCalledTimes(1);
});
test.each(['```\ncode\n```', null])('no synthesis when final reload becomes empty or unauthorized: %p', async changed => {
  const f = fixture();
  f.chat.speechText.mockResolvedValueOnce('allowed');
  if (changed === null) f.chat.speechText.mockRejectedValue(new MiienError(404, 'Assistant reply not found.'));
  else f.chat.speechText.mockResolvedValue(changed);
  const job = await f.service.submit(user, conversation, body); await flush();
  expect(f.http.post).not.toHaveBeenCalled(); expect(f.slots.deleteOne).toHaveBeenCalledTimes(1);
  expect(f.service.jobs.get(job.id).status).toBe('failed');
});
test.each(['markup', 'beyond preview', 'version'])('completed reuse invalidates for %s changes', async change => {
  const f = fixture(); const original = 'a'.repeat(601); f.chat.speechText.mockResolvedValue(original);
  const first = await f.service.submit(user, conversation, body); await flush();
  if (change === 'version') f.service.jobs.get(first.id).preparationVersion = 'old-preparation';
  else f.chat.speechText.mockResolvedValue(change === 'markup' ? '**' + original + '**' : original + 'b');
  await expect(f.service.get(user, conversation, first.id, true)).rejects.toHaveProperty('status', 409);
  expect(f.service.jobs.get(first.id).audio).toBeNull();
  const second = await f.service.submit(user, conversation, body); await flush();
  expect(second.id).not.toBe(first.id); expect(f.http.post).toHaveBeenCalledTimes(2);
  expect(f.service.jobs.size).toBe(1);
  expect(await f.service.get(user, conversation, second.id, true)).toEqual(wav());
});
test('changed content cannot create a duplicate active job, even concurrently or after timeout expiry', async () => {
  const f = fixture(); let resolve;
  f.http.post.mockImplementation(() => new Promise(r => { resolve = r; }));
  const first = await f.service.submit(user, conversation, body); await flush();
  f.chat.speechText.mockResolvedValue('**changed**');
  const duplicates = await Promise.all(Array.from({ length: 5 }, () => f.service.submit(user, conversation, body)));
  expect(duplicates.every(job => job.id === first.id)).toBe(true);
  await jest.advanceTimersByTimeAsync(DEADLINE_MS + RETENTION_MS + 1001);
  expect(await f.service.submit(user, conversation, body)).toMatchObject({ id: first.id, status: 'timeout' });
  expect(f.http.post).toHaveBeenCalledTimes(1); expect(f.slots.deleteOne).not.toHaveBeenCalled();
  resolve({ data: wav() }); await flush();
  expect(f.slots.deleteOne).toHaveBeenCalledTimes(1);
});
test('ambiguous failure and changed content retain quarantine and dedupe', async () => {
  const f = fixture(); f.http.post.mockRejectedValue({ response: { status: 502 } });
  const first = await f.service.submit(user, conversation, body); await flush();
  f.chat.speechText.mockResolvedValue('changed');
  expect(await f.service.submit(user, conversation, body)).toMatchObject({ id: first.id, status: 'failed' });
  expect(f.http.post).toHaveBeenCalledTimes(1); expect(f.slots.deleteOne).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(RETENTION_MS + 1001);
  await f.service.submit(user, conversation, body); await flush();
  expect(f.http.post).toHaveBeenCalledTimes(1);
});
test('edited completed job cannot evade active capacity and foreign user cannot reuse its audio', async () => {
  const f = fixture(); const first = await f.service.submit(user, conversation, body); await flush();
  await expect(f.service.get(user, 'd'.repeat(24), first.id, true)).rejects.toHaveProperty('status', 404);
  f.http.post.mockImplementation(() => new Promise(() => {}));
  await f.service.submit(user, conversation, { ...body, messageId: 'd'.repeat(24) }); await flush();
  f.chat.speechText.mockResolvedValue('edited');
  await expect(f.service.submit(user, conversation, body)).rejects.toHaveProperty('status', 429);
  await expect(f.service.submit({ ...user, _id: 'e'.repeat(24) }, conversation, body)).rejects.toHaveProperty('status', 429);
  expect(f.http.post).toHaveBeenCalledTimes(2);
});
test('content changed during synthesis is discarded after reauthorization', async () => {
  const f = fixture(); let resolve; f.http.post.mockImplementation(() => new Promise(r => { resolve = r; }));
  const job = await f.service.submit(user, conversation, body); await flush();
  f.chat.speechText.mockResolvedValue('new reply'); resolve({ data: wav() }); await flush();
  expect(await f.service.get(user, conversation, job.id)).toMatchObject({ status: 'failed' });
  await expect(f.service.get(user, conversation, job.id, true)).rejects.toHaveProperty('status', 409);
  expect(f.slots.deleteOne).toHaveBeenCalledTimes(1);
});

test('admission is an authorized read-only hint with no other job metadata', async () => {
  const f = fixture(); let resolve;
  expect(await f.service.admission(user, conversation, body.messageId)).toEqual({ state: 'available' });
  expect(f.slots.create).not.toHaveBeenCalled(); expect(f.http.get).not.toHaveBeenCalled();
  f.http.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  const a = await f.service.submit(user, conversation, body); await flush();
  expect(await f.service.admission(user, conversation, 'd'.repeat(24))).toEqual({ state: 'occupied' });
  expect(await f.service.admission(user, conversation, body.messageId)).toEqual({ state: 'available' });
  const { MiienSpeechOccupiedError } = require('../../services/miienSpeechService');
  await expect(f.service.submit(user, conversation, { ...body, messageId: 'd'.repeat(24) })).rejects.toBeInstanceOf(MiienSpeechOccupiedError);
  expect(f.service.jobs.size).toBe(1); expect(f.service.active).toBe(a.id);
  f.chat.speechText.mockRejectedValueOnce(new MiienError(404, 'Not found.'));
  await expect(f.service.admission(user, 'f'.repeat(24), body.messageId)).rejects.toHaveProperty('status', 404);
  resolve({ data: wav() }); await flush();
  expect(await f.service.admission(user, conversation, 'd'.repeat(24))).toEqual({ state: 'available' });
});
test.each(['', '../bad', 'a'.repeat(25), [], null])('admission rejects malformed message %p before authorization or slot reads', async messageId => {
  const f = fixture(); await expect(f.service.admission(user, conversation, messageId)).rejects.toHaveProperty('status', 400);
  expect(f.chat.speechText).not.toHaveBeenCalled(); expect(f.slots.exists).not.toHaveBeenCalled();
});
test('admission never releases timed-out or uncertain work, including another process slot', async () => {
  const f = fixture(); let reject;
  f.http.post.mockImplementation(() => new Promise((resolve, fail) => { reject = fail; }));
  await f.service.submit(user, conversation, body); await flush();
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(await f.service.admission(user, conversation, 'd'.repeat(24))).toEqual({ state: 'blocked' });
  reject(new Error('connection lost')); await flush();
  expect(f.service.active).toBeNull();
  expect(await f.service.admission(user, conversation, 'd'.repeat(24))).toEqual({ state: 'blocked' });
  const other = new MiienSpeechService({ chat: f.chat, slots: f.slots, authorize: f.authorize, logger: f.logger, http: f.http });
  expect(await other.admission(user, conversation, 'd'.repeat(24))).toEqual({ state: 'blocked' });
  expect(f.slots.deleteOne).not.toHaveBeenCalled(); expect(f.http.post).toHaveBeenCalledTimes(1);
});
test('admission reports full storage, allows retained duplicates, and ignores expired jobs without mutating GET', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_JOBS; i++) {
    await f.service.submit(user, conversation, { ...body, messageId: i.toString(16).repeat(24) }); await flush();
  }
  expect(await f.service.admission(user, conversation, body.messageId)).toEqual({ state: 'full' });
  expect(await f.service.admission(user, conversation, '0'.repeat(24))).toEqual({ state: 'available' });
  for (const job of f.service.jobs.values()) job.expiresAt = Date.now() - 1;
  expect(await f.service.admission(user, conversation, body.messageId)).toEqual({ state: 'available' });
  expect(f.service.jobs.size).toBe(MAX_JOBS);
});
test('slot read failure fails closed without provider work or private errors at service boundary', async () => {
  const f = fixture(); f.slots.exists.mockRejectedValue(new Error('database unavailable'));
  await expect(f.service.admission(user, conversation, body.messageId)).rejects.toThrow('database unavailable');
  expect(f.slots.create).not.toHaveBeenCalled(); expect(f.http.post).not.toHaveBeenCalled();
});

test('a local job admitted during a durable capacity read is occupied, not uncertain', async () => {
  const f = fixture(); let read, release;
  f.slots.exists.mockImplementationOnce(() => new Promise(resolve => { read = resolve; }));
  const pending = f.service.admission(user, conversation, 'd'.repeat(24)); await flush();
  f.http.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await f.service.submit(user, conversation, body); await flush();
  read({ _id: 'miien-anny-en' });
  expect(await pending).toEqual({ state: 'occupied' });
  release({ data: wav() }); await flush();
});
test('full storage still permits replacing an edited ready reply as submit already does', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_JOBS; i++) {
    await f.service.submit(user, conversation, { ...body, messageId: i.toString(16).repeat(24) }); await flush();
  }
  f.chat.speechText.mockResolvedValue('An edited synthetic reply');
  expect(await f.service.admission(user, conversation, '0'.repeat(24))).toEqual({ state: 'available' });
  await f.service.submit(user, conversation, { ...body, messageId: '0'.repeat(24) }); await flush();
  expect(f.http.post).toHaveBeenCalledTimes(MAX_JOBS + 1); expect(f.service.jobs.size).toBe(MAX_JOBS);
});

test('authorized lifecycle timings isolate provider latency without logging content or success traffic', async () => {
  const f = fixture(); let elapsed = 0;
  f.service.now = () => elapsed;
  f.http.get.mockImplementation(async () => { elapsed += 25; return { data: { voices: [{ voice_id: 'omni_anny_en' }] } }; });
  f.http.post.mockImplementation(async () => { elapsed += 1500; return { data: wav() }; });
  const job = await f.service.submit(user, conversation, body); await flush();
  const result = await f.service.get(user, conversation, job.id);
  expect(result.timings).toEqual({ admissionMs: 0, catalogMs: 25, authorizationMs: 0, synthesisMs: 1500,
    audio_validationMs: 0, retention_authorizationMs: 0, totalMs: 1525 });
  result.timings.synthesisMs = 0;
  expect((await f.service.get(user, conversation, job.id)).timings.synthesisMs).toBe(1500);
  expect(JSON.stringify(result)).not.toContain('private preview');
  expect(f.logger.warning).not.toHaveBeenCalled(); expect(f.logger.error).not.toHaveBeenCalled();
  await expect(f.service.get({ _id: 'd'.repeat(24) }, conversation, job.id)).rejects.toHaveProperty('status', 404);
});
