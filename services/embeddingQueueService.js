const { createHash, randomUUID } = require('crypto');

const {
  Chat5Model,
  Conversation5Model,
  EmbeddingQueueJob,
  MessageInboxEntry,
  VectorEmbedding,
  VectorEmbeddingHighQuality,
} = require('../database');
const { normalizeAiGatewayReservation } = require('../utils/aiGatewayReservation');
const logger = require('../utils/logger');
const EmbeddingApiService = require('./embeddingApiService');

const DEFAULT_GATEWAY_BASE_URL = 'http://192.168.0.20:8080';
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;
const DEFAULT_RETRY_BASE_MS = 30 * 1000;
const DEFAULT_RETRY_MAX_MS = 30 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 17 * 60 * 1000;
const DEFAULT_RESERVATION_TIMEOUT_MS = 5 * 1000;
const DEFAULT_LEASE_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_SOURCE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_SOURCE_RECONCILE_BATCH_SIZE = 100;
const DEFAULT_STANDARD_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CHAT_MESSAGE_COLLECTION = 'chat_message';
const MESSAGE_INBOX_COLLECTION = 'message_inbox';
const SEARCH_MODES = new Set(['default', 'high_quality']);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMode(value) {
  return SEARCH_MODES.has(value) ? value : 'default';
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_GATEWAY_BASE_URL).trim();
  return (baseUrl || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function buildEmbeddingQueueJobId(source, mode = 'default') {
  return hashValue({
    collectionName: source.collectionName,
    documentId: source.documentId,
    contentType: source.contentType,
    mode: normalizeMode(mode),
  });
}

function buildDesiredHash({ operation, text = '', options = {}, mode = 'default' }) {
  return hashValue({
    operation,
    text: operation === 'upsert' ? text : '',
    options,
    mode: normalizeMode(mode),
  });
}

function isRetryableEmbeddingError(error) {
  if (error?.retryable === false) return false;
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  const code = String(error?.code || '').toUpperCase();
  if (Number.isFinite(status)) {
    return [408, 409, 425, 429].includes(status) || status >= 500;
  }
  if (['ERR_INVALID_ARG_TYPE', 'ERR_ASSERTION'].includes(code)) return false;
  return true;
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'Embedding queue operation failed').slice(0, 1000);
}

async function resolveQuery(query, { lean = false } = {}) {
  let current = query;
  if (lean && current && typeof current.lean === 'function') {
    current = current.lean();
  }
  if (current && typeof current.exec === 'function') {
    return current.exec();
  }
  return current;
}

function modifiedCount(result) {
  return Number(result?.modifiedCount || result?.nModified || 0);
}

function matchedCount(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.matchedCount !== undefined) return Number(result.matchedCount);
  if (result.n !== undefined) return Number(result.n);
  return null;
}

class EmbeddingQueueService {
  constructor({
    jobModel = EmbeddingQueueJob,
    chatModel = Chat5Model,
    conversationModel = Conversation5Model,
    messageInboxModel = MessageInboxEntry,
    vectorModel = VectorEmbedding,
    highQualityVectorModel = VectorEmbeddingHighQuality,
    embeddingService = null,
    loggerImpl = logger,
    getReservation = null,
    sourceResolver = null,
    sourceStateUpdater = null,
    gatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL,
    requestTimeoutMs = positiveInteger(
      process.env.EMBED_QUEUE_API_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    reservationTimeoutMs = positiveInteger(
      process.env.EMBED_QUEUE_RESERVATION_TIMEOUT_MS,
      DEFAULT_RESERVATION_TIMEOUT_MS,
    ),
    pollIntervalMs = positiveInteger(
      process.env.EMBED_QUEUE_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    retryBaseMs = positiveInteger(process.env.EMBED_QUEUE_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
    retryMaxMs = positiveInteger(process.env.EMBED_QUEUE_RETRY_MAX_MS, DEFAULT_RETRY_MAX_MS),
    leaseMs = positiveInteger(process.env.EMBED_QUEUE_LEASE_MS, DEFAULT_LEASE_MS),
    batchSize = positiveInteger(process.env.EMBED_QUEUE_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    sourceReconcileIntervalMs = positiveInteger(
      process.env.EMBED_QUEUE_SOURCE_RECONCILE_INTERVAL_MS,
      DEFAULT_SOURCE_RECONCILE_INTERVAL_MS,
    ),
    sourceReconcileBatchSize = positiveInteger(
      process.env.EMBED_QUEUE_SOURCE_RECONCILE_BATCH_SIZE,
      DEFAULT_SOURCE_RECONCILE_BATCH_SIZE,
    ),
    now = () => new Date(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    this.jobModel = jobModel;
    this.chatModel = chatModel;
    this.conversationModel = conversationModel;
    this.messageInboxModel = messageInboxModel;
    this.vectorModel = vectorModel;
    this.highQualityVectorModel = highQualityVectorModel;
    this.embeddingService = embeddingService || new EmbeddingApiService({ timeoutMs: requestTimeoutMs });
    this.logger = loggerImpl;
    this.gatewayBaseUrl = normalizeBaseUrl(gatewayBaseUrl);
    this.requestTimeoutMs = requestTimeoutMs;
    this.reservationTimeoutMs = reservationTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.retryBaseMs = retryBaseMs;
    this.retryMaxMs = Math.max(retryBaseMs, retryMaxMs);
    this.leaseMs = Math.max(leaseMs, requestTimeoutMs + (5 * 60 * 1000));
    this.batchSize = batchSize;
    this.sourceReconcileIntervalMs = sourceReconcileIntervalMs;
    this.sourceReconcileBatchSize = sourceReconcileBatchSize;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.getReservation = getReservation || (() => this.fetchReservation());
    this.sourceResolver = sourceResolver || ((job) => this.resolveStoredSource(job));
    this.sourceStateUpdater = sourceStateUpdater || ((job, state) => (
      this.updateStoredSourceState(job, state)
    ));
    this.started = false;
    this.timer = null;
    this.timerDueAt = 0;
    this.runPromise = null;
    this.pausedReservation = null;
    this.reservationCheckFailed = false;
    this.lastSourceReconcileAt = 0;
  }

  normalizeOptions(options = {}, mode = 'default') {
    const normalized = this.embeddingService.normalizeOptions(options || {});
    if (mode === 'high_quality') {
      normalized.task = typeof options?.task === 'string' && options.task.trim()
        ? options.task.trim()
        : 'document';
    } else if (typeof options?.task === 'string' && options.task.trim()) {
      normalized.task = options.task.trim();
    }
    return normalized;
  }

  normalizeSourceText(value) {
    try {
      return this.embeddingService.normalizeTexts(value)[0] || '';
    } catch (error) {
      return '';
    }
  }

  async enqueue(textInput, options = {}, metadataInput = null, {
    mode = 'default',
    force = false,
  } = {}) {
    const normalizedMode = normalizeMode(mode);
    const texts = this.embeddingService.normalizeTexts(textInput);
    if (texts.length !== 1) {
      throw new Error('Embedding queue intents must contain exactly one text.');
    }
    const metadata = this.embeddingService.normalizeMetadataList(metadataInput, 1);
    if (!metadata) {
      throw new Error('Embedding queue intents require source metadata.');
    }
    const normalizedOptions = this.normalizeOptions(options, normalizedMode);
    const desiredHash = buildDesiredHash({
      operation: 'upsert',
      text: texts[0],
      options: normalizedOptions,
      mode: normalizedMode,
    });
    return this.upsertDesiredIntent({
      source: metadata[0],
      mode: normalizedMode,
      operation: 'upsert',
      options: normalizedOptions,
      desiredHash,
      force,
    });
  }

  async enqueueDelete(metadataInput, {
    mode = 'default',
    force = false,
    verifySourceState = true,
  } = {}) {
    const normalizedMode = normalizeMode(mode);
    const metadataArray = Array.isArray(metadataInput) ? metadataInput : [metadataInput];
    const metadata = this.embeddingService.normalizeMetadataList(metadataArray, metadataArray.length);
    if (!metadata || metadata.length !== 1) {
      throw new Error('Embedding queue delete intents require exactly one source.');
    }
    const options = { verifySourceState: verifySourceState !== false };
    return this.upsertDesiredIntent({
      source: metadata[0],
      mode: normalizedMode,
      operation: 'delete',
      options,
      desiredHash: buildDesiredHash({
        operation: 'delete',
        options,
        mode: normalizedMode,
      }),
      force,
    });
  }

  async getJob(jobId) {
    return resolveQuery(this.jobModel.findById(jobId), { lean: true });
  }

  async upsertDesiredIntent({ source, mode, operation, options, desiredHash, force = false }) {
    const jobId = buildEmbeddingQueueJobId(source, mode);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await this.getJob(jobId);
      const sourceUnchanged = existing
        && stableSerialize(existing.source) === stableSerialize(source);
      if (existing && sourceUnchanged && existing.desiredHash === desiredHash
        && existing.operation === operation && !force) {
        await this.synchronizeSourceStateFromJob(existing);
        this.kick();
        return existing;
      }

      const now = this.now();
      if (!existing) {
        try {
          const created = await this.jobModel.create({
            _id: jobId,
            source,
            mode,
            operation,
            options,
            desiredHash,
            revision: 1,
            status: 'pending',
            attempts: 0,
            retryable: true,
            nextAttemptAt: null,
            lastError: null,
            queuedAt: now,
          });
          this.kick();
          return created;
        } catch (error) {
          if (error?.code === 11000) continue;
          throw error;
        }
      }

      const keepsActiveClaim = existing.status === 'processing' && existing.claimToken;
      const update = {
        $set: {
          source,
          mode,
          operation,
          options,
          desiredHash,
          status: keepsActiveClaim ? 'processing' : 'pending',
          attempts: 0,
          retryable: true,
          nextAttemptAt: null,
          lastError: null,
          queuedAt: now,
          completedAt: null,
        },
        $inc: { revision: 1 },
      };
      if (!keepsActiveClaim) {
        update.$unset = {
          claimToken: 1,
          leaseExpiresAt: 1,
          startedAt: 1,
        };
      }
      const updated = await resolveQuery(this.jobModel.findOneAndUpdate(
        { _id: jobId, revision: existing.revision },
        update,
        { new: true },
      ));
      if (!updated) continue;
      this.kick();
      return updated;
    }
    throw new Error('Unable to update embedding queue intent after concurrent changes.');
  }

  async synchronizeSourceStateFromJob(job) {
    if (job.operation === 'delete' && job.options?.verifySourceState === false) return;
    let state = null;
    if (job.status === 'completed') {
      const status = job.operation === 'delete' ? 'disabled' : 'completed';
      state = { status };
    } else if (job.status === 'failed') {
      state = { status: 'failed' };
    }
    if (!state) return;

    const sourceState = await this.sourceResolver(job);
    const stillDesired = job.operation === 'upsert'
      ? this.sourceMatchesJob(job, sourceState)
      : !sourceState?.exists || !sourceState.enabled;
    if (!stillDesired) {
      await this.refreshIntentFromSource(job, sourceState);
      return;
    }
    if (sourceState?.text) {
      state.text = sourceState.text;
      state.rawText = sourceState.rawText;
    }
    const result = await this.sourceStateUpdater(job, state);
    if (matchedCount(result) === 0 && job.status === 'completed') {
      const currentSource = sourceState || await this.sourceResolver(job);
      if (!currentSource?.exists && job.operation === 'delete') return;
      await this.refreshIntentFromSource(job, currentSource);
    }
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.schedule(0);
    this.logger.notice('Embedding queue worker started', {
      category: 'embedding_queue',
      metadata: {
        pollIntervalMs: this.pollIntervalMs,
        requestTimeoutMs: this.requestTimeoutMs,
        leaseMs: this.leaseMs,
      },
    });
    return this;
  }

  stop() {
    this.started = false;
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
      this.timerDueAt = 0;
    }
  }

  kick(delayMs = 0) {
    if (!this.started) return;
    this.schedule(delayMs);
  }

  schedule(delayMs = this.pollIntervalMs) {
    if (!this.started) return;
    const safeDelay = Math.max(0, delayMs);
    const dueAt = Date.now() + safeDelay;
    if (this.timer && this.timerDueAt <= dueAt) return;
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timerDueAt = dueAt;
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.timerDueAt = 0;
      this.run().catch(() => {});
    }, safeDelay);
    this.timer?.unref?.();
  }

  async run() {
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.drainQueue()
      .catch((error) => {
        this.logger.error('Embedding queue reconciliation failed', {
          category: 'embedding_queue',
          metadata: { message: safeErrorMessage(error) },
        });
        throw error;
      })
      .finally(() => {
        this.runPromise = null;
        this.schedule(this.pollIntervalMs);
      });
    return this.runPromise;
  }

  async fetchReservation() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.reservationTimeoutMs);
    try {
      const response = await fetch(`${this.gatewayBaseUrl}/gpu/reservation`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`AI Gateway reservation check failed with HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async isGpuBusy() {
    try {
      const rawReservation = await this.getReservation();
      const reservation = normalizeAiGatewayReservation(rawReservation);
      this.reservationCheckFailed = false;
      const busy = reservation?.active === true
        || reservation?.dispatchPaused === true
        || Number(reservation?.blockedQueueDepth || 0) > 0;
      if (busy) {
        const reservationKey = reservation?.id || reservation?.service || 'active';
        if (this.pausedReservation !== reservationKey) {
          this.pausedReservation = reservationKey;
          this.logger.notice('Embedding queue paused for active AI Gateway GPU work', {
            category: 'embedding_queue',
            metadata: {
              reservationId: reservation?.id || null,
              service: reservation?.service || null,
              blockedQueueDepth: reservation?.blockedQueueDepth || 0,
            },
          });
        }
        return true;
      }
      if (this.pausedReservation) {
        this.logger.notice('Embedding queue resumed after AI Gateway GPU work completed', {
          category: 'embedding_queue',
        });
        this.pausedReservation = null;
      }
      return false;
    } catch (error) {
      if (!this.reservationCheckFailed) {
        this.logger.warning('Unable to inspect AI Gateway GPU reservation before embedding work', {
          category: 'embedding_queue',
          metadata: { message: safeErrorMessage(error) },
        });
        this.reservationCheckFailed = true;
      }
      // The Gateway queue remains authoritative. Its long worker-only timeout covers this fallback.
      return false;
    }
  }

  buildClaimFilter(operation, now) {
    return {
      operation,
      $or: [
        {
          status: 'pending',
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
        {
          status: 'processing',
          leaseExpiresAt: { $lte: now },
        },
      ],
    };
  }

  async claimNext(operation) {
    const now = this.now();
    const claimToken = randomUUID();
    return resolveQuery(this.jobModel.findOneAndUpdate(
      this.buildClaimFilter(operation, now),
      {
        $set: {
          status: 'processing',
          claimToken,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          startedAt: now,
          lastError: null,
        },
      },
      { sort: { queuedAt: 1, createdAt: 1 }, new: true },
    ));
  }

  async drainQueue() {
    await this.reconcilePendingSourcesIfDue();
    let processed = 0;
    let deleteProcessed = 0;
    while (deleteProcessed < this.batchSize) {
      const deleteJob = await this.claimNext('delete');
      if (!deleteJob) break;
      await this.processClaimedJob(deleteJob);
      processed += 1;
      deleteProcessed += 1;
    }

    let upsertProcessed = 0;
    while (upsertProcessed < this.batchSize) {
      const job = await this.claimNext('upsert');
      if (!job) break;
      if (await this.isGpuBusy()) {
        await this.releaseSupersededClaim(job);
        return { processed, skipped: 'gpu_busy' };
      }
      await this.processClaimedJob(job);
      processed += 1;
      upsertProcessed += 1;
    }
    return { processed };
  }

  async findLimited(Model, filter, sort) {
    let query = Model.find(filter);
    if (query && typeof query.sort === 'function') query = query.sort(sort);
    if (query && typeof query.limit === 'function') query = query.limit(this.sourceReconcileBatchSize);
    return resolveQuery(query, { lean: true });
  }

  async reconcilePendingSourcesIfDue() {
    const now = this.now();
    if (now.getTime() - this.lastSourceReconcileAt < this.sourceReconcileIntervalMs) return;
    this.lastSourceReconcileAt = now.getTime();
    try {
      await this.reconcilePendingSources(now);
    } catch (error) {
      this.logger.error('Failed to reconcile pending embedding source intents', {
        category: 'embedding_queue',
        metadata: { message: safeErrorMessage(error) },
      });
    }
  }

  async findConversationIdForChatMessage(messageId) {
    const conversation = await resolveQuery(this.conversationModel.findOne(
      { messages: messageId },
      { _id: 1 },
    ), { lean: true });
    return conversation?._id ? String(conversation._id) : null;
  }

  buildChatSource(messageId, conversationId) {
    return {
      collectionName: CHAT_MESSAGE_COLLECTION,
      documentId: String(messageId),
      contentType: 'chat_message_text',
      parentCollection: conversationId ? 'conversation' : null,
      parentId: conversationId || null,
    };
  }

  async findStoredChatSource(messageId) {
    const fallback = this.buildChatSource(messageId, null);
    const existingJob = await this.getJob(buildEmbeddingQueueJobId(fallback, 'default'));
    if (existingJob?.source) return existingJob.source;

    const existingHighQualityJob = await this.getJob(
      buildEmbeddingQueueJobId(fallback, 'high_quality'),
    );
    if (existingHighQualityJob?.source) return existingHighQualityJob.source;

    const filter = {
      'source.collectionName': CHAT_MESSAGE_COLLECTION,
      'source.documentId': String(messageId),
      'source.contentType': 'chat_message_text',
    };
    for (const Model of [this.vectorModel, this.highQualityVectorModel]) {
      if (!Model || typeof Model.findOne !== 'function') continue;
      const vector = await resolveQuery(Model.findOne(filter, { source: 1 }), { lean: true });
      if (vector?.source) return vector.source;
    }
    return null;
  }

  async reconcilePendingSources(now = this.now()) {
    let queued = 0;
    let markedCompleted = 0;
    let markedDisabled = 0;
    let markedFailed = 0;
    const cutoff = new Date(now.getTime() - (DEFAULT_STANDARD_RETENTION_DAYS * MS_PER_DAY));
    const legacyChats = await this.findLimited(this.chatModel, {
      contentType: 'text',
      timestamp: { $gte: cutoff },
      embeddingStatus: { $exists: false },
    }, { timestamp: 1 });

    for (const message of legacyChats || []) {
      const messageId = String(message._id || '');
      if (!messageId) continue;
      const text = this.normalizeSourceText(message.content?.text);
      if (!text) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: { $exists: false } },
          { $set: { embeddingStatus: 'disabled', embeddingContentHash: null } },
        );
        markedDisabled += 1;
        continue;
      }
      const conversationId = await this.findConversationIdForChatMessage(messageId);
      if (!conversationId) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: { $exists: false } },
          { $set: { embeddingStatus: 'disabled', embeddingContentHash: null } },
        );
        markedDisabled += 1;
        continue;
      }
      const source = this.buildChatSource(messageId, conversationId);
      const existingVector = await resolveQuery(this.vectorModel.exists({
        'source.collectionName': CHAT_MESSAGE_COLLECTION,
        'source.documentId': messageId,
        'source.contentType': 'chat_message_text',
        'source.parentCollection': source.parentCollection,
        'source.parentId': source.parentId,
      }));
      if (existingVector) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: { $exists: false } },
          { $set: { embeddingStatus: 'completed' } },
        );
        markedCompleted += 1;
        continue;
      }
      await this.chatModel.updateOne(
        { _id: messageId, embeddingStatus: { $exists: false } },
        { $set: { embeddingStatus: 'pending' } },
      );
      await this.enqueue(text, {}, [source]);
      queued += 1;
    }

    const pendingChats = await this.findLimited(this.chatModel, {
      contentType: 'text',
      embeddingStatus: 'pending',
      timestamp: { $gte: cutoff },
    }, { timestamp: 1 });
    for (const message of pendingChats || []) {
      const messageId = String(message._id || '');
      if (!messageId) continue;
      const text = this.normalizeSourceText(message.content?.text);
      if (!text) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: 'pending' },
          { $set: { embeddingStatus: 'delete_pending', embeddingContentHash: null } },
        );
        continue;
      }
      const conversationId = await this.findConversationIdForChatMessage(messageId);
      if (!conversationId) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: 'pending' },
          { $set: { embeddingStatus: 'failed' } },
        );
        markedFailed += 1;
        continue;
      }
      await this.enqueue(text, {}, [this.buildChatSource(messageId, conversationId)]);
      queued += 1;
    }

    const chatDeletes = await this.findLimited(this.chatModel, {
      embeddingStatus: 'delete_pending',
      timestamp: { $gte: cutoff },
    }, { timestamp: 1 });
    for (const message of chatDeletes || []) {
      const messageId = String(message._id || '');
      if (!messageId) continue;
      const conversationId = await this.findConversationIdForChatMessage(messageId);
      const source = conversationId
        ? this.buildChatSource(messageId, conversationId)
        : await this.findStoredChatSource(messageId);
      if (!source) {
        await this.chatModel.updateOne(
          { _id: messageId, embeddingStatus: 'delete_pending' },
          { $set: { embeddingStatus: 'disabled', embeddingContentHash: null } },
        );
        markedDisabled += 1;
        continue;
      }
      await this.enqueueDelete(source);
      queued += 1;
    }

    const pendingInbox = await this.findLimited(this.messageInboxModel, {
      $or: [
        { embeddingRequested: true, embeddingStatus: 'pending' },
        { highQualityEmbeddingRequested: true, highQualityEmbeddingStatus: 'pending' },
        { embeddingRequested: false, embeddingStatus: 'delete_pending' },
        {
          highQualityEmbeddingRequested: false,
          highQualityEmbeddingStatus: 'delete_pending',
        },
      ],
    }, { createdAt: 1 });
    for (const message of pendingInbox || []) {
      const metadata = [{
        collectionName: MESSAGE_INBOX_COLLECTION,
        documentId: String(message._id),
        contentType: 'message',
        parentCollection: message.threadId ? 'message_thread' : null,
        parentId: message.threadId || null,
      }];
      const candidates = [message.text, message.textAsHtml, message.html, message.subject];
      const sourceText = candidates.find((value) => typeof value === 'string' && value.trim()) || '';
      const text = this.normalizeSourceText(sourceText);
      if (!message.embeddingRequested && message.embeddingStatus === 'delete_pending') {
        await this.enqueueDelete(metadata[0], { mode: 'default' });
        queued += 1;
      }
      if (!message.highQualityEmbeddingRequested
        && message.highQualityEmbeddingStatus === 'delete_pending') {
        await this.enqueueDelete(metadata[0], { mode: 'high_quality' });
        queued += 1;
      }
      if (!text) {
        const fields = {};
        if (message.embeddingRequested && message.embeddingStatus === 'pending') {
          fields.embeddingStatus = 'disabled';
          fields.hasEmbedding = false;
        }
        if (message.highQualityEmbeddingRequested
          && message.highQualityEmbeddingStatus === 'pending') {
          fields.highQualityEmbeddingStatus = 'disabled';
          fields.hasHighQualityEmbedding = false;
        }
        if (Object.keys(fields).length) {
          await this.messageInboxModel.updateOne({ _id: message._id }, { $set: fields });
          markedDisabled += 1;
        }
        continue;
      }
      if (message.embeddingRequested && message.embeddingStatus === 'pending') {
        await this.enqueue(text, { autoChunk: true }, metadata, { mode: 'default' });
        queued += 1;
      }
      if (message.highQualityEmbeddingRequested
        && message.highQualityEmbeddingStatus === 'pending') {
        await this.enqueue(text, { autoChunk: true, task: 'document' }, metadata, {
          mode: 'high_quality',
        });
        queued += 1;
      }
    }

    if (queued || markedCompleted || markedDisabled || markedFailed) {
      this.logger.debug('Reconciled embedding source intents', {
        category: 'embedding_queue',
        metadata: { queued, markedCompleted, markedDisabled, markedFailed },
      });
    }
    return { queued, markedCompleted, markedDisabled, markedFailed };
  }

  claimFilter(job) {
    return {
      _id: String(job._id),
      status: 'processing',
      claimToken: job.claimToken,
      revision: job.revision,
      desiredHash: job.desiredHash,
      operation: job.operation,
    };
  }

  async markRemoteAttempt(job) {
    return resolveQuery(this.jobModel.findOneAndUpdate(
      this.claimFilter(job),
      { $inc: { attempts: 1 } },
      { new: true },
    ));
  }

  async releaseSupersededClaim(job) {
    return this.jobModel.updateOne(
      {
        _id: String(job._id),
        status: 'processing',
        claimToken: job.claimToken,
      },
      {
        $set: {
          status: 'pending',
          retryable: true,
          nextAttemptAt: this.now(),
          lastError: null,
          completedAt: null,
        },
        $unset: {
          claimToken: 1,
          leaseExpiresAt: 1,
          startedAt: 1,
        },
      },
    );
  }

  async deferClaim(job, delayMs = this.pollIntervalMs) {
    const nextAttemptAt = new Date(this.now().getTime() + Math.max(1, delayMs));
    return this.jobModel.updateOne(
      this.claimFilter(job),
      {
        $set: {
          status: 'pending',
          retryable: true,
          nextAttemptAt,
          completedAt: null,
        },
        $unset: {
          claimToken: 1,
          leaseExpiresAt: 1,
          startedAt: 1,
        },
      },
    );
  }

  async resolveStoredSource(job) {
    const source = job.source || {};
    if (source.collectionName === CHAT_MESSAGE_COLLECTION) {
      const message = await resolveQuery(this.chatModel.findById(source.documentId), { lean: true });
      if (!message) return { exists: false, enabled: false, text: '' };
      const rawText = message.contentType === 'text' && typeof message.content?.text === 'string'
        ? message.content.text
        : '';
      const text = this.normalizeSourceText(rawText);
      return { exists: true, enabled: Boolean(text), text, rawText };
    }
    if (source.collectionName === MESSAGE_INBOX_COLLECTION) {
      const message = await resolveQuery(this.messageInboxModel.findById(source.documentId), { lean: true });
      if (!message) return { exists: false, enabled: false, text: '' };
      const requestedField = job.mode === 'high_quality'
        ? 'highQualityEmbeddingRequested'
        : 'embeddingRequested';
      const actualField = job.mode === 'high_quality'
        ? 'hasHighQualityEmbedding'
        : 'hasEmbedding';
      const requested = typeof message[requestedField] === 'boolean'
        ? message[requestedField]
        : Boolean(message[actualField]);
      const candidates = [message.text, message.textAsHtml, message.html, message.subject];
      const sourceText = candidates.find((value) => typeof value === 'string' && value.trim()) || '';
      const text = this.normalizeSourceText(sourceText);
      return { exists: true, enabled: requested && Boolean(text), text };
    }
    const error = new Error(`Unsupported queued embedding source: ${source.collectionName || 'unknown'}.`);
    error.retryable = false;
    throw error;
  }

  async updateStoredSourceState(job, state) {
    const source = job.source || {};
    if (source.collectionName === CHAT_MESSAGE_COLLECTION) {
      if (job.mode === 'high_quality') return null;
      const filter = { _id: source.documentId };
      const fields = {
        embeddingStatus: state.status,
      };
      if (state.status === 'completed') {
        filter.contentType = 'text';
        filter['content.text'] = state.rawText ?? state.text;
        fields.embeddingContentHash = job.desiredHash;
      }
      if (state.status === 'pending' && state.embeddingRemoved) {
        filter.contentType = 'text';
        filter['content.text'] = state.rawText ?? state.text;
        fields.embeddingContentHash = null;
      }
      if (state.status === 'disabled') {
        filter.embeddingStatus = { $in: ['delete_pending', 'disabled'] };
        fields.embeddingContentHash = null;
      }
      if (state.status === 'failed') {
        if (job.operation === 'delete') {
          filter.embeddingStatus = 'delete_pending';
        } else {
          filter.contentType = 'text';
          filter['content.text'] = state.rawText ?? state.text;
        }
      }
      return this.chatModel.updateOne(filter, { $set: fields });
    }
    if (source.collectionName === MESSAGE_INBOX_COLLECTION) {
      const highQuality = job.mode === 'high_quality';
      const requestedField = highQuality
        ? 'highQualityEmbeddingRequested'
        : 'embeddingRequested';
      const actualField = highQuality ? 'hasHighQualityEmbedding' : 'hasEmbedding';
      const statusField = highQuality ? 'highQualityEmbeddingStatus' : 'embeddingStatus';
      const filter = { _id: source.documentId };
      const fields = { [statusField]: state.status };
      if (state.status === 'pending' && state.embeddingRemoved) {
        filter[requestedField] = { $ne: false };
        fields[actualField] = false;
      }
      if (state.status === 'completed') {
        filter[requestedField] = { $ne: false };
        fields[actualField] = true;
      } else if (state.status === 'disabled') {
        filter[requestedField] = false;
        fields[actualField] = false;
      } else if (state.status === 'failed') {
        filter[requestedField] = job.operation === 'delete' ? false : { $ne: false };
      }
      return this.messageInboxModel.updateOne(filter, { $set: fields });
    }
    return null;
  }

  sourceMatchesJob(job, sourceState) {
    if (!sourceState?.exists || !sourceState.enabled || !sourceState.text) return false;
    const currentHash = buildDesiredHash({
      operation: 'upsert',
      text: sourceState.text,
      options: job.options || {},
      mode: job.mode,
    });
    return currentHash === job.desiredHash;
  }

  async refreshIntentFromSource(job, sourceState) {
    if (sourceState?.exists && sourceState.enabled && sourceState.text) {
      await this.enqueue(sourceState.text, job.options || {}, [job.source], {
        mode: job.mode,
      });
    } else {
      await this.enqueueDelete(job.source, { mode: job.mode });
    }
    await this.releaseSupersededClaim(job);
  }

  async processClaimedJob(job) {
    try {
      if (job.operation === 'delete') {
        const verifySourceState = job.options?.verifySourceState !== false;
        const sourceBeforeDelete = await this.sourceResolver(job);
        if (!verifySourceState && sourceBeforeDelete?.exists) {
          await this.deferClaim(job);
          return 'deferred';
        }
        if (verifySourceState) {
          if (sourceBeforeDelete?.exists && sourceBeforeDelete.enabled) {
            await this.refreshIntentFromSource(job, sourceBeforeDelete);
            return 'superseded';
          }
        }
        await this.embeddingService.deleteEmbeddings(job.source, { mode: job.mode });
        if (verifySourceState) {
          const sourceAfterDelete = await this.sourceResolver(job);
          if (sourceAfterDelete?.exists && sourceAfterDelete.enabled) {
            await this.sourceStateUpdater(job, {
              status: 'pending',
              embeddingRemoved: true,
              text: sourceAfterDelete.text,
              rawText: sourceAfterDelete.rawText,
            });
            await this.refreshIntentFromSource(job, sourceAfterDelete);
            return 'superseded';
          }
        }
        const completed = await this.finishClaim(job, {
          status: 'disabled',
          skipSourceUpdate: !verifySourceState,
        });
        return completed ? 'completed' : 'superseded';
      }

      const sourceBefore = await this.sourceResolver(job);
      if (!this.sourceMatchesJob(job, sourceBefore)) {
        await this.refreshIntentFromSource(job, sourceBefore);
        return 'superseded';
      }

      const attemptedJob = await this.markRemoteAttempt(job);
      if (!attemptedJob) {
        await this.releaseSupersededClaim(job);
        return 'superseded';
      }
      job = attemptedJob;

      const response = job.mode === 'high_quality'
        ? await this.embeddingService.embedHighQuality(
          [sourceBefore.text],
          job.options || {},
          null,
          { logFailure: false },
        )
        : await this.embeddingService.embed(
          [sourceBefore.text],
          job.options || {},
          null,
          { logFailure: false },
        );

      const sourceAfter = await this.sourceResolver(job);
      if (!this.sourceMatchesJob(job, sourceAfter)) {
        await this.refreshIntentFromSource(job, sourceAfter);
        return 'superseded';
      }
      const currentClaim = await resolveQuery(this.jobModel.findOne(this.claimFilter(job)), { lean: true });
      if (!currentClaim) {
        await this.releaseSupersededClaim(job);
        return 'superseded';
      }

      const model = this.embeddingService.getModelForMode(job.mode);
      await this.embeddingService.persistEmbeddings(
        [sourceAfter.text],
        [job.source],
        response,
        model,
      );
      const completed = await this.finishClaim(job, {
        status: 'completed',
        text: sourceAfter.text,
        rawText: sourceAfter.rawText,
      });
      return completed ? 'completed' : 'superseded';
    } catch (error) {
      await this.failClaim(job, error);
      return 'failed';
    }
  }

  async finishClaim(job, sourceState) {
    const now = this.now();
    const result = await this.jobModel.updateOne(
      this.claimFilter(job),
      {
        $set: {
          status: 'completed',
          retryable: false,
          nextAttemptAt: null,
          lastError: null,
          completedAt: now,
        },
        $unset: {
          claimToken: 1,
          leaseExpiresAt: 1,
          startedAt: 1,
        },
      },
    );
    if (!modifiedCount(result)) {
      await this.releaseSupersededClaim(job);
      return false;
    }

    if (sourceState.skipSourceUpdate) return true;

    try {
      const sourceUpdateResult = await this.sourceStateUpdater(job, sourceState);
      if (matchedCount(sourceUpdateResult) === 0) {
        const currentSource = await this.sourceResolver(job);
        if (!currentSource?.exists && job.operation === 'delete') return true;
        await this.refreshIntentFromSource(job, currentSource);
        return false;
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      await this.jobModel.updateOne(
        { _id: String(job._id), revision: job.revision, status: 'completed' },
        {
          $set: {
            status: 'pending',
            retryable: true,
            nextAttemptAt: new Date(now.getTime() + this.retryBaseMs),
            lastError: message,
            completedAt: null,
          },
        },
      );
      this.logger.warning('Embedding persisted but source status update will be retried', {
        category: 'embedding_queue',
        metadata: { jobId: String(job._id), mode: job.mode, message },
      });
      return false;
    }
    return true;
  }

  retryDelayForAttempt(attempt) {
    const exponent = Math.min(20, Math.max(0, Number(attempt || 1) - 1));
    return Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** exponent));
  }

  async failClaim(job, error) {
    const retryable = isRetryableEmbeddingError(error);
    const message = safeErrorMessage(error);
    const now = this.now();
    const nextAttemptAt = retryable
      ? new Date(now.getTime() + this.retryDelayForAttempt(job.attempts || 1))
      : null;
    const result = await this.jobModel.updateOne(
      this.claimFilter(job),
      {
        $set: {
          status: retryable ? 'pending' : 'failed',
          retryable,
          nextAttemptAt,
          lastError: message,
          completedAt: null,
        },
        $unset: {
          claimToken: 1,
          leaseExpiresAt: 1,
          startedAt: 1,
        },
      },
    );
    if (!modifiedCount(result)) {
      await this.releaseSupersededClaim(job);
      return;
    }
    if (!retryable && !(job.operation === 'delete' && job.options?.verifySourceState === false)) {
      await Promise.resolve().then(async () => {
        const currentSource = await this.sourceResolver(job);
        const stillDesired = job.operation === 'upsert'
          ? this.sourceMatchesJob(job, currentSource)
          : !currentSource?.exists || !currentSource.enabled;
        if (stillDesired) {
          await this.sourceStateUpdater(job, {
            status: 'failed',
            text: currentSource?.text,
            rawText: currentSource?.rawText,
          });
        } else {
          await this.refreshIntentFromSource(job, currentSource);
        }
      }).catch(() => {});
    }
    const logMethod = retryable ? 'warning' : 'error';
    this.logger[logMethod]('Background embedding queue attempt failed', {
      category: 'embedding_queue',
      metadata: {
        jobId: String(job._id),
        mode: job.mode,
        attempt: Number(job.attempts || 0),
        retryable,
        nextAttemptAt,
        message,
      },
    });
  }
}

const embeddingQueueService = new EmbeddingQueueService();

module.exports = embeddingQueueService;
module.exports.EmbeddingQueueService = EmbeddingQueueService;
module.exports.buildDesiredHash = buildDesiredHash;
module.exports.buildEmbeddingQueueJobId = buildEmbeddingQueueJobId;
module.exports.isRetryableEmbeddingError = isRetryableEmbeddingError;
