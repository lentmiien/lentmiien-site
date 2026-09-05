jest.mock('../../utils/logger', () => ({ error: jest.fn() }));
const { setupConnectivityIndexes } = require('../../scripts/setup-connectivity-indexes');
function harness(initial = [{ key: { _id: 1 }, name: '_id_' }]) {
  const indexes = [...initial];
  const collection = { listIndexes: jest.fn(() => ({ toArray: async () => indexes })),
    createIndex: jest.fn(async (key, options) => { indexes.push({ key, ...options }); }) };
  const db = { collection: jest.fn(() => collection) };
  return { db, collection, indexes };
}

test('default verification is read-only; execution creates only missing monitor indexes and is idempotent', async () => {
  const h = harness();
  expect(await setupConnectivityIndexes(h.db)).toMatchObject({ ready: false, mode: 'verify' });
  expect(h.collection.createIndex).not.toHaveBeenCalled();
  expect(await setupConnectivityIndexes(h.db, { execute: true })).toMatchObject({ ready: true });
  expect(h.collection.createIndex).toHaveBeenCalledTimes(2);
  expect(h.collection.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: 0, maxTimeMS: 60000 });
  await setupConnectivityIndexes(h.db, { execute: true });
  expect(h.collection.createIndex).toHaveBeenCalledTimes(2);
  expect(h.db.collection.mock.calls.every(([name]) => name === 'connectivity_samples')).toBe(true);
});

test.each([
  { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 60 },
  { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0, partialFilterExpression: { monitorVersion: '2' } },
  { key: { other: 1 }, name: 'sampledAt_1' },
])('conflicting indexes require review without mutation: %j', async (index) => {
  const h = harness([index]);
  await expect(setupConnectivityIndexes(h.db, { execute: true })).rejects.toThrow('conflict');
  expect(h.collection.createIndex).not.toHaveBeenCalled();
});

test('absent collection and denied listing are handled without destructive fallbacks', async () => {
  const h = harness();
  h.collection.listIndexes.mockImplementation(() => ({ toArray: async () => { throw { code: 26 }; } }));
  expect(await setupConnectivityIndexes(h.db)).toMatchObject({ ready: false });
  h.collection.listIndexes.mockImplementation(() => ({ toArray: async () => { throw { code: 13 }; } }));
  await expect(setupConnectivityIndexes(h.db, { execute: true })).rejects.toEqual({ code: 13 });
  expect(h.collection.createIndex).not.toHaveBeenCalled();
});
