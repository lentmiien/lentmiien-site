// Set EMBEDDING_TEST_MONGO_URI to mongodb://127.0.0.1:PORT/embedding_test.
// Only the uniquely named scratch database is created and dropped.
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../utils/logger', () => ({ debug: jest.fn(), notice: jest.fn(), warning: jest.fn(), error: jest.fn() }));

const fixture = process.env.EMBEDDING_TEST_MONGO_URI;
(fixture ? describe : describe.skip)('durable knowledge indexing', () => {
  let db;
  const log = require('../../utils/logger');
  const KnowledgeService = require('../../services/knowledgeService');
  const { EmbeddingQueueService } = require('../../services/embeddingQueueService');

  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/embedding_test$/.test(fixture)) throw new Error('Use a loopback embedding_test fixture.');
    await mongoose.connect(fixture, { dbName: 'embedding_test_' + randomUUID().replaceAll('-', '') });
    db = require('../../database');
  });
  afterAll(async () => {
    if (db) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('a lost enqueue and a default timeout recover independently across restarts without duplicate vectors', async () => {
    let now = Date.now();
    const EmbeddingApi = require('../../services/embeddingApiService');
    const embedding = new EmbeddingApi();
    const vector = () => ({ vectors: [[0.25, 0.75]], chunks: [], dim: 2, model: 'fixture' });
    const standard = jest.spyOn(embedding, 'embed').mockRejectedValueOnce(Object.assign(new Error('PRIVATE timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValue(vector());
    const hq = jest.spyOn(embedding, 'embedHighQuality').mockResolvedValue(vector());
    const workerOptions = {
      embeddingService: embedding, now: () => new Date(now), retryBaseMs: 1000, sourceReconcileIntervalMs: 1,
      getReservation: async () => ({ active: false }),
      getContainers: async () => ({ containers: [{ id: 'comfyui', state: 'exited' }] }),
    };
    const lost = { enqueueKnowledge: async () => { throw new Error('PRIVATE lost acknowledgment'); } };
    const id = await new KnowledgeService(db.Chat4KnowledgeModel, lost)
      .createKnowledge('PRIVATE title', '', 'PRIVATE text', 'manual', [], [], 'PRIVATE user');
    expect((await db.Chat4KnowledgeModel.findById(id)).pendingEmbeddingModes).toEqual(['default', 'high_quality']);

    const first = new EmbeddingQueueService(workerOptions);
    await first.reconcilePendingSources();
    expect(await db.EmbeddingQueueJob.countDocuments()).toBe(2);
    expect((await db.Chat4KnowledgeModel.findById(id)).pendingEmbeddingModes).toEqual([]);
    now += 60000;
    first.getContainers = async () => ({ containers: [] });
    await expect(first.drainQueue()).resolves.toMatchObject({ skipped: 'gpu_busy' });
    expect(standard).not.toHaveBeenCalled();
    const ages = () => log.debug.mock.calls.filter(([msg]) => msg === 'Reconciled embedding source intents')
      .map(([, opts]) => opts.metadata.oldestPendingUpsertAgeMs);
    expect(ages().at(-1)).toBe(60000);

    first.getContainers = workerOptions.getContainers;
    await first.drainQueue();
    expect(await db.VectorEmbedding.countDocuments()).toBe(0);
    expect(await db.VectorEmbeddingHighQuality.countDocuments()).toBe(1);
    expect(await db.EmbeddingQueueJob.findOne({ mode: 'default' }).lean()).toMatchObject({ status: 'pending', attempts: 1 });
    now += 2000;
    const restarted = new EmbeddingQueueService({ ...workerOptions, batchSize: 1 });
    // A later source makes the change in oldest pending age observable while
    // the queue still contains work.
    const later = await db.Chat4KnowledgeModel.create({
      title: 'Second', contentMarkdown: 'Another entry', category: 'manual', user_id: 'fixture',
      createdDate: new Date(now), updatedDate: new Date(now), pendingEmbeddingModes: ['default'],
    });
    await restarted.drainQueue();
    now++;
    await restarted.drainQueue();
    expect(ages().at(-1)).toBe(1);
    now++;
    await restarted.drainQueue();
    expect(ages().at(-1)).toBeNull();
    for (const model of [db.VectorEmbedding, db.VectorEmbeddingHighQuality]) {
      expect(await model.countDocuments({ 'source.documentId': id })).toBe(1);
    }
    expect(await db.EmbeddingQueueJob.countDocuments({ 'source.documentId': id, status: 'completed' })).toBe(2);
    expect(standard).toHaveBeenCalledTimes(3);
    expect(hq).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([log.warning.mock.calls, log.error.mock.calls])).not.toContain('PRIVATE');

    const service = new KnowledgeService(db.Chat4KnowledgeModel, restarted);
    await service.deleteKnovledgeById(later._id);
    restarted.batchSize = 25;
    await service.updateKnowledge(id, 'changed title', 'new contents', 'manual', [], []);
    await restarted.drainQueue();
    for (const model of [db.VectorEmbedding, db.VectorEmbeddingHighQuality]) {
      expect(await model.countDocuments()).toBe(1);
      expect((await model.findOne()).textLength).toBe('changed title\n\nnew contents\n\nmanual'.length);
    }
    await service.deleteKnovledgeById(id);
    await restarted.drainQueue();
    expect(await db.VectorEmbedding.countDocuments()).toBe(0);
    expect(await db.VectorEmbeddingHighQuality.countDocuments()).toBe(0);
  });
});
