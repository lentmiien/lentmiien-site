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

describe('saved image embedding recovery', () => {
  function fixture(overrides = {}) {
    const image = {
      _id: '507f191e810c19729de860ea', job_id: 'image-job', prompt: ' Private image prompt\r\nsecond line ',
      rating_label: 'great', rating_value: 4, embedding_status: 'pending',
      high_quality_embedding_status: 'pending', high_quality_embedding: false, embedding_queue_version: 1,
      ...overrides,
    };
    const jobs = new Map();
    const jobModel = {
      findById: jest.fn(async id => jobs.has(id) ? { ...jobs.get(id) } : null),
      create: jest.fn(async job => { jobs.set(job._id, { ...job }); return { ...job }; }),
      findOne: jest.fn(async filter => jobs.has(filter._id) ? { ...jobs.get(filter._id) } : null),
      updateOne: jest.fn(async (filter, update) => {
        const job = jobs.get(filter._id);
        if (!job || Object.entries(filter).some(([key, value]) => job[key] !== value)) return { modifiedCount: 0 };
        Object.assign(job, update.$set);
        for (const key of Object.keys(update.$unset || {})) delete job[key];
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const goodImageModel = {
      findById: jest.fn(async () => ({ ...image })),
      updateOne: jest.fn(async (_filter, update) => {
        Object.assign(image, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const embeddingService = createEmbeddingService();
    const logger = createLogger();
    const vectorModel = { exists: jest.fn().mockResolvedValue(null) };
    const highQualityVectorModel = { exists: jest.fn().mockResolvedValue(null) };
    const dependencies = { jobModel, goodImageModel, vectorModel, highQualityVectorModel, embeddingService, loggerImpl: logger };
    function worker() {
      const service = new EmbeddingQueueService(dependencies);
      service.findLimited = jest.fn(async (model, filter) => {
        if (model !== goodImageModel) return [];
        if (filter.embedding_queue_version?.$exists === false) {
          return image.embedding_queue_version === undefined && ['pending', 'failed'].includes(image.embedding_status) ? [{ ...image }] : [];
        }
        return image.embedding_status === 'pending' || image.high_quality_embedding_status === 'pending' ? [{ ...image }] : [];
      });
      service.markRemoteAttempt = jest.fn(async job => {
        const updated = { ...jobs.get(job._id), attempts: job.attempts + 1 };
        jobs.set(job._id, updated);
        return { ...updated };
      });
      return service;
    }
    async function process(service, mode) {
      const stored = [...jobs.values()].find(job => job.mode === mode);
      Object.assign(stored, { status: 'processing', claimToken: `claim-${mode}` });
      return service.processClaimedJob({ ...stored });
    }
    return { image, jobs, jobModel, goodImageModel, embeddingService, logger, vectorModel, highQualityVectorModel, worker, process };
  }

  test('creates distinct durable standard/HQ intents without embedding or storing prompt text in jobs', async () => {
    const f = fixture();
    const service = f.worker();
    expect(await service.enqueueGoodImage(f.image)).toBe(2);
    await service.enqueueGoodImage(f.image);
    expect(f.jobs.size).toBe(2);
    expect(f.jobModel.create).toHaveBeenCalledTimes(2);
    expect([...f.jobs.values()].map(job => job.mode)).toEqual(['default', 'high_quality']);
    expect(JSON.stringify([...f.jobs.values()])).not.toContain('Private image prompt');
    expect(f.embeddingService.embed).not.toHaveBeenCalled();
    expect(f.embeddingService.embedHighQuality).not.toHaveBeenCalled();
  });

  test('standard success survives an HQ timeout and a restarted worker completes only the pending mode', async () => {
    const f = fixture();
    const first = f.worker();
    await first.enqueueGoodImage(f.image);
    expect(await f.process(first, 'default')).toBe('completed');
    f.embeddingService.embedHighQuality.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    expect(await f.process(first, 'high_quality')).toBe('failed');
    expect(f.image).toMatchObject({ embedding_status: 'completed', high_quality_embedding_status: 'pending', high_quality_embedding: false });
    expect([...f.jobs.values()].find(job => job.mode === 'high_quality')).toMatchObject({ status: 'pending', nextAttemptAt: expect.any(Date) });
    const restarted = f.worker();
    await restarted.reconcileGoodImages();
    expect(await f.process(restarted, 'high_quality')).toBe('completed');
    await restarted.reconcileGoodImages();
    expect(f.image).toMatchObject({ embedding_status: 'completed', high_quality_embedding_status: 'completed', high_quality_embedding: true });
    expect(f.embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(f.embeddingService.embedHighQuality).toHaveBeenCalledTimes(2);
    expect(f.embeddingService.persistEmbeddings).toHaveBeenCalledTimes(2);
    expect(f.goodImageModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ prompt: f.image.prompt }), expect.any(Object));
  });

  test('a saved image remains durable while ComfyUI is loaded and is processed automatically after stop', async () => {
    const f = fixture({ rating_label: 'good', rating_value: 3, high_quality_embedding_status: 'disabled' });
    const service = f.worker();
    await service.enqueueGoodImage(f.image);
    service.getReservation = async () => ({ active: false });
    service.getContainers = jest.fn().mockResolvedValue({ containers: [{ id: 'comfyui', state: 'running' }] });
    service.reconcilePendingSourcesIfDue = jest.fn();
    service.claimNext = jest.fn(async operation => {
      if (operation === 'delete') return null;
      const stored = [...f.jobs.values()].find(job => job.status === 'pending');
      if (!stored) return null;
      Object.assign(stored, { status: 'processing', claimToken: 'background-claim' });
      return { ...stored };
    });
    expect(await service.drainQueue()).toMatchObject({ processed: 0, skipped: 'gpu_busy' });
    expect([...f.jobs.values()][0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(f.embeddingService.embed).not.toHaveBeenCalled();
    service.getContainers.mockResolvedValue({ containers: [{ id: 'comfyui', state: 'exited' }] });
    expect(await service.drainQueue()).toEqual({ processed: 1 });
    expect(f.image.embedding_status).toBe('completed');
    expect(f.embeddingService.embed).toHaveBeenCalledTimes(1);
  });

  test('recovers a saved source after enqueue loss and coalesces jobs after another restart', async () => {
    const f = fixture();
    f.jobModel.create.mockRejectedValueOnce(new Error('temporary database failure'));
    await expect(f.worker().enqueueGoodImage(f.image)).rejects.toThrow();
    expect(f.image.embedding_status).toBe('pending');
    await f.worker().reconcileGoodImages();
    await f.worker().reconcileGoodImages();
    expect(f.jobs.size).toBe(2);
    expect(f.embeddingService.embed).not.toHaveBeenCalled();
  });

  test('legacy partial success reuses its standard vectors and queues the missing HQ result once', async () => {
    const f = fixture({ embedding_queue_version: undefined, embedding_status: 'failed', high_quality_embedding_status: undefined, high_quality_embedding: true });
    f.vectorModel.exists.mockResolvedValue({ _id: 'existing-vector' });
    const service = f.worker();
    expect(await service.reconcileGoodImages()).toMatchObject({ queued: 1, markedCompleted: 1 });
    expect(f.image).toMatchObject({ embedding_queue_version: 1, embedding_status: 'completed', high_quality_embedding_status: 'pending', high_quality_embedding: false });
    expect([...f.jobs.values()].map(job => job.mode)).toEqual(['high_quality']);
    await f.worker().reconcileGoodImages();
    expect(f.jobModel.create).toHaveBeenCalledTimes(1);
    expect(service.findLimited).toHaveBeenCalledWith(f.goodImageModel, {
      embedding_queue_version: { $exists: false }, embedding_status: { $in: ['pending', 'failed'] },
    }, { created_at: 1 });
  });

  test('legacy failed good images recover without requesting HQ embeddings', async () => {
    const f = fixture({ rating_label: 'good', rating_value: 3, embedding_queue_version: undefined, embedding_status: 'failed', high_quality_embedding_status: undefined });
    await f.worker().reconcileGoodImages();
    expect(f.image).toMatchObject({ embedding_status: 'pending', high_quality_embedding_status: 'disabled' });
    expect([...f.jobs.values()].map(job => job.mode)).toEqual(['default']);
  });

  test('missing prompts and permanent HQ failures stop retrying without changing a successful standard result', async () => {
    const missing = fixture({ prompt: '', embedding_queue_version: undefined, embedding_status: 'failed', high_quality_embedding_status: undefined });
    await missing.worker().reconcileGoodImages();
    await missing.worker().reconcileGoodImages();
    expect(missing.image.high_quality_embedding_status).toBe('failed');
    expect(missing.jobs.size).toBe(0);
    expect(missing.logger.warning).toHaveBeenCalledTimes(1);
    const f = fixture();
    const service = f.worker();
    await service.enqueueGoodImage(f.image);
    await f.process(service, 'default');
    f.embeddingService.embedHighQuality.mockRejectedValueOnce(Object.assign(new Error('invalid'), { status: 400 }));
    await f.process(service, 'high_quality');
    await f.worker().reconcileGoodImages();
    expect(f.image).toMatchObject({ embedding_status: 'completed', high_quality_embedding_status: 'failed' });
    expect(f.embeddingService.embedHighQuality).toHaveBeenCalledTimes(1);
  });

  test('deletion during generation discards the computed image vector', async () => {
    const f = fixture();
    const service = f.worker();
    await service.enqueueGoodImage(f.image);
    f.goodImageModel.findById.mockResolvedValueOnce(f.image).mockResolvedValue(null);
    service.enqueueDelete = jest.fn();
    expect(await f.process(service, 'default')).toBe('superseded');
    expect(f.embeddingService.persistEmbeddings).not.toHaveBeenCalled();
    expect(service.enqueueDelete).toHaveBeenCalledWith(expect.objectContaining({ collectionName: 'good_images' }), { mode: 'default' });
  });

  test('reclaims an expired processing lease using the existing atomic claim filter', async () => {
    const now = new Date();
    const jobModel = { findOneAndUpdate: jest.fn().mockResolvedValue({ source: { collectionName: 'good_images' } }) };
    const service = new EmbeddingQueueService({ jobModel, now: () => now, embeddingService: createEmbeddingService() });
    await service.claimNext('upsert');
    expect(jobModel.findOneAndUpdate.mock.calls[0][0].$or).toContainEqual({ status: 'processing', leaseExpiresAt: { $lte: now } });
    expect(jobModel.findOneAndUpdate.mock.calls[0][1].$set.claimToken).toEqual(expect.any(String));
  });
});

describe('embedding GPU admission', () => {
  test.each([
    [{ active: true, service: 'ollama' }, { containers: [{ id: 'comfyui', state: 'exited' }] }, true],
    [{ active: false, dispatch_paused: true }, { containers: [{ id: 'comfyui', state: 'exited' }] }, true],
    [{ active: false, blocked_queue_depth: 1 }, { containers: [{ id: 'comfyui', state: 'exited' }] }, true],
    [{ active: false }, { containers: [{ id: 'comfyui', state: 'running' }] }, true],
    [{ active: false }, { containers: [{ id: 'comfyui', state: 'restarting' }] }, true],
    [{ active: false }, { containers: [{ id: 'comfyui', state: 'exited' }] }, false],
    [{ active: false }, { containers: { comfyui: { running: false, state: 'stopped' } } }, false],
    [{ active: false }, { containers: [] }, true],
    [{ active: false }, { containers: [{ id: 'comfyui', state: 'unknown' }] }, true],
    [{}, { containers: [{ id: 'comfyui', state: 'exited' }] }, true],
  ])('reservation %j and containers %j produce busy=%s', async (reservation, containers, busy) => {
    const service = new EmbeddingQueueService({ jobModel: {}, embeddingService: createEmbeddingService(), loggerImpl: createLogger(),
      getReservation: async () => reservation, getContainers: async () => containers });
    expect(await service.isGpuBusy()).toBe(busy);
  });

  test('waits between ComfyUI generations without an embedding attempt, then resumes after stop', async () => {
    const logger = createLogger();
    const getContainers = jest.fn().mockResolvedValue({ containers: [{ id: 'comfyui', state: 'running' }] });
    const embeddingService = createEmbeddingService();
    const service = new EmbeddingQueueService({ jobModel: {}, embeddingService, loggerImpl: logger,
      getReservation: async () => ({ active: false }), getContainers });
    service.reconcilePendingSourcesIfDue = jest.fn();
    service.claimNext = jest.fn().mockImplementation(async operation => operation === 'upsert' ? createJob() : null);
    service.releaseSupersededClaim = jest.fn();
    service.processClaimedJob = jest.fn();
    expect(await service.drainQueue()).toMatchObject({ skipped: 'gpu_busy' });
    expect(await service.drainQueue()).toMatchObject({ skipped: 'gpu_busy' });
    expect(service.processClaimedJob).not.toHaveBeenCalled();
    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(logger.notice).toHaveBeenCalledTimes(1);
    getContainers.mockResolvedValue({ containers: [{ id: 'comfyui', state: 'exited' }] });
    expect(await service.isGpuBusy()).toBe(false);
    expect(logger.notice).toHaveBeenCalledTimes(2);
  });

  test('state lookup failure defers work and warns once without secrets', async () => {
    const logger = createLogger();
    const service = new EmbeddingQueueService({ jobModel: {}, embeddingService: createEmbeddingService(), loggerImpl: logger,
      getReservation: async () => ({ active: false }), getContainers: async () => { throw new Error('PRIVATE-TOKEN'); } });
    expect(await service.isGpuBusy()).toBe(true);
    expect(await service.isGpuBusy()).toBe(true);
    expect(logger.warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('PRIVATE');
  });

  test('bounded state reads use the configured Gateway hosts and admin header only for container inspection', async () => {
    const previous = process.env.LLM_ADMIN_TOKEN;
    process.env.LLM_ADMIN_TOKEN = 'PRIVATE-ADMIN';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('{"active":false}'))
      .mockResolvedValueOnce(new Response('{"containers":[{"id":"comfyui","state":"exited"}]}'));
    try {
      const service = new EmbeddingQueueService({ jobModel: {}, embeddingService: createEmbeddingService(),
        gatewayBaseUrl: 'http://queue.test', comfyBaseUrl: 'http://comfy.test' });
      expect(await service.isGpuBusy()).toBe(false);
      expect(fetchSpy).toHaveBeenNthCalledWith(1, 'http://queue.test/gpu/reservation', expect.objectContaining({ method: 'GET', headers: {}, redirect: 'error' }));
      expect(fetchSpy).toHaveBeenNthCalledWith(2, 'http://comfy.test/containers', expect.objectContaining({ method: 'GET', headers: { 'X-Admin-Token': 'PRIVATE-ADMIN' }, redirect: 'error' }));
    } finally {
      fetchSpy.mockRestore();
      if (previous === undefined) delete process.env.LLM_ADMIN_TOKEN;
      else process.env.LLM_ADMIN_TOKEN = previous;
    }
  });

  test('rejects oversized or failed Gateway state responses without consuming an embedding attempt', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('x'.repeat(256 * 1024 + 1)))
      .mockResolvedValueOnce(new Response('PRIVATE', { status: 401 }));
    try {
      const service = new EmbeddingQueueService({ jobModel: {}, embeddingService: createEmbeddingService() });
      await expect(service.fetchReservation()).rejects.toThrow('size limit');
      await expect(service.fetchReservation()).rejects.toMatchObject({ status: 401 });
      expect(fetchSpy.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    } finally { fetchSpy.mockRestore(); }
  });
});

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
  function pendingSourceFixture(ageMs, modified = 1) {
    const now = new Date('2026-09-10T03:00:00Z');
    const message = { _id: '507f191e810c19729de860ea', contentType: 'text',
      timestamp: new Date(+now - ageMs), embeddingStatus: 'pending',
      content: { text: 'private conversation content' }, embeddingContentHash: 'old-hash' };
    const chatModel = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: modified }) };
    const conversationModel = { findOne: jest.fn().mockResolvedValue(null) };
    const logger = createLogger();
    const service = new EmbeddingQueueService({ jobModel: {}, chatModel, conversationModel,
      embeddingService: createEmbeddingService(), loggerImpl: logger });
    service.findLimited = jest.fn(async (Model, filter) => Model === chatModel && filter.embeddingStatus === 'pending' ? [message] : []);
    service.enqueue = jest.fn();
    return { now, message, chatModel, conversationModel, logger, service };
  }

  test('a recently saved message waits for conversation attachment and is queued on a later pass', async () => {
    const f = pendingSourceFixture(1000);
    expect((await f.service.reconcilePendingSources(f.now)).markedFailed).toBe(0);
    expect(f.chatModel.updateOne).not.toHaveBeenCalled();
    expect(f.logger.warning).not.toHaveBeenCalled();
    f.conversationModel.findOne.mockResolvedValue({ _id: 'conversation-1' });
    expect((await f.service.reconcilePendingSources(new Date(+f.now + 300_000))).queued).toBe(1);
    expect(f.service.enqueue).toHaveBeenCalled();
    expect(f.chatModel.updateOne).not.toHaveBeenCalled();
  });

  test('an older unattached source logs its opaque ID and reason without content', async () => {
    const f = pendingSourceFixture(300_000);
    expect((await f.service.reconcilePendingSources(f.now)).markedFailed).toBe(1);
    expect(f.logger.warning).toHaveBeenCalledWith(expect.any(String), {
      category: 'embedding_queue', metadata: { documentId: f.message._id, reason: 'conversation_reference_missing', sourceAgeMs: 300_000 },
    });
    expect(JSON.stringify(f.logger.warning.mock.calls)).not.toContain('private conversation');
    expect(f.chatModel.updateOne).toHaveBeenCalledWith({
      _id: f.message._id, embeddingStatus: 'pending', embeddingRequested: { $ne: false },
      'content.text': f.message.content.text, embeddingContentHash: 'old-hash',
    }, { $set: { embeddingStatus: 'failed' } });
  });

  test('a concurrently changed or deleted source is not counted or logged as failed', async () => {
    const f = pendingSourceFixture(600_000, 0);
    expect((await f.service.reconcilePendingSources(f.now)).markedFailed).toBe(0);
    expect(f.logger.warning).not.toHaveBeenCalled();
  });

  test('an explicit deletion intent bypasses orphan failure handling', async () => {
    const f = pendingSourceFixture(600_000);
    f.message.embeddingRequested = false;
    expect((await f.service.reconcilePendingSources(f.now)).markedFailed).toBe(0);
    expect(f.conversationModel.findOne).not.toHaveBeenCalled();
    expect(f.logger.warning).not.toHaveBeenCalled();
    expect(f.chatModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: { embeddingStatus: 'delete_pending', embeddingContentHash: null },
    });
  });

  test('a long-running completion keeps an unattached source pending beyond five minutes', async () => {
    const f = pendingSourceFixture(20 * 60 * 1000);
    f.message.content.responseId = 'response-with-long-tool';
    f.service.pendingModel = { exists: jest.fn().mockResolvedValue({ _id: 'active-response' }) };
    await f.service.reconcilePendingSources(f.now);
    expect(f.chatModel.updateOne).not.toHaveBeenCalled();
    expect(f.logger.warning).not.toHaveBeenCalled();
    f.conversationModel.findOne.mockResolvedValue({ _id: 'conversation-1' });
    await f.service.reconcilePendingSources(new Date(+f.now + 300_000));
    expect(f.service.enqueue).toHaveBeenCalledTimes(1);
  });

  test('an intentionally detached source becomes a deletion intent without an orphan warning', async () => {
    const f = pendingSourceFixture(600_000);
    f.message.embeddingDetachedAt = f.now;
    await f.service.reconcilePendingSources(f.now);
    expect(f.logger.warning).not.toHaveBeenCalled();
    expect(f.service.enqueue).not.toHaveBeenCalled();
    expect(f.chatModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: { embeddingStatus: 'delete_pending', embeddingContentHash: null },
    });
  });

  test('network cause codes survive durable retry and recovery identifies the job without logging payloads', async () => {
    const embeddingService = createEmbeddingService();
    const logger = createLogger();
    let currentJob = createJob({ attempts: 1 });
    const jobModel = {
      updateOne: jest.fn(async (_filter, update) => {
        Object.assign(currentJob, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }),
      findOne: jest.fn(async () => currentJob),
    };
    const sourceResolver = jest.fn().mockResolvedValue({ exists: true, enabled: true, text: 'same text' });
    currentJob.desiredHash = buildDesiredHash({ operation: 'upsert', text: 'same text', options: currentJob.options, mode: currentJob.mode });
    const service = new EmbeddingQueueService({ jobModel, embeddingService, loggerImpl: logger,
      sourceResolver, sourceStateUpdater: jest.fn().mockResolvedValue({ matchedCount: 1 }) });
    service.markRemoteAttempt = jest.fn(async job => ({ ...job, attempts: job.attempts + 1 }));
    const cause = new AggregateError([Object.assign(new Error('private address and token'), { code: 'ECONNRESET' })]);
    embeddingService.embed.mockRejectedValueOnce(new TypeError('fetch failed', { cause }));
    expect(await service.processClaimedJob({ ...currentJob })).toBe('failed');
    expect(currentJob.status).toBe('pending');
    expect(currentJob.nextAttemptAt).toBeInstanceOf(Date);
    expect(logger.warning).toHaveBeenCalledWith('Background embedding queue attempt failed', expect.objectContaining({
      metadata: expect.objectContaining({ codes: ['ECONNRESET'], retryable: true }),
    }));
    expect(embeddingService.persistEmbeddings).not.toHaveBeenCalled();
    expect(await service.processClaimedJob({ ...currentJob })).toBe('completed');
    expect(embeddingService.persistEmbeddings).toHaveBeenCalledTimes(1);
    expect(logger.notice).toHaveBeenCalledWith('Embedding queue job recovered after retries', expect.objectContaining({
      metadata: expect.objectContaining({ jobId: currentJob._id, attempts: 2 }),
    }));
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private address');
  });

  test('a recovery batch reports completed and retried counts without claiming the entire backlog is drained', async () => {
    const logger = createLogger();
    const service = new EmbeddingQueueService({ jobModel: {}, embeddingService: createEmbeddingService(), loggerImpl: logger });
    service.reconcilePendingSourcesIfDue = jest.fn();
    service.claimNext = jest.fn().mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createJob({ attempts: 3 })).mockResolvedValueOnce(createJob({ attempts: 0 })).mockResolvedValueOnce(null);
    service.isGpuBusy = jest.fn().mockResolvedValue(false);
    service.processClaimedJob = jest.fn().mockResolvedValue('completed');
    await service.drainQueue();
    expect(logger.notice).toHaveBeenCalledWith('Embedding queue retry batch processed', {
      category: 'embedding_queue', metadata: { processed: 2, completedCount: 2, retriedCount: 1, recoveredCount: 1, failedCount: 0 },
    });
  });
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
