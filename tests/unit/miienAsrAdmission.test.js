const mongoose = require('mongoose');
const { MiienTranscriptionJobs } = require('../../utils/miienTranscriptionJobs');
const { validAdmissionIndexes } = require('../../utils/miienAsrAdmission');

const principal = { _id: 'b'.repeat(24) };
const conversation = 'a'.repeat(24);
const safeIndexes = () => [
  { name: '_id_', key: { _id: 1 } },
  { name: 'principalId_1', key: { principalId: 1 }, unique: true },
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
let local, slots, jobs, driver, database, asr;
beforeEach(() => {
  // Real Mongoose, schema compilation, init, connection and model operations.
  // Only the MongoDB driver boundary is fake; never import database.js/.env.
  local = new mongoose.Mongoose();
  local.set('bufferCommands', false);
  jest.isolateModules(() => {
    jest.doMock('mongoose', () => local);
    slots = require('../../models/miien_asr_slot');
  });
  jest.dontMock('mongoose');
  driver = {
    listIndexes: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(safeIndexes()) })),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    createIndex: jest.fn(),
  };
  database = { collection: jest.fn(() => driver), createCollection: jest.fn() };
  asr = { transcribeBuffer: jest.fn().mockResolvedValue({ data: { text: 'Synthetic draft' } }) };
  jobs = new MiienTranscriptionJobs({ slots, asr, chat: { owned: async () => ({}) },
    authorize: async () => principal, logger: { warning: jest.fn(), error: jest.fn() } });
});
afterEach(() => {
  for (const job of jobs.jobs.values()) clearTimeout(job.timer);
  expect(database.createCollection).not.toHaveBeenCalled();
  expect(driver.createIndex).not.toHaveBeenCalled();
});
function connect() {
  local.connection.db = database;
  local.connection.onOpen();
}
function reserve() { return jobs.reserve(principal, conversation, {}); }
async function expectClosed(code) {
  await expect(reserve()).rejects.toMatchObject({ status: 503, code });
  expect(jobs.jobs.size).toBe(0);
  expect(driver.insertOne).not.toHaveBeenCalled();
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
}
function wav() {
  const buffer = Buffer.alloc(364);
  buffer.write('RIFF'); buffer.writeUInt32LE(356, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(320, 40);
  return buffer;
}

test('disconnected import with buffering off stays safe, then connection permits reservation and one dispatch', async () => {
  expect(local.connection.readyState).toBe(0);
  expect(local.get('bufferCommands')).toBe(false);
  await slots.init(); // Exercise actual implicit initialization; no early DDL.
  await expectClosed('asr_database_not_ready');
  local.connection.readyState = 2; // Existing app lifecycle owns delayed connection/retry.
  await expectClosed('asr_database_not_ready');
  expect(driver.listIndexes).not.toHaveBeenCalled();
  connect();
  const reserved = await reserve();
  expect(reserved.status).toBe('awaiting_upload');
  expect(driver.insertOne).toHaveBeenCalledTimes(1);
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
  const { job } = await jobs.beginUpload(principal, conversation, reserved.id);
  await jobs.upload(job, wav()); await job.task;
  expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
  expect(job.status).toBe('ready');
  expect(driver.deleteOne).toHaveBeenCalledTimes(1);
});

test('pending index inspection blocks writes/Gateway and concurrent same-principal reservation', async () => {
  connect();
  const metadata = deferred();
  driver.listIndexes.mockReturnValueOnce({ toArray: () => metadata.promise });
  const attempt = reserve();
  await new Promise(resolve => setImmediate(resolve));
  expect(driver.insertOne).not.toHaveBeenCalled();
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
  await expect(reserve()).rejects.toMatchObject({ status: 429 });
  metadata.resolve(safeIndexes());
  await expect(attempt).resolves.toMatchObject({ status: 'awaiting_upload' });
});

test('rejected metadata check fails closed and next explicit attempt recovers without restarting model', async () => {
  connect();
  driver.listIndexes.mockReturnValueOnce({ toArray: async () => { throw new Error('mongodb://secret/private'); } });
  await expectClosed('asr_index_check_failed');
  await expect(reserve()).resolves.toMatchObject({ status: 'awaiting_upload' });
  expect(driver.listIndexes).toHaveBeenCalledTimes(2);
});

test('reconnect rechecks metadata; a formerly valid index is not cached', async () => {
  connect();
  const first = await reserve();
  await jobs.discard(principal, conversation, first.id, { action: 'cancel' });
  clearTimeout(jobs.jobs.get(first.id).timer);
  driver.insertOne.mockClear(); jobs.jobs.clear();
  local.connection.readyState = 0;
  await expectClosed('asr_database_not_ready');
  connect();
  driver.listIndexes.mockReturnValueOnce({ toArray: async () => [] });
  await expectClosed('asr_indexes_unsafe');
  await expect(reserve()).resolves.toMatchObject({ status: 'awaiting_upload' });
});

test('connection lost during metadata inspection fails closed, then recovers', async () => {
  connect();
  driver.listIndexes.mockReturnValueOnce({ toArray: async () => {
    local.connection.readyState = 0;
    return safeIndexes();
  } });
  await expectClosed('asr_database_not_ready');
  connect();
  await expect(reserve()).resolves.toMatchObject({ status: 'awaiting_upload' });
});

test('write failure is sanitized and never dispatches or removes uncertain durable admission', async () => {
  connect();
  driver.insertOne.mockRejectedValueOnce(new Error('mongodb://secret/private'));
  await expect(reserve()).rejects.toMatchObject({ status: 503, stage: 'reservation', code: 'asr_reservation_failed' });
  expect(jobs.jobs.size).toBe(0);
  expect(driver.deleteOne).not.toHaveBeenCalled();
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});

const unsafe = [
  ['missing metadata', null], ['empty metadata', []],
  ['missing principal', safeIndexes().slice(0, 1)], ['missing _id', safeIndexes().slice(1)],
  ...[
    ['nonunique', { unique: false }], ['no unique option', { unique: undefined }],
    ['wrong name', { name: 'another' }], ['wrong key', { key: { principalId: -1 } }],
    ['compound key', { key: { principalId: 1, jobId: 1 } }],
    ['sparse', { sparse: true }], ['partial', { partialFilterExpression: { principalId: { $exists: true } } }],
    ['TTL', { expireAfterSeconds: 60 }],
  ].map(([label, options]) => [label, [safeIndexes()[0], { ...safeIndexes()[1], ...options }]]),
  ['extra TTL', [...safeIndexes(), { name: 'startedAt_1', key: { startedAt: 1 }, expireAfterSeconds: 60 }]],
  ['wrong _id key', [{ name: '_id_', key: { jobId: 1 } }, safeIndexes()[1]]],
];
test.each(unsafe)('%s metadata blocks real model writes and Gateway', async (_, indexes) => {
  connect();
  driver.listIndexes.mockReturnValue({ toArray: async () => indexes });
  await expectClosed('asr_indexes_unsafe');
});
test('built-in _id uniqueness need not be explicit; harmless additional full indexes are allowed', () => {
  expect(validAdmissionIndexes(safeIndexes())).toBe(true);
  expect(validAdmissionIndexes([{ ...safeIndexes()[0], unique: true }, safeIndexes()[1]])).toBe(true);
  expect(validAdmissionIndexes([...safeIndexes(), { name: 'jobId_1', key: { jobId: 1 } }])).toBe(true);
});
