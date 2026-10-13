jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { PilotService, identity } = require('../../services/embeddingGemma2/service');
const { config } = require('../../services/embeddingGemma2/config');
const { MODEL, REVISION, SPACE } = require('../../services/embeddingGemma2/contract');
const owner = '111111111111111111111111'; const foreign = '222222222222222222222222';
const v = (a = 1, b = 0) => [a, b, ...Array(766).fill(0)];
const embedding = { model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, precision: 'bfloat16', preprocessing: { version: 'pilot-v1' }, mapping: { input_index: 0 }, vector: v() };
const record = (i, extra = {}) => ({ _id: i.toString(16).padStart(24, '0'), owner, state: 'ready', kind: 'text', text: `synthetic ${i}`, bytes: 10, capturedAt: new Date(0), ...embedding, ...extra });
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    const actual = key.split('.').reduce((o, k) => o?.[k], row);
    if (value && typeof value === 'object') {
      if (value.$in) return value.$in.includes(actual);
      if (value.$lt) return actual < value.$lt;
    }
    return String(actual) === String(value);
  });
}
function query(value) {
  const q = { maxTimeMS: () => q, select: () => q, sort: () => q, limit: n => { value = value.slice(0, n); return q; }, lean: () => q,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject), cursor: jest.fn(() => ({ async *[Symbol.asyncIterator]() { yield* value; }, close: jest.fn() })) };
  return q;
}
function setup(rows = [], overrides = {}) {
  const Record = {
    createIndexes: jest.fn(),
    find: jest.fn(filter => query(rows.filter(r => matches(r, filter)))),
    countDocuments: jest.fn(filter => query(rows.filter(r => matches(r, filter)).length)),
    findOne: jest.fn(filter => query(rows.find(r => matches(r, filter)))),
    create: jest.fn(async data => { const r = { _id: 'a'.repeat(24), capturedAt: new Date(), ...data }; rows.push(r); return r; }),
    updateOne: jest.fn((filter, update) => { const r = rows.find(row => matches(row, filter)); if (r) Object.assign(r, update.$set); return query({ matchedCount: r ? 1 : 0, modifiedCount: r ? 1 : 0 }); }),
    findOneAndUpdate: jest.fn((filter, update) => { const r = rows.find(row => matches(row, filter)); if (r) Object.assign(r, update.$set); return query(r); }),
    deleteOne: jest.fn(filter => { const i = rows.findIndex(row => matches(row, filter)); if (i >= 0) rows.splice(i, 1); return query({ deletedCount: i >= 0 ? 1 : 0 }); }),
  };
  const files = { validate: jest.fn(async () => ({ filename: 'fixture.png', mime: 'image/png' })), name: () => 'a'.repeat(48), write: jest.fn(), remove: jest.fn(), clearStaging: jest.fn() };
  const embed = jest.fn(async () => embedding);
  const service = new PilotService({ ...config({ EMBEDDINGGEMMA2_ENABLED: 'true' }), ...overrides }, { getModels: () => ({ Record }), files, embed });
  service.models = { Record };
  service.stats = jest.fn(async () => ({ mine: { count: rows.filter(r => r.owner === owner).length, bytes: rows.filter(r => r.owner === owner).reduce((s, r) => s + r.bytes, 0) }, total: rows.length, bytes: rows.reduce((s, r) => s + r.bytes, 0), compatible: rows.filter(r => matches(r, { owner, ...identity })).length }));
  const lease = { assert: jest.fn() };
  return { service, Record, files, embed, lease, rows };
}
const source = { kind: 'text', text: 'query', filter: 'all', topK: 2 };
test('complete cosine scan ranks old records across modalities and excludes foreign/wrong spaces', async () => {
  const { service, Record, lease } = setup([record(1, { kind: 'image', asset: 'a'.repeat(48) }), record(2, { kind: 'audio', vector: v(0.8, 0.6) }), record(3, { kind: 'video', vector: v(0, 1) }), record(4, { owner: foreign }), record(5, { space_id: 'wrong' })]);
  const result = await service.search(owner, source, null, lease, () => true);
  expect(result.records.map(r => r.kind)).toEqual(['image', 'audio']);
  expect(result.records.map(r => r.similarity)).toEqual([1, 0.8]);
  expect(result.scanned).toBe(3); expect(result.excluded).toBe(1);
  expect(result.records[0].vector).toBeUndefined(); expect(result.records[0].asset).toBeUndefined();
  expect(Record.find).toHaveBeenCalledWith({ owner, state: 'ready', ...identity });
});
test('modality filter is explicit and empty search avoids inference', async () => {
  const { service, lease, embed } = setup([record(1)]);
  const result = await service.search(owner, { ...source, filter: 'video' }, null, lease, () => true);
  expect(result.scanned).toBe(0); expect(embed).not.toHaveBeenCalled();
});
test('query media is validated and forwarded but never persisted', async () => {
  const { service, lease, files, Record, embed } = setup([record(1)]); const file = { buffer: Buffer.from('fixture') };
  await service.search(owner, { ...source, kind: 'audio' }, file, lease, () => true);
  expect(files.validate).toHaveBeenCalledWith(file, 'audio'); expect(embed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio' }), file.buffer, true);
  expect(Record.create).not.toHaveBeenCalled(); expect(files.write).not.toHaveBeenCalled();
});
test.each([Array(768).fill(0), [1], v(NaN)])('corrupt stored vectors fail the scan explicitly', async value => {
  const { service, lease } = setup([record(1, { vector: value })]);
  await expect(service.search(owner, source, null, lease, () => true)).rejects.toThrow('vector');
});
test('capacity is enforced before inference and search never silently truncates', async () => {
  const { service, lease, embed } = setup([record(1), record(2)], { globalItems: 1 });
  await expect(service.add(owner, source, null, lease, () => true)).rejects.toThrow('capacity');
  await expect(service.search(owner, source, null, lease, () => true)).rejects.toThrow('scan capacity'); expect(embed).not.toHaveBeenCalled();
});
test('text add retains raw source, title, ownership and identity', async () => {
  const { service, lease, rows, files } = setup();
  const result = await service.add(owner, { kind: 'text', text: '<script>synthetic</script>', title: 'original' }, null, lease, () => true);
  expect(result.text).toBe('<script>synthetic</script>'); expect(rows[0]).toEqual(expect.objectContaining({ state: 'ready', owner, title: 'original', ...embedding })); expect(files.write).not.toHaveBeenCalled();
});
test('failed ingest rolls back the file and durable intent; provider failure creates neither', async () => {
  const { service, lease, files, rows, Record, embed } = setup(); const file = { buffer: Buffer.from('fixture') };
  files.write.mockRejectedValueOnce(new Error('disk failure'));
  await expect(service.add(owner, { kind: 'image' }, file, lease, () => true)).rejects.toThrow('disk failure');
  expect(files.remove).toHaveBeenCalledWith('a'.repeat(48)); expect(rows).toHaveLength(0);
  Record.create.mockClear(); embed.mockRejectedValueOnce(new Error('provider'));
  await expect(service.add(owner, { kind: 'image' }, file, lease, () => true)).rejects.toThrow('provider'); expect(Record.create).not.toHaveBeenCalled();
});
test('disconnect and revoked authorization do not persist after inference', async () => {
  const { service, lease, Record } = setup(); let calls = 0;
  await expect(service.add(owner, source, null, lease, () => ++calls < 2)).rejects.toThrow('disconnected'); expect(Record.create).not.toHaveBeenCalled();
  const authorize = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('revoked'));
  await expect(service.add(owner, source, null, lease, () => true, authorize)).rejects.toThrow('revoked'); expect(Record.create).not.toHaveBeenCalled();
});
test('owner deletion removes both, foreign IDs do not leak, failures retain recovery intent', async () => {
  const { service, lease, rows, files } = setup([record(1, { asset: 'a'.repeat(48) }), record(2, { owner: foreign })]);
  await expect(service.remove(owner, record(2)._id, lease)).rejects.toThrow('not found'); expect(files.remove).not.toHaveBeenCalled();
  files.remove.mockRejectedValueOnce(new Error('disk'));
  await expect(service.remove(owner, record(1)._id, lease)).rejects.toThrow('disk'); expect(rows[0].state).toBe('deleting');
  await service.reconcile(lease); expect(rows).toHaveLength(1); expect(rows[0].owner).toBe(foreign);
});
test('media ownership is checked before touching disk', async () => {
  const { service, files } = setup([record(1, { owner: foreign, kind: 'image', asset: 'a'.repeat(48) })]);
  files.open = jest.fn(); await expect(service.media(owner, record(1)._id)).rejects.toThrow('not found'); expect(files.open).not.toHaveBeenCalled();
});
test('distributed lease refuses contenders and uncertain failures retain cooldown', async () => {
  const service = new PilotService(config({ EMBEDDINGGEMMA2_ENABLED: 'true' }));
  const Lease = { updateOne: jest.fn(async () => ({})), findOneAndUpdate: jest.fn(() => query({ token: 'token' })), exists: jest.fn(() => query(true)) };
  service.ready = async () => ({ Lease });
  const lease = await service.acquire(); await expect(service.acquire()).rejects.toThrow('progress');
  await lease.release(true); expect(Lease.updateOne).toHaveBeenCalledTimes(1); expect(service.busy).toBe(false);
  Lease.findOneAndUpdate.mockImplementationOnce(() => query(null)); await expect(service.acquire()).rejects.toThrow('reclaiming'); expect(service.busy).toBe(false);
});
test('cursor search covers more than one batch and never drops the oldest best match', async () => {
  const rows = Array.from({ length: 65 }, (_, i) => record(i + 1, { vector: i === 0 ? v() : v(0, 1) }));
  const { service, lease } = setup(rows);
  const result = await service.search(owner, { ...source, topK: 1 }, null, lease, () => true);
  expect(result.scanned).toBe(65); expect(result.records[0].id).toBe(record(1)._id);
});
test('database commit failure rolls back the original media and pending record', async () => {
  const { service, lease, files, Record, rows } = setup();
  Record.updateOne.mockImplementationOnce(() => { throw new Error('database unavailable'); });
  await expect(service.add(owner, { kind: 'image' }, { buffer: Buffer.from('fixture') }, lease, () => true)).rejects.toThrow('database unavailable');
  expect(files.write).toHaveBeenCalled(); expect(files.remove).toHaveBeenCalledWith('a'.repeat(48)); expect(rows).toHaveLength(0);
});
