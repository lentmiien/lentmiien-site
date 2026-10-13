const { config } = require('../../services/embeddingGemma2/config');
const { input, response, vector, MODEL, REVISION, SPACE } = require('../../services/embeddingGemma2/contract');
const { gateway } = require('../../services/embeddingGemma2/gateway');
const { models, schema } = require('../../models/embeddinggemma2_pilot');
const mongoose = require('mongoose');
const v = () => [1, ...Array(767).fill(0)];
const mappings = {
  image: { width: 64, height: 64, exif_orientation_applied: true, vision_soft_tokens_max: 280 },
  audio: { duration_seconds: 1, sampling_rate: 16000, channels: 1, samples: 16000 },
  video: { duration_seconds: 1, frames: 1, sample_fps: 1, sample_grid_seconds: [0], sampling: 'ffmpeg fps start_time=0 round=near; grid times, not original frame PTS', width: 32, height: 32, rotation_applied: false, soundtrack: 'ignored', vision_soft_tokens_per_frame_max: 140, processor_resampling: false, model_timestamp_tokens: false },
};
const payload = (kind = 'text', role = 'document', title = false) => ({ model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, precision: 'bfloat16', vectors: [v()], chunks: [{ index: 0, input_index: 0, kind, role, title_supplied: title, tokens: 100, ...mappings[kind] }], preprocessing: { version: 'pilot-v1', batch_size: 1, truncation: false, text_prefixes: 'role-specific; text only' } });
test('defaults require no setup and validate optional bounds and origin', () => {
  expect(config({}).enabled).toBe(true);
  expect(config({ EMBEDDINGGEMMA2_ENABLED: '' }).enabled).toBe(true);
  expect(config({ EMBEDDINGGEMMA2_ENABLED: 'false' }).enabled).toBe(false);
  expect(config({}).root).toBe(require('path').resolve(__dirname, '../../private_data/embeddinggemma2_test'));
  expect(config({ EMBEDDINGGEMMA2_DB_NAME: 'obsolete', EMBEDDINGGEMMA2_STORAGE_DIR: 'obsolete' })).toEqual(config({}));
  for (const env of [{ EMBEDDINGGEMMA2_ENABLED: 'yes' }, { EMBEDDINGGEMMA2_TIMEOUT_MS: '15000' }, { EMBEDDINGGEMMA2_USER_ITEMS: 'Infinity' }, { AI_GATEWAY_BASE_URL: 'http://user:pass@host' }, { AI_GATEWAY_BASE_URL: 'file:///tmp' }, { AI_GATEWAY_BASE_URL: 'http://host/embed' }]) expect(() => config(env)).toThrow();
});
test('both models register only the dedicated collection on the primary connection', () => {
  const connection = { readyState: 1, models: {}, model: jest.fn((name, definition) => ({ name, definition })), useDb: jest.fn() };
  const result = models(connection);
  expect(connection.useDb).not.toHaveBeenCalled();
  expect(connection.model).toHaveBeenCalledTimes(2);
  for (const model of Object.values(result)) expect(model.definition.options.collection).toBe('embeddinggemma2_test');
  expect(() => models({ ...connection, readyState: 0 })).toThrow('unavailable');
  expect(schema.indexes()).toEqual([[expect.objectContaining({ owner: 1, state: 1, space_id: 1 }), expect.objectContaining({ partialFilterExpression: { recordType: 'entry' } })]]);
});
test('document/query mapping uses raw items and fixed paths with bounded no-redirect cold requests', async () => {
  const client = { post: jest.fn().mockResolvedValue({ data: payload('text', 'document', true) }) };
  const embed = gateway(config({}), client);
  await embed({ kind: 'text', text: 'raw document', title: 'title' }, null, false);
  expect(client.post).toHaveBeenLastCalledWith('http://192.168.0.20:8080/embed/embeddinggemma2', { dimensions: 768, items: [{ text: 'raw document', title: 'title', role: 'document' }] }, expect.objectContaining({ timeout: 1800000, maxRedirects: 0, maxContentLength: 131072, proxy: false }));
  client.post.mockResolvedValue({ data: payload('text', 'query') });
  await embed({ kind: 'text', text: 'raw query' }, null, true);
  expect(client.post.mock.calls[1][1]).toEqual({ dimensions: 768, items: [{ text: 'raw query', role: 'query' }] });
});
test.each(['image', 'audio', 'video'])('native %s forwards the original bytes as octet-stream', async kind => {
  const bytes = Buffer.from('synthetic'); const client = { post: jest.fn().mockResolvedValue({ data: payload(kind) }) };
  await gateway(config({}), client)({ kind }, bytes, true);
  expect(client.post).toHaveBeenCalledWith(`http://192.168.0.20:8080/embed/embeddinggemma2/media?kind=${kind}&dimensions=768`, bytes, expect.objectContaining({ headers: { 'Content-Type': 'application/octet-stream' } }));
});
test.each(['revision', 'model', 'space_id', 'dimensions', 'normalized', 'precision'])('rejects incompatible %s', key => {
  expect(() => response({ ...payload(), [key]: 'wrong' }, { kind: 'text' }, 'document')).toThrow();
});
test('rejects cardinality, nonfinite/zero/wrong dimension, mapping and preprocessing; normalizes', () => {
  for (const vectorValue of [Array(768).fill(0), [1], [...v().slice(1), NaN], [...v().slice(1), Infinity]]) expect(() => vector(vectorValue)).toThrow();
  expect(Math.hypot(...vector(v().map(n => n * 2)))).toBeCloseTo(1);
  for (const change of [{ vectors: [v(), v()] }, { chunks: [] }, { chunks: [{ index: 1, input_index: 0, kind: 'text', role: 'document' }] }, { preprocessing: { version: 'wrong' } }, { vectors: [v().map(n => n * 2)] }]) expect(() => response({ ...payload(), ...change }, { kind: 'text' }, 'document')).toThrow();
});
test('strict input rejects URLs, ownership, preformatted text, excessive work and query titles', () => {
  expect(input({ kind: 'text', text: '<script>alert(1)</script>' }, null, false).text).toContain('<script>');
  for (const body of [{ kind: 'text', text: 'x', owner: 'other' }, { kind: 'text', text: 'task: prefixed' }, { kind: 'text', text: 'x'.repeat(16001) }, { kind: 'text', text: 'x', title: 'query' }, { kind: 'text', text: 'x', topK: true }, { kind: 'text', text: 'x', topK: 51 }, { kind: 'image', url: 'http://localhost' }]) expect(() => input(body, null, true)).toThrow();
});
test('provider errors never expose body or underlying error text and never retry', async () => {
  const client = { post: jest.fn().mockRejectedValue({ isAxiosError: true, message: 'SECRET', response: { status: 500, data: 'SECRET BODY' } }) };
  await expect(gateway(config({}), client)({ kind: 'text', text: 'x' }, null, false)).rejects.toThrow('Gateway unavailable');
  expect(client.post).toHaveBeenCalledTimes(1);
});
test('schema requires identity and normalized vector in feature-owned collection', async () => {
  const Model = mongoose.models.Eg2Test || mongoose.model('Eg2Test', schema);
  const model = new Model({ owner: new mongoose.Types.ObjectId(), state: 'ready', kind: 'text', text: 'x', bytes: 1, ...response(payload(), { kind: 'text' }, 'document') });
  await expect(model.validate()).resolves.toBeUndefined();
  model.vector = Array(768).fill(0); await expect(model.validate()).rejects.toThrow();
  expect(schema.options.collection).toBe('embeddinggemma2_test');
});

test.each(['text', 'image', 'audio', 'video'])('requires every documented %s preprocessing field and discards extras', kind => {
  const valid = payload(kind);
  expect(response(valid, { kind }, 'document').mapping.tokens).toBe(100);
  for (const key of ['tokens', ...Object.keys(mappings[kind] || {})]) {
    const bad = payload(kind); delete bad.chunks[0][key];
    expect(() => response(bad, { kind }, 'document')).toThrow();
  }
  valid.chunks[0].url = 'https://private.invalid'; valid.preprocessing.prompt = 'private';
  const result = response(valid, { kind }, 'document');
  expect(JSON.stringify(result)).not.toContain('private');
});
test.each([
  ['audio', { duration_seconds: 10.1, samples: 161600 }], ['audio', { samples: 10 }], ['audio', { sampling_rate: 48000 }], ['audio', { duration_seconds: 2 }], ['audio', { channels: 2 }],
  ['video', { frames: 9 }], ['video', { sample_grid_seconds: [1] }], ['video', { width: 769 }], ['video', { soundtrack: 'included' }], ['video', { duration_seconds: NaN }],
  ['image', { width: 4097 }], ['image', { width: 3000, height: 3000 }], ['text', { tokens: 8193 }], ['text', { tokens: '100' }],
])('rejects invalid %s preprocessing %j', (kind, mapping) => {
  const data = payload(kind); Object.assign(data.chunks[0], mapping);
  expect(() => response(data, { kind }, 'document')).toThrow('metadata');
});
test.each([408, 413, 422, 429, 503, 504])('handles Gateway rejection %s without payload disclosure or retry', async status => {
  const client = { post: jest.fn().mockRejectedValue({ isAxiosError: true, response: { status, data: 'PRIVATE' } }) };
  await expect(gateway(config({}), client)({ kind: 'audio' }, Buffer.alloc(12), false)).rejects.toMatchObject({ status: status < 500 ? status : 502 });
  expect(client.post).toHaveBeenCalledTimes(1);
});
