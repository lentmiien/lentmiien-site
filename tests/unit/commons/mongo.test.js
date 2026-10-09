/* Explicit disposable localhost database only. No dotenv, providers or production URI. */
jest.mock('../../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const mongoose = require('mongoose');
const Diary = require('../../../models/commons_diary');
const Task = require('../../../models/scheduleTask/Task');
const { createDiary } = require('../../../services/commons/diary');
const { createTaskCompletion } = require('../../../services/scheduleTaskCompletion');
const W = require('../../../public/commons/world');
const uri = process.env.COMMONS_TEST_MONGO_URL;
const run = /^mongodb:\/\/127\.0\.0\.1:\d+\/commons_test_[a-z0-9_]+$/.test(uri || '') ? describe : describe.skip;
run('Commons real isolated Mongo persistence', () => {
  const owner = '111111111111111111111111', other = '222222222222222222222222';
  let diary, day;
  beforeAll(async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    await Promise.all([Diary.init(), Task.init()]);
  });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => { await Promise.all([Diary.deleteMany({}), Task.deleteMany({})]); diary = createDiary(); day = W.clock(Date.now()).day; });
  test('atomic creation unique owner/date and revision CAS reject concurrent writers without losing text', async () => {
    const input = { date: day, text: 'Synthetic first entry', revision: 0 };
    const results = await Promise.allSettled([diary.save(owner, input), diary.save(owner, { ...input, text: 'Synthetic other entry' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('REVISION_CONFLICT');
    expect(await Diary.countDocuments({ ownerId: owner, date: day })).toBe(1);
    const entries = await Promise.allSettled([diary.save(owner, { ...input, revision: 1, text: 'Edit A' }), diary.save(owner, { ...input, revision: 1, text: 'Edit B' })]);
    expect(entries.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await diary.read(owner)).entry.revision).toBe(2);
    expect((await diary.read(other)).entry.text).toBe('');
    await diary.save(other, input); expect(await Diary.countDocuments({ date: day })).toBe(2);
    const indexes = await Diary.collection.indexes(); expect(indexes.some(i => i.unique && i.key.ownerId === 1 && i.key.date === -1)).toBe(true);
  });
  test('server-clock guard aborts stale application-day INSERT and UPDATE atomically', async () => {
    const yesterdayInstant = Date.now() - 86400000;
    const date = W.clock(yesterdayInstant).day;
    const staleApp = createDiary({ now: () => yesterdayInstant });
    await expect(staleApp.save(owner, { date, text: 'Must not insert', revision: 0 })).rejects.toHaveProperty('code', 'DAY_CHANGED');
    expect(await Diary.countDocuments({})).toBe(0);
    await Diary.create({ ownerId: owner, date, text: 'Historical synthetic fixture', revision: 1, updatedAt: new Date(yesterdayInstant) });
    await expect(staleApp.save(owner, { date, text: 'Must not replace', revision: 1 })).rejects.toHaveProperty('code', 'DAY_CHANGED');
    expect((await Diary.findOne({ ownerId: owner, date })).text).toBe('Historical synthetic fixture');
  });
  test('autoIndex false refuses unprotected writes, recovers after explicit provisioning and detects index removal', async () => {
    const connection = await mongoose.createConnection(uri, { autoIndex: false, serverSelectionTimeoutMS: 3000 }).asPromise();
    try {
      const NoAutoDiary = connection.model('NoAutoDiary', Diary.schema.clone(), 'commonsdiaries_noautoindex');
      await NoAutoDiary.init(); await NoAutoDiary.createCollection();
      const service = createDiary({ model: NoAutoDiary });
      const input = { date: day, text: 'Synthetic guarded draft', revision: 0 };
      await expect(service.save(owner, input)).rejects.toHaveProperty('code', 'DIARY_INDEX_UNAVAILABLE');
      expect(await NoAutoDiary.countDocuments({})).toBe(0);
      await NoAutoDiary.collection.createIndex({ ownerId: 1, date: -1 }, { unique: true, name: 'ownerId_1_date_-1' });
      const results = await Promise.allSettled([service.save(owner, input), service.save(owner, input)]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(r => r.status === 'rejected').reason.code).toBe('REVISION_CONFLICT');
      expect(await NoAutoDiary.countDocuments({})).toBe(1);
      await NoAutoDiary.collection.dropIndex('ownerId_1_date_-1');
      await expect(service.save(owner, { ...input, revision: 1 })).rejects.toHaveProperty('code', 'DIARY_INDEX_UNAVAILABLE');
    } finally { await connection.close(); }
  });
  test('plain text stays literal through pipeline, BSON owner casting works and history is bounded', async () => {
    const text = '$$NOW <img src=x onerror=alert(1)> $revision';
    await diary.save(new mongoose.Types.ObjectId(owner), { date: day, text, revision: 0 });
    expect((await diary.read(owner)).entry.text).toBe(text);
    await Diary.insertMany(Array.from({ length: 25 }, (_, i) => ({ ownerId: owner, date: `2025-01-${String(i + 1).padStart(2, '0')}`, text: 'Synthetic old', revision: 1, updatedAt: new Date() })));
    const first = await diary.read(owner, { before: '9999-12-31' }); expect(first.dates).toHaveLength(20);
    const second = await diary.read(owner, { before: first.next }); expect(second.dates).toHaveLength(6);
  });
  test('canonical completion handles concurrent retries, both task types, foreign/name-owned/ownerless tasks and deletion', async () => {
    const cleanup = jest.fn(async () => 1), complete = createTaskCompletion({ Task, deleteReminders: cleanup });
    for (const type of ['todo', 'tobuy']) {
      const task = await Task.create({ userId: 'synthetic', title: 'Synthetic only', type });
      const results = await Promise.all([complete({ name: 'synthetic' }, task._id), complete({ name: 'synthetic' }, task._id)]);
      expect(results.every(r => r.done)).toBe(true);
      const first = await Task.findById(task._id); await complete({ name: 'synthetic' }, task._id);
      expect((await Task.findById(task._id)).updatedAt).toEqual(first.updatedAt);
      expect(await complete({ name: 'foreign', type_user: 'admin' }, task._id)).toBeNull();
      await Task.deleteOne({ _id: task._id }); expect(await complete({ name: 'synthetic' }, task._id)).toBeNull();
    }
    const legacy = await Task.collection.insertOne({ title: 'Ownerless synthetic', type: 'todo', done: false });
    expect(await complete({ name: 'synthetic', type_user: 'admin' }, legacy.insertedId)).toBeNull();
  });
  test('real admin collection statistics return only selected aggregate counts', async () => {
    const { createPanels, metricSources } = require('../../../services/commons/panels');
    for (const [name] of metricSources) {
      const model = require(`../../../models/${name}`);
      await model.createCollection();
      await model.collection.insertMany([{ synthetic: true, createdAt: new Date('2020-01-01') }, { synthetic: true, createdAt: new Date() }]);
    }
    const result = await createPanels().statistics();
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every(row => row.value === 2 && row.state === 'ready')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic');
  });
  test('real world lease preserves v1 identity and restricted-scene reload repairs safely', async () => {
    const { CommonsRepository, WORLD_ID } = require('../../../services/commons/repository');
    const { CommonsRoom } = require('../../../services/commons/room');
    const model = require('../../../models/commons_world');
    await model.init();
    const repository = new CommonsRepository();
    const room = new CommonsRoom({ repository });
    const connection = { token: 'one', validUntil: Date.now() + 60000, close() {} };
    await room.join(owner, connection);
    Object.assign(room.state.players[0], { x: 32, y: 17.6 });
    await room.action(owner, 'one', { id: crypto.randomUUID(), target: 'hall' }, { hall: true });
    await room.leave(owner, 'one');
    const saved = await model.findById(WORLD_ID).lean(); expect(saved.version).toBe(1); expect(saved.players[0].scene).toBe('hall');
    const restored = new CommonsRoom({ repository: new CommonsRepository() });
    const snapshot = await restored.join(owner, { ...connection, token: 'two' });
    expect(snapshot.self).toMatchObject({ scene: 'village', x: 32, y: 17.6 });
    expect(snapshot.self).not.toHaveProperty('sceneDefinition');
    await restored.leave(owner, 'two');
  });

});
