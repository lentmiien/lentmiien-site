jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const mongoose = require('mongoose');
// Match app.js: compile the application models with global buffering off BEFORE
// opening the database. The old tests connected without this bootstrap setting.
require('../../database');
const { service, worker } = require('../../services/localAi');
const logger = require('../../utils/logger');
const { Job, Run, Control, Token, Input, InputQuota } = service.db;
const suite = process.env.LOCAL_AI_TEST_MONGO_URI ? describe : describe.skip;
const settle = async () => {
  const deadline = Date.now() + 5000;
  while (worker.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(worker.busy).toBe(false);
};
suite('actual Local AI bootstrap with preconnection model compilation and standalone Mongo', () => {
  const env = { ...process.env };
  let commands;
  beforeAll(async () => {
    const uri = process.env.LOCAL_AI_TEST_MONGO_URI;
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/local_ai_test(?:\?|$)/.test(uri)) throw new Error('Disposable loopback local_ai_test database required');
    // Allow automatic model initialization to finish/fail before connect, as in
    // the web process while the database lifecycle waits for readiness.
    await new Promise(resolve => setImmediate(resolve));
    await mongoose.connect(uri, { bufferCommands: false, monitorCommands: true });
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toBeUndefined();
    process.env.LOCAL_AI_BATCH_ENABLED = 'false';
    process.env.LOCAL_AI_BATCH_AUTO_DISPATCH = 'false';
    worker.ready = () => mongoose.connection.readyState === 1;
    jest.spyOn(worker.gateway, 'configured').mockReturnValue(true);
    jest.spyOn(worker.gateway, 'request').mockImplementation(() => { throw new Error('No Gateway requests allowed'); });
    commands = [];
    mongoose.connection.getClient().on('commandStarted', event => commands.push(event.command));
  });
  beforeEach(async () => {
    worker.stop(); service.initializing = null;
    await Promise.all([Job, Run, Control, Token, Input, InputQuota].map(model => model.deleteMany({})));
    commands.length = 0;
  });
  afterAll(async () => {
    worker.stop(); jest.restoreAllMocks();
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    process.env = env;
  });
  test('start persists scheduler, repeats safely, retains history and uses durable writes with flags OFF', async () => {
    await Job.create({ _id: 'accepted-history', ownerId: 'synthetic-owner', key: 'same-key', digest: 'same-digest',
      state: 'needs_review', request: { frozen: 'synthetic' }, result: { text: 'synthetic retained result' } });
    worker.start(); await settle();
    const control = await Control.findById('scheduler').lean();
    expect(control).toMatchObject({ _id: 'scheduler', holder: worker.id, fence: 1, activeRun: null, cohortLimit: 8 });
    expect(control.leaseUntil.getTime()).toBeGreaterThan(Date.now());
    await worker.tick();
    expect(await Control.countDocuments()).toBe(1);
    expect((await Control.findById('scheduler')).fence).toBe(2);
    expect(await Job.findById('accepted-history').lean()).toMatchObject({ key: 'same-key', digest: 'same-digest', request: { frozen: 'synthetic' }, result: { text: 'synthetic retained result' } });
    for (const model of [Input, InputQuota]) {
      expect(model.schema.options.autoCreate).toBe(false); expect(model.schema.options.autoIndex).toBe(false);
      expect(model.schema.options.bufferCommands).toBe(false);
    }
    expect((await Input.collection.indexes()).find(index => index.key.ownerId && index.key.key)).toMatchObject({ unique: true });
    const indexes = await Job.collection.indexes();
    for (const [name, field] of [['admission_slot_unique', 'slot'], ['admission_owner_slot_unique', 'ownerSlot']]) {
      expect(indexes.find(index => index.name === name)).toMatchObject({ unique: true, partialFilterExpression: { [field]: { $type: 'number' } } });
    }
    expect((await Token.collection.indexes()).find(index => index.key.hash)).toMatchObject({ unique: true });
    const writes = commands.filter(command => command.update === Control.collection.name || command.findAndModify === Control.collection.name);
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const command of writes) expect(command.writeConcern).toMatchObject({ w: 'majority', j: true });
    expect(writes.find(command => command.update)?.updates[0]).toMatchObject({ q: { _id: 'scheduler' }, upsert: true });
    expect(logger.error).not.toHaveBeenCalled(); expect(logger.warning).not.toHaveBeenCalled();
    expect(worker.gateway.request).not.toHaveBeenCalled();
    worker.stop(); await mongoose.disconnect();
    await mongoose.connect(process.env.LOCAL_AI_TEST_MONGO_URI, { bufferCommands: false });
    expect(await Control.countDocuments({ _id: 'scheduler' })).toBe(1);
    expect(await Job.countDocuments({ _id: 'accepted-history' })).toBe(1);
  });
  test('scheduled retry recovers from a failed real index operation without restarting or resetting Model.init', async () => {
    const failure = Object.assign(new Error('mongodb://secret/private prompt contents'), { name: 'MongoServerError', code: 91 });
    const create = jest.spyOn(Job, 'createIndexes').mockRejectedValueOnce(failure);
    const interval = jest.spyOn(global, 'setInterval');
    try {
      worker.start(); await settle();
      expect(await Control.countDocuments()).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(expect.any(String), { category: 'local_ai', metadata: {
        code: 'initialization_failed', operation: 'Job.create_indexes', reasonClass: 'mongo_server_error', mongoCode: 91,
      } });
      const [retry, delay] = interval.mock.calls[0]; expect(delay).toBe(10000);
      await retry(); await settle();
      expect(create).toHaveBeenCalledTimes(2);
      expect(await Control.findById('scheduler').lean()).toMatchObject({ holder: worker.id, fence: 1 });
      expect(worker.gateway.request).not.toHaveBeenCalled();
      expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/secret|private|prompt contents/);
    } finally { create.mockRestore(); interval.mockRestore(); worker.stop(); }
  });
});
