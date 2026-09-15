const fs = require('fs');
const { parseLosslessJson } = require('../../utils/losslessJson');
const { MusicGatewayService, ACE, YUE, validate, normalizeCatalog, sanitizeMetadata, errorMessage, validPath, transportTimeout } = require('../../services/musicGatewayService');
const rawCatalog = () => parseLosslessJson(fs.readFileSync('tests/fixtures/music/models.json', 'utf8'));
const catalog = () => normalizeCatalog(rawCatalog());
const yue = overrides => ({ model: YUE, caption: 'Acoustic folk', lyrics: '[Verse]\nA boat sails home', ...overrides });
const id = 'yue2:' + 'a'.repeat(32);
const item = { path: `${id}/audio.flac`, name: 'audio.flac', size_bytes: 2048, modified_ts: 123456 };

test('real Gateway registry: stopped/startable is usable even when ready is false', () => {
  expect(catalog().models[1]).toMatchObject({ usable: true, ready: false, availability: 'startable', execution_timeout_sec: 1830 });
  expect(catalog().models[1].limits.seed[1]).toBe('9223372036854775807');
});
test('raw response preserves maximum seeds in every nesting without a dependency', () => {
  const data = parseLosslessJson('{"seed":9223372036854775807,"resolved_settings":{"seed":9223372036854775807,"seeds":[0,9223372036854775807],"config":{"seeds":[9223372036854775807]}},"result":{"audios":[{"seed":9223372036854775807}]}}');
  const clean = sanitizeMetadata(data);
  expect(clean.seed).toBe('9223372036854775807');
  expect(clean.resolved_settings.seeds).toEqual(['0', '9223372036854775807']);
  expect(clean.resolved_settings.config.seeds[0]).toBe('9223372036854775807');
  expect(clean.result.audios[0].seed).toBe('9223372036854775807');
});
test('YuE2 only gets its controls, omitted seed stays omitted and zero is preserved', () => {
  const request = validate(yue({ seed: '' }), catalog());
  expect(request.payload).toEqual({ model: YUE, caption: 'Acoustic folk', lyrics: '[Verse]\nA boat sails home', audio_format: 'flac', timeout_sec: 1830, cot: 'full', max_duration: 20 });
  expect(validate(yue({ seed: '0' }), catalog()).payload.seed).toBe(0);
  expect(request.timeoutMs).toBe((1830 + 900 + 900 + 600 + 60) * 1000);
});
test.each(['thinking', 'instrumental', 'load', 'params', 'config', 'load_llm', 'inference_steps', 'guidance_scale', 'batch_size', 'duration', 'userId', 'audio_url'])('rejects YuE2 forbidden field %s even false', key => {
  expect(() => validate(yue({ [key]: false }), catalog())).toThrow('Unsupported settings');
});
test.each([null, true, -1, '9223372036854775807', 1.5, '2junk'])('rejects invalid or unsafe YuE2 input seed %p', seed => {
  expect(() => validate(yue({ seed }), catalog())).toThrow();
});
describe.each([ACE, YUE])('input seed validation for %s', model => {
  test.each(['0', '123', '9007199254740991'])('accepts exact safe decimal seed %s', seed => {
    expect(String(validate(yue({ model, seed }), catalog()).payload.seed)).toBe(seed);
  });
  test.each(['1.5', '2junk', '9007199254740992', '9223372036854775807'])('rejects malformed or unsafe seed %s', seed => {
    expect(() => validate(yue({ model, seed }), catalog())).toThrow();
  });
});
test.each([{ lyrics: '' }, { lyrics: '  ' }, { caption: 'a'.repeat(2001) }, { lyrics: 'a'.repeat(6001) }, { caption: '界'.repeat(2000), lyrics: '界'.repeat(4000) }, { max_duration: 31 }, { max_duration: 7 }, { max_duration: 20.5 }, { max_duration: 20, max_duration_seconds: 21 }, { cot: 'none', abc: 'C D' }, { abc: '界'.repeat(1400) }, { timeout_sec: 1831 }, { audio_format: 'mp3' }, { model: null }, { model_id: ACE }])('rejects invalid YuE2 contract %p', fields => {
  expect(() => validate(yue(fields), catalog())).toThrow();
});
test('NFC budget and cot off alias, valid ABC and duration alias', () => {
  expect(validate(yue({ caption: 'e\u0301'.repeat(950), lyrics: 'a'.repeat(6000), cot: 'off', max_duration_seconds: '8' }), catalog()).payload).toMatchObject({ cot: 'none', max_duration: 8 });
  expect(validate(yue({ cot: 'melody', abc: 'C D E' }), catalog()).payload.abc).toBe('C D E');
});
test('ACE defaults and useful controls stay ACE-specific and preserve zero', () => {
  const r = validate({ caption: 'folk', seed: '0', duration: 0, guidance_scale: 0, bpm: 1 }, catalog());
  expect(r.payload).toMatchObject({ model: ACE, thinking: false, instrumental: false, duration: 0, guidance_scale: 0, seed: 0, inference_steps: 8, batch_size: 1 });
  expect(r.payload).not.toHaveProperty('max_duration');
  expect(validate({ caption: 'folk', load_llm: 'true', llm_backend: 'pt' }, catalog()).payload).toMatchObject({ thinking: true, load: { load_llm: true, llm_backend: 'pt' } });
});
test.each([{ caption: 'x'.repeat(513) }, { duration: -0.1 }, { inference_steps: 201 }, { batch_size: 9 }, { bpm: 0 }, { timeout_sec: 7201 }, { thinking: true, load_llm: false }, { cot: 'full' }, { llm_backend: 'http://evil' }])('rejects ACE invalid controls %p', fields => {
  expect(() => validate({ caption: 'folk', ...fields }, catalog())).toThrow();
});
test('capability defaults and tightened limits drive the request', () => {
  const raw = rawCatalog(); raw.models[1].defaults.max_duration = 12; raw.models[1].limits.max_duration = [8, 15]; raw.models[1].limits.caption_chars = 100;
  expect(validate(yue(), normalizeCatalog(raw)).payload.max_duration).toBe(12);
  expect(normalizeCatalog(raw).models[1].limits.caption_chars).toBe(100);
  expect(() => validate(yue({ caption: 'a'.repeat(101) }), normalizeCatalog(raw))).toThrow();
  expect(() => validate(yue({ max_duration: 20 }), normalizeCatalog(raw))).toThrow();
});
test.each(['disabled', 'unconfigured', 'not_installed', 'unavailable'])('does not dispatch or substitute unavailable state %s', availability => {
  const raw = rawCatalog(); raw.models[1].availability = availability;
  expect(() => validate(yue(), normalizeCatalog(raw))).toThrow('Selected music model');
});
test('only discovery 404 enables a clearly identified ACE-only legacy fallback', async () => {
  const client = { get: jest.fn().mockRejectedValue({ response: { status: 404 } }), post: jest.fn() };
  const gateway = new MusicGatewayService({ client });
  const old = await gateway.catalog();
  expect(old.legacy).toBe(true);
  expect(old.note).toContain('404');
  expect(() => validate(yue(), old)).toThrow('will not be replaced');
  client.get.mockRejectedValue({ response: { status: 503 } });
  await expect(gateway.catalog()).rejects.toMatchObject({ response: { status: 503 } });
  expect(client.post).not.toHaveBeenCalled();
});
test('generation uses lossless transform and never retries an ambiguous timeout', async () => {
  const client = { post: jest.fn().mockRejectedValue({ code: 'ECONNABORTED' }) };
  const gateway = new MusicGatewayService({ client, baseUrl: 'http://mock.invalid' });
  await expect(gateway.generate(validate(yue(), catalog()))).rejects.toMatchObject({ code: 'ECONNABORTED' });
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(client.post.mock.calls[0][2]).toMatchObject({ maxRedirects: 0, responseType: 'text', transformResponse: [parseLosslessJson] });
});
test('job listing uses job filter, bounded pagination and ignores safe non-audio metadata', async () => {
  const client = { get: jest.fn().mockResolvedValue({ data: { ok: true, items: [item], pages: 1 } }) };
  const gateway = new MusicGatewayService({ client });
  expect(await gateway.jobOutputs({ job_id: id, outputs: [item] }, { legacy: false })).toEqual([item]);
  expect(client.get.mock.calls[0][1].params).toEqual({ job_id: id, page: 1, limit: 200 });
  client.get.mockResolvedValue({ data: { items: [{ path: 'legacy/metadata.json' }, { ...item, path: 'legacy/audio.flac' }] } });
  expect((await gateway.list({ jobId: 'legacy' })).items).toHaveLength(1);
});
test.each(['other/audio.flac', '../audio.flac', '/etc/audio.wav', 'https://evil/audio.flac', 'yue2:bad/audio.flac'])('rejects unauthorized returned output %s', path => {
  const gateway = new MusicGatewayService({ client: { get: jest.fn().mockResolvedValue({ data: { items: [{ path }] } }) } });
  return expect(gateway.list({ jobId: id })).rejects.toThrow();
});
test('missing expected output and excessive output pages fail finalization', async () => {
  const gateway = new MusicGatewayService({ client: { get: jest.fn().mockResolvedValue({ data: { items: [], pages: 1 } }) } });
  await expect(gateway.jobOutputs({ job_id: id, outputs: [item] }, {})).rejects.toThrow('missing');
  gateway.client.get.mockResolvedValue({ data: { items: [item], pages: 3 } });
  await expect(gateway.jobOutputs({ job_id: id, outputs: [item] }, {})).rejects.toThrow('bounded');
});
test('unfinished or wrong-model 200 responses are failures', async () => {
  const client = { post: jest.fn().mockResolvedValue({ status: 200, data: { ok: true, job_id: id, model: ACE, model_id: ACE, outputs: [item] } }) };
  await expect(new MusicGatewayService({ client }).generate(validate(yue(), catalog()))).rejects.toThrow('did not match');
});
test.each(['../secret.flac', '%2e%2e/audio.wav', 'x\\audio.wav', '/tmp/audio.wav', 'https://evil/a.wav', 'yue2:' + 'a'.repeat(32) + '/metadata.json'])('rejects unsafe playback reference %s', path => expect(validPath(path)).toBe(false));
test('safe opaque namespaced and nested legacy paths remain playable', () => {
  expect(validPath(item.path)).toBe(true); expect(validPath('legacy/batch/audio_0.wav')).toBe(true);
});
test('sanitizes provider errors and metadata and bounds total transport budget', () => {
  expect(errorMessage({ response: { status: 422, data: { detail: 'SECRET' } } })).not.toContain('SECRET');
  expect(sanitizeMetadata({ url: 'http://secret', caption: 'private', config: { seed: 0, token: 'SECRET' }, provenance: { source_revision: 'abc' } })).toEqual({ config: { seed: '0' }, provenance: { source_revision: 'abc' } });
  expect(() => transportTimeout({ queue_timeout_sec: 7200, preparation_timeout_sec: 3600, cleanup_timeout_sec: 1800 }, 7200)).toThrow('five-hour');
});
