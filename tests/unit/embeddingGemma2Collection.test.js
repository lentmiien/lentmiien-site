jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const mongoose = require('mongoose');
const { models, COLLECTION } = require('../../models/embeddinggemma2_pilot');
const { PilotService } = require('../../services/embeddingGemma2/service');
const { config } = require('../../services/embeddingGemma2/config');

// Real Mongoose casting/validation and service lease operations, with only the
// native collection transport replaced. No Mongo server or network is involved.
function setup() {
  const rows = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value?.$lt) return row[key] < value.$lt;
    if (value?.$gt) return row[key] > value.$gt;
    return String(row[key]) === String(value);
  });
  const native = {
    createIndex: jest.fn(async () => 'eg2_owner_space'),
    updateOne: jest.fn(async (filter, update, options) => {
      let row = rows.find(item => matches(item, filter));
      if (!row && options.upsert) {
        if (rows.some(item => String(item._id) === String(filter._id))) throw Object.assign(new Error('duplicate'), { code: 11000 });
        row = { ...filter, ...update.$setOnInsert }; rows.push(row);
      }
      if (row) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0 };
    }),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const row = rows.find(item => matches(item, filter));
      if (!row) return null;
      Object.assign(row, update.$set); return { ...row };
    }),
    findOne: jest.fn(async filter => rows.find(item => matches(item, filter)) || null),
  };
  const connection = mongoose.createConnection();
  connection.db = { collection: jest.fn(() => native) };
  connection.readyState = 1;
  const useDb = jest.spyOn(connection, 'useDb');
  const files = { clearStaging: jest.fn() }; const embed = jest.fn();
  const service = new PilotService(config({}), { connection, files, embed });
  return { service, connection, native, rows, useDb, files, embed };
}

test('default startup is lazy; both models and all lease writes use only the primary test collection', async () => {
  const { service, connection, native, rows, useDb, files, embed } = setup();
  expect(connection.db.collection).not.toHaveBeenCalled();
  expect(files.clearStaging).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
  const lease = await service.acquire(); await lease.assert();
  expect(rows).toEqual([expect.objectContaining({ _id: 'operation', recordType: 'control', token: expect.any(String), until: expect.any(Date) })]);
  const { Record, Lease } = models(connection);
  expect(Record.collection.name).toBe(COLLECTION); expect(Lease.collection.name).toBe(COLLECTION);
  expect(Record.db).toBe(connection); expect(Lease.db).toBe(connection);
  expect(useDb).not.toHaveBeenCalled();
  expect(connection.db.collection.mock.calls.every(([name]) => name === 'embeddinggemma2_test')).toBe(true);
  expect(native.createIndex).toHaveBeenCalledTimes(1);
  expect(native.createIndex).toHaveBeenCalledWith(expect.objectContaining({ owner: 1, space_id: 1 }), expect.objectContaining({ partialFilterExpression: { recordType: 'entry' } }));
  await service.ready(); expect(native.createIndex).toHaveBeenCalledTimes(1);
  await lease.release(); expect(rows[0].until).toEqual(new Date(0));
  for (const method of ['updateOne', 'findOneAndUpdate', 'findOne']) {
    for (const [filter] of native[method].mock.calls) expect(filter).toMatchObject({ _id: 'operation', recordType: 'control' });
  }
});

test('durable uncertainty survives a new service instance and expired tokens cannot release a successor lease', async () => {
  const { service, connection, rows } = setup();
  const first = await service.acquire(); const token = rows[0].token;
  await first.release(true);
  const successor = new PilotService(config({}), { connection });
  await expect(successor.acquire()).rejects.toMatchObject({ status: 429 });
  expect(rows[0].token).toBe(token);
  rows[0].until = new Date(0);
  const second = await successor.acquire();
  expect(rows[0].token).not.toBe(token);
  await expect(first.assert()).rejects.toMatchObject({ status: 503 });
  await first.release(); expect(rows[0].until.getTime()).toBeGreaterThan(Date.now());
  await second.assert(); await second.release(); expect(rows[0].until).toEqual(new Date(0));
});

test('disabled or disconnected startup performs no collection or filesystem work', async () => {
  const { service, connection, files } = setup();
  service.config.enabled = false;
  await expect(service.acquire()).rejects.toMatchObject({ status: 503 });
  service.config.enabled = true; connection.readyState = 0;
  await expect(service.acquire()).rejects.toThrow('Primary database unavailable');
  expect(connection.db.collection).not.toHaveBeenCalled(); expect(files.clearStaging).not.toHaveBeenCalled();
  expect(service.busy).toBe(false);
});
