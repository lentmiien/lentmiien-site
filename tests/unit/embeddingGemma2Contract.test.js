const { config } = require('../../services/embeddingGemma2/config');
const { input, response, vector, MODEL, REVISION, SPACE } = require('../../services/embeddingGemma2/contract');
const { gateway } = require('../../services/embeddingGemma2/gateway');
const { models, schema } = require('../../models/embeddinggemma2_pilot');
const mongoose = require('mongoose');
const v = () => [1, ...Array(767).fill(0)];
const payload = (kind = 'text', role = 'document', title = false) => ({ model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, precision: 'bfloat16', vectors: [v()], chunks: [{ index: 0, input_index: 0, kind, role, title_supplied: title }], preprocessing: { version: 'pilot-v1', batch_size: 1, truncation: false } });
test('isolated configuration validates explicit bounds, origin and private root', () => {
  expect(config({}).enabled).toBe(false);
  expect(config({}).dbName).toBe('embeddinggemma2_pilot');
  for (const env of [{ EMBEDDINGGEMMA2_DB_NAME: 'production' }, { EMBEDDINGGEMMA2_TIMEOUT_MS: '15000' }, { EMBEDDINGGEMMA2_USER_ITEMS: 'Infinity' }, { AI_GATEWAY_BASE_URL: 'http://user:pass@host' }, { AI_GATEWAY_BASE_URL: 'file:///tmp' }, { AI_GATEWAY_BASE_URL: 'http://host/embed' }, { EMBEDDINGGEMMA2_STORAGE_DIR: `${process.cwd()}/public/media` }]) expect(() => config(env)).toThrow();
});
test('useDb preserves the existing Mongo client and never accepts the primary database', () => {
  const db = { models: {}, model: jest.fn(name => name) };
  const connection = { readyState: 1, name: 'site', useDb: jest.fn(() => db) };
  models(connection, 'embeddinggemma2_pilot');
  expect(connection.useDb).toHaveBeenCalledWith('embeddinggemma2_pilot', { useCache: true });
  expect(() => models({ ...connection, name: 'embeddinggemma2_pilot' }, 'embeddinggemma2_pilot')).toThrow();
  expect(() => models({ ...connection, readyState: 0 }, 'embeddinggemma2_pilot')).toThrow();
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
  expect(schema.options.collection).toBe('eg2_records');
});
