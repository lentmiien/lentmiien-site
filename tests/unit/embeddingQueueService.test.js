const mockDatabase = {
  Chat5Model: {},
  Conversation5Model: {},
  EmbeddingQueueJob: {},
  MessageInboxEntry: {},
  VectorEmbedding: {},
  VectorEmbeddingHighQuality: {},
};

jest.mock('../../database', () => mockDatabase);
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const {
  EmbeddingQueueService,
  buildDesiredHash,
  buildEmbeddingQueueJobId,
  isRetryableEmbeddingError,
} = require('../../services/embeddingQueueService');

const source = {
  collectionName: 'chat_message',
  documentId: 'message-1',
  contentType: 'chat_message_text',
  parentCollection: 'conversation',
  parentId: 'conversation-1',
};

function createEmbeddingService() {
  return {
    timeoutMs: 17 * 60 * 1000,
    normalizeTexts: jest.fn((input) => (Array.isArray(input) ? input : [input])
      .map((value) => String(value).replace(/\r\n/g, '\n').trim())
      .filter(Boolean)),
    normalizeMetadataList: jest.fn((input) => input),
    normalizeOptions: jest.fn((options = {}) => ({
      autoChunk: options.autoChunk !== undefined ? Boolean(options.autoChunk) : true,
    })),
    embed: jest.fn().mockResolvedValue({ vectors: [[0.1, 0.2]], chunks: [] }),
    embedHighQuality: jest.fn().mockResolvedValue({ vectors: [[0.3, 0.4]], chunks: [] }),
    deleteEmbeddings: jest.fn().mockResolvedValue(1),
    getModelForMode: jest.fn(() => ({ modelName: 'default' })),
    persistEmbeddings: jest.fn().mockResolvedValue([]),
  };
}

function createLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    notice: jest.fn(),
    warning: jest.fn(),
  };
}

function createJob(overrides = {}) {
  return {
    _id: buildEmbeddingQueueJobId(source, 'default'),
    source,
    mode: 'default',
    operation: 'upsert',
    options: { autoChunk: true },
    desiredHash: 'desired-hash',
    revision: 1,
    status: 'processing',
    attempts: 0,
    claimToken: 'claim-1',
    ...overrides,
  };
}

describe('EmbeddingQueueService', () => {
  test('silently skips a drain while the queue database connection is unavailable', async () => {
    const logger = createLogger();
    const service = new EmbeddingQueueService({
      jobModel: { db: { readyState: 0 } },
      embeddingService: createEmbeddingService(),
      loggerImpl: logger,
    });
    service.reconcilePendingSourcesIfDue = jest.fn();
    service.claimNext = jest.fn();

    await expect(service.drainQueue()).resolves.toEqual({
      processed: 0,
      skipped: 'database_unavailable',
    });

    expect(service.reconcilePendingSourcesIfDue).not.toHaveBeenCalled();
    expect(service.claimNext).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.notice).not.toHaveBeenCalled();
    expect(logger.warning).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('reconciliation converts an excluded pending placeholder into a delete intent', async () => {
    const queryFor = (value) => ({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(value),
    });
    const placeholder = {
      _id: 'placeholder-1',
      contentType: 'text',
      content: { text: 'Pending response' },
      embeddingRequested: false,
      embeddingStatus: 'pending',
      timestamp: new Date(),
    };
    const chatModel = {
      find: jest.fn((filter) => {
        if (filter.embeddingStatus === 'pending') return queryFor([placeholder]);
        if (filter.embeddingStatus === 'delete_pending') return queryFor([placeholder]);
        return queryFor([]);
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const conversationModel = {
      findOne: jest.fn().mockReturnValue(queryFor({ _id: 'conversation-1' })),
    };
    const service = new EmbeddingQueueService({
      jobModel: {},
      chatModel,
      conversationModel,
      messageInboxModel: { find: jest.fn().mockReturnValue(queryFor([])) },
      vectorModel: {},
      highQualityVectorModel: {},
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
    });
    service.enqueue = jest.fn();
    service.enqueueDelete = jest.fn().mockResolvedValue({ status: 'pending' });

    await expect(service.reconcilePendingSources(new Date())).resolves.toEqual({
      queued: 2,
      markedCompleted: 0,
      markedDisabled: 0,
      markedFailed: 0,
    });

    expect(chatModel.updateOne).toHaveBeenCalledWith(
      { _id: 'placeholder-1', embeddingStatus: 'pending' },
      { $set: { embeddingStatus: 'delete_pending', embeddingContentHash: null } },
    );
    expect(service.enqueue).not.toHaveBeenCalled();
    const expectedSource = expect.objectContaining({
      documentId: 'placeholder-1',
      parentId: 'conversation-1',
    });
    expect(service.enqueueDelete).toHaveBeenNthCalledWith(
      1,
      expectedSource,
      { mode: 'default' },
    );
    expect(service.enqueueDelete).toHaveBeenNthCalledWith(
      2,
      expectedSource,
      { mode: 'high_quality' },
    );
  });

  test('finds an active embedding job by source identity when its stored parent is unknown', async () => {
    const activeSource = {
      ...source,
      parentId: 'conversation-from-active-job',
    };
    const jobModel = {
      findById: jest.fn().mockResolvedValue(null),
      findOne: jest.fn().mockResolvedValue({ source: activeSource }),
    };
    const vectorModel = { findOne: jest.fn() };
    const highQualityVectorModel = { findOne: jest.fn() };
    const service = new EmbeddingQueueService({
      jobModel,
      vectorModel,
      highQualityVectorModel,
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
    });

    await expect(service.findStoredChatSource('message-1')).resolves.toEqual(activeSource);

    expect(jobModel.findById).toHaveBeenCalledTimes(2);
    expect(jobModel.findOne).toHaveBeenCalledWith({
      'source.collectionName': 'chat_message',
      'source.documentId': 'message-1',
      'source.contentType': 'chat_message_text',
      mode: { $in: ['default', 'high_quality'] },
      status: { $in: ['pending', 'processing'] },
    }, { source: 1 });
    expect(vectorModel.findOne).not.toHaveBeenCalled();
    expect(highQualityVectorModel.findOne).not.toHaveBeenCalled();
  });

  test('durably queues source metadata without calling the embedding API or storing raw text', async () => {
    const embeddingService = createEmbeddingService();
    const jobModel = {
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (payload) => ({ ...payload })),
    };
    const service = new EmbeddingQueueService({
      jobModel,
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn().mockResolvedValue({
        exists: true,
        enabled: true,
        text: 'Same text',
        rawText: 'Same text',
      }),
      sourceStateUpdater: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    });

    const job = await service.enqueue('Private message text', {}, [source]);

    expect(job.status).toBe('pending');
    expect(jobModel.create).toHaveBeenCalledWith(expect.objectContaining({
      _id: buildEmbeddingQueueJobId(source, 'default'),
      source,
      operation: 'upsert',
    }));
    expect(jobModel.create.mock.calls[0][0]).not.toHaveProperty('text');
    expect(JSON.stringify(jobModel.create.mock.calls[0][0])).not.toContain('Private message text');
    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(embeddingService.persistEmbeddings).not.toHaveBeenCalled();
  });

  test('coalesces an identical completed source intent', async () => {
    const embeddingService = createEmbeddingService();
    const existing = {
      _id: buildEmbeddingQueueJobId(source, 'default'),
      source,
      mode: 'default',
      operation: 'upsert',
      options: { autoChunk: true },
      desiredHash: null,
      revision: 3,
      status: 'completed',
    };
    const jobModel = {
      findById: jest.fn(),
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const service = new EmbeddingQueueService({
      jobModel,
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn().mockResolvedValue({
        exists: true,
        enabled: true,
        text: 'Same text',
        rawText: 'Same text',
      }),
      sourceStateUpdater: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    const firstJobModel = {
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (payload) => payload),
    };
    const firstService = new EmbeddingQueueService({
      jobModel: firstJobModel,
      embeddingService,
      loggerImpl: createLogger(),
    });
    const first = await firstService.enqueue('Same text', {}, [source]);
    existing.desiredHash = first.desiredHash;
    jobModel.findById.mockResolvedValue(existing);

    await expect(service.enqueue('Same text', {}, [source])).resolves.toBe(existing);
    expect(jobModel.create).not.toHaveBeenCalled();
    expect(jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('revises a hard-delete tombstone when a later edit needs source verification', async () => {
    const embeddingService = createEmbeddingService();
    const hardDeleteOptions = { verifySourceState: false };
    const existing = {
      _id: buildEmbeddingQueueJobId(source, 'default'),
      source,
      mode: 'default',
      operation: 'delete',
      options: hardDeleteOptions,
      desiredHash: buildDesiredHash({
        operation: 'delete',
        options: hardDeleteOptions,
        mode: 'default',
      }),
      revision: 2,
      status: 'completed',
    };
    const jobModel = {
      findById: jest.fn().mockResolvedValue(existing),
      findOneAndUpdate: jest.fn(async (filter, update) => ({
        ...existing,
        ...update.$set,
        revision: existing.revision + 1,
      })),
    };
    const service = new EmbeddingQueueService({
      jobModel,
      embeddingService,
      loggerImpl: createLogger(),
    });

    const updated = await service.enqueueDelete(source);

    expect(updated.revision).toBe(3);
    expect(updated.options).toEqual({ verifySourceState: true });
    expect(updated.desiredHash).not.toBe(existing.desiredHash);
    expect(jobModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('defers a claimed upsert while the GPU is reserved without starting an attempt', async () => {
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
    });
    const job = createJob({ status: 'processing', attempts: 4 });
    service.reconcilePendingSourcesIfDue = jest.fn().mockResolvedValue();
    service.claimNext = jest.fn(async (operation) => (operation === 'upsert' ? job : null));
    service.isGpuBusy = jest.fn().mockResolvedValue(true);
    service.releaseSupersededClaim = jest.fn().mockResolvedValue();
    service.processClaimedJob = jest.fn();
    service.markRemoteAttempt = jest.fn();

    await expect(service.drainQueue()).resolves.toEqual({ processed: 0, skipped: 'gpu_busy' });

    expect(service.releaseSupersededClaim).toHaveBeenCalledWith(job);
    expect(service.markRemoteAttempt).not.toHaveBeenCalled();
    expect(service.processClaimedJob).not.toHaveBeenCalled();
  });

  test('does not let deferred delete tombstones consume the upsert budget', async () => {
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
      batchSize: 2,
    });
    const deleteJobs = [
      createJob({ _id: 'delete-1', operation: 'delete' }),
      createJob({ _id: 'delete-2', operation: 'delete' }),
    ];
    const upsertJob = createJob({ _id: 'upsert-1' });
    service.reconcilePendingSourcesIfDue = jest.fn().mockResolvedValue();
    service.claimNext = jest.fn(async (operation) => {
      if (operation === 'delete') return deleteJobs.shift() || null;
      if (operation === 'upsert') {
        if (upsertJob.claimed) return null;
        upsertJob.claimed = true;
        return upsertJob;
      }
      return null;
    });
    service.isGpuBusy = jest.fn().mockResolvedValue(false);
    service.processClaimedJob = jest.fn(async (job) => (
      job.operation === 'delete' ? 'deferred' : 'completed'
    ));

    await expect(service.drainQueue()).resolves.toEqual({ processed: 3 });

    expect(service.processClaimedJob).toHaveBeenCalledWith(upsertJob);
  });

  test('embeds in the background, revalidates the source, and persists exactly once', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob();
    const jobModel = {
      findOne: jest.fn().mockResolvedValue(job),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const sourceResolver = jest.fn().mockResolvedValue({
      exists: true,
      enabled: true,
      text: 'Current text',
    });
    const sourceStateUpdater = jest.fn().mockResolvedValue();
    const service = new EmbeddingQueueService({
      jobModel,
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver,
      sourceStateUpdater,
    });
    job.desiredHash = buildDesiredHash({
      operation: 'upsert',
      text: 'Current text',
      options: { autoChunk: true },
      mode: 'default',
    });
    service.markRemoteAttempt = jest.fn().mockResolvedValue({ ...job, attempts: 1 });

    await expect(service.processClaimedJob(job)).resolves.toBe('completed');

    expect(embeddingService.embed).toHaveBeenCalledWith(
      ['Current text'],
      { autoChunk: true },
      null,
      { logFailure: false },
    );
    expect(sourceResolver).toHaveBeenCalledTimes(2);
    expect(embeddingService.persistEmbeddings).toHaveBeenCalledTimes(1);
    expect(sourceStateUpdater).toHaveBeenCalledWith(
      expect.objectContaining({ desiredHash: job.desiredHash }),
      expect.objectContaining({ status: 'completed', text: 'Current text' }),
    );
  });

  test('normalizes CRLF consistently while guarding completion with the raw stored text', async () => {
    const embeddingService = createEmbeddingService();
    const rawText = 'First line\r\nSecond line';
    const normalizedText = 'First line\nSecond line';
    const job = createJob();
    job.desiredHash = buildDesiredHash({
      operation: 'upsert',
      text: normalizedText,
      options: { autoChunk: true },
      mode: 'default',
    });
    const jobModel = {
      findOne: jest.fn().mockResolvedValue(job),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const chatModel = {
      findById: jest.fn().mockResolvedValue({
        contentType: 'text',
        content: { text: rawText },
      }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const service = new EmbeddingQueueService({
      jobModel,
      chatModel,
      embeddingService,
      loggerImpl: createLogger(),
    });
    service.markRemoteAttempt = jest.fn().mockResolvedValue({ ...job, attempts: 1 });

    await expect(service.processClaimedJob(job)).resolves.toBe('completed');

    expect(embeddingService.embed).toHaveBeenCalledWith(
      [normalizedText],
      { autoChunk: true },
      null,
      { logFailure: false },
    );
    expect(chatModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'content.text': rawText }),
      expect.objectContaining({
        $set: expect.objectContaining({ embeddingStatus: 'completed' }),
      }),
    );
  });

  test('treats explicitly excluded chat text as a disabled source', async () => {
    const chatModel = {
      findById: jest.fn().mockResolvedValue({
        contentType: 'text',
        content: { text: 'Pending response' },
        embeddingRequested: false,
      }),
    };
    const service = new EmbeddingQueueService({
      jobModel: {},
      chatModel,
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
    });

    await expect(service.resolveStoredSource(createJob())).resolves.toEqual({
      exists: true,
      enabled: false,
      text: 'Pending response',
      rawText: 'Pending response',
    });
  });

  test('does not delete embeddings when an older delete claim now has enabled source text', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob({ operation: 'delete' });
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn().mockResolvedValue({
        exists: true,
        enabled: true,
        text: 'Restored text',
      }),
    });
    service.refreshIntentFromSource = jest.fn().mockResolvedValue();

    await expect(service.processClaimedJob(job)).resolves.toBe('superseded');

    expect(service.refreshIntentFromSource).toHaveBeenCalledTimes(1);
    expect(embeddingService.deleteEmbeddings).not.toHaveBeenCalled();
  });

  test('marks vectors absent when a source is re-enabled during deletion', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob({
      operation: 'delete',
      options: { verifySourceState: true },
    });
    const sourceStateUpdater = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn()
        .mockResolvedValueOnce({ exists: true, enabled: false, text: '' })
        .mockResolvedValueOnce({
          exists: true,
          enabled: true,
          text: 'Re-enabled text',
          rawText: 'Re-enabled text',
        }),
      sourceStateUpdater,
    });
    service.refreshIntentFromSource = jest.fn().mockResolvedValue();

    await expect(service.processClaimedJob(job)).resolves.toBe('superseded');

    expect(embeddingService.deleteEmbeddings).toHaveBeenCalledTimes(1);
    expect(sourceStateUpdater).toHaveBeenCalledWith(job, {
      status: 'pending',
      embeddingRemoved: true,
      text: 'Re-enabled text',
      rawText: 'Re-enabled text',
    });
    expect(service.refreshIntentFromSource).toHaveBeenCalledTimes(1);
  });

  test('hard-delete intents do not turn into an unintended embedding upsert', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob({
      operation: 'delete',
      options: { verifySourceState: false },
    });
    const jobModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const sourceResolver = jest.fn().mockResolvedValue({
      exists: false,
      enabled: false,
      text: '',
    });
    const sourceStateUpdater = jest.fn();
    const service = new EmbeddingQueueService({
      jobModel,
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver,
      sourceStateUpdater,
    });

    await expect(service.processClaimedJob(job)).resolves.toBe('completed');

    expect(embeddingService.deleteEmbeddings).toHaveBeenCalledTimes(1);
    expect(sourceResolver).toHaveBeenCalledTimes(1);
    expect(sourceStateUpdater).not.toHaveBeenCalled();
    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(embeddingService.embedHighQuality).not.toHaveBeenCalled();
  });

  test('defers a hard-delete tombstone while its source document still exists', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob({
      operation: 'delete',
      options: { verifySourceState: false },
    });
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn().mockResolvedValue({
        exists: true,
        enabled: true,
        text: 'Live source',
      }),
    });
    service.deferClaim = jest.fn().mockResolvedValue();

    await expect(service.processClaimedJob(job)).resolves.toBe('deferred');

    expect(service.deferClaim).toHaveBeenCalledWith(job);
    expect(embeddingService.deleteEmbeddings).not.toHaveBeenCalled();
    expect(embeddingService.embed).not.toHaveBeenCalled();
  });

  test('completes an idempotent delete for an already-disabled chat source', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob({ operation: 'delete' });
    const jobModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const chatModel = {
      findById: jest.fn().mockResolvedValue({
        contentType: 'text',
        content: { text: '' },
      }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 }),
    };
    const service = new EmbeddingQueueService({
      jobModel,
      chatModel,
      embeddingService,
      loggerImpl: createLogger(),
    });

    await expect(service.processClaimedJob(job)).resolves.toBe('completed');

    expect(chatModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStatus: { $in: ['delete_pending', 'disabled'] },
      }),
      expect.any(Object),
    );
  });

  test('discards a computed vector when the source changes during the request', async () => {
    const embeddingService = createEmbeddingService();
    const job = createJob();
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService,
      loggerImpl: createLogger(),
      sourceResolver: jest.fn()
        .mockResolvedValueOnce({ exists: true, enabled: true, text: 'Old text' })
        .mockResolvedValueOnce({ exists: true, enabled: true, text: 'New text' }),
    });
    job.desiredHash = buildDesiredHash({
      operation: 'upsert',
      text: 'Old text',
      options: { autoChunk: true },
      mode: 'default',
    });
    service.markRemoteAttempt = jest.fn().mockResolvedValue({ ...job, attempts: 1 });
    service.refreshIntentFromSource = jest.fn().mockResolvedValue();

    await expect(service.processClaimedJob(job)).resolves.toBe('superseded');

    expect(service.refreshIntentFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ desiredHash: job.desiredHash }),
      { exists: true, enabled: true, text: 'New text' },
    );
    expect(embeddingService.persistEmbeddings).not.toHaveBeenCalled();
  });

  test('retries timeouts with capped backoff and dead-letters request errors', () => {
    expect(isRetryableEmbeddingError({ code: 'ETIMEOUT' })).toBe(true);
    expect(isRetryableEmbeddingError({ status: 429 })).toBe(true);
    expect(isRetryableEmbeddingError({ status: 503 })).toBe(true);
    expect(isRetryableEmbeddingError({ status: 400 })).toBe(false);
    const service = new EmbeddingQueueService({
      jobModel: {},
      embeddingService: createEmbeddingService(),
      loggerImpl: createLogger(),
      retryBaseMs: 1000,
      retryMaxMs: 8000,
    });
    expect(service.retryDelayForAttempt(1)).toBe(1000);
    expect(service.retryDelayForAttempt(5)).toBe(8000);
    expect(service.leaseMs).toBeGreaterThan(service.requestTimeoutMs);
  });
});
