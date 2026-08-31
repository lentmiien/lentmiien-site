const { OcrJob } = require('../database');
const EmbeddingApiService = require('./embeddingApiService');
const logger = require('../utils/logger');

const OCR_EMBED_CONTENT_TYPE = 'ocr_layout_text';
const OCR_SOURCE_COLLECTION = 'ocr_job_files';
const OCR_PARENT_COLLECTION = 'ocr_job';
const DEFAULT_IDLE_DELAY_MS = 60 * 1000;
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_EMBED_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_BASE_MS = 60 * 1000;
const DEFAULT_RETRY_MAX_MS = 30 * 60 * 1000;
const DEFAULT_PROCESSING_STALE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_JOB_BATCH_SIZE = 20;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildOcrEmbeddingMetadata(job, file) {
  const documentId = String(file?.id || file?._id || '').trim();
  const parentId = String(job?.id || job?._id || '').trim();
  if (!documentId || !parentId) return null;

  return {
    collectionName: OCR_SOURCE_COLLECTION,
    documentId,
    contentType: OCR_EMBED_CONTENT_TYPE,
    parentCollection: OCR_PARENT_COLLECTION,
    parentId,
  };
}

function isRetryableEmbeddingError(error) {
  const status = Number(error?.status || error?.response?.status);
  const code = String(error?.code || '').toUpperCase();
  if (Number.isFinite(status)) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return error?.name === 'AbortError'
    || ['ETIMEOUT', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND']
      .includes(code);
}

function isEmbeddingDue(file, now, { maxAttempts, processingStaleMs }) {
  if (!file || file.status !== 'completed' || !file.result) return false;

  const status = file.embeddingStatus || 'pending';
  const attempts = Number.isFinite(Number(file.embeddingAttempts))
    ? Number(file.embeddingAttempts)
    : 0;

  if (status === 'pending') return true;
  if (status === 'processing') {
    const updatedAt = toDate(file.embeddingUpdatedAt);
    return !updatedAt || updatedAt.getTime() <= now.getTime() - processingStaleMs;
  }
  if (status !== 'failed' || file.embeddingRetryable === false || attempts >= maxAttempts) {
    return false;
  }

  const nextAttemptAt = toDate(file.embeddingNextAttemptAt);
  return !nextAttemptAt || nextAttemptAt <= now;
}

class OcrEmbeddingService {
  constructor({
    ocrJobModel = OcrJob,
    embeddingService = null,
    loggerImpl = logger,
    idleDelayMs = positiveInteger(process.env.OCR_EMBED_IDLE_DELAY_MS, DEFAULT_IDLE_DELAY_MS),
    reconcileIntervalMs = positiveInteger(
      process.env.OCR_EMBED_RECONCILE_INTERVAL_MS,
      DEFAULT_RECONCILE_INTERVAL_MS,
    ),
    retryBaseMs = positiveInteger(process.env.OCR_EMBED_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
    retryMaxMs = positiveInteger(process.env.OCR_EMBED_RETRY_MAX_MS, DEFAULT_RETRY_MAX_MS),
    processingStaleMs = positiveInteger(
      process.env.OCR_EMBED_PROCESSING_STALE_MS,
      DEFAULT_PROCESSING_STALE_MS,
    ),
    maxAttempts = positiveInteger(process.env.OCR_EMBED_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    jobBatchSize = positiveInteger(process.env.OCR_EMBED_JOB_BATCH_SIZE, DEFAULT_JOB_BATCH_SIZE),
    now = () => new Date(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    this.ocrJobModel = ocrJobModel;
    this.embeddingService = embeddingService || new EmbeddingApiService({
      timeoutMs: positiveInteger(process.env.OCR_EMBED_API_TIMEOUT_MS, DEFAULT_EMBED_TIMEOUT_MS),
    });
    this.logger = loggerImpl;
    this.idleDelayMs = idleDelayMs;
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.retryBaseMs = retryBaseMs;
    this.retryMaxMs = Math.max(retryBaseMs, retryMaxMs);
    this.processingStaleMs = processingStaleMs;
    this.maxAttempts = maxAttempts;
    this.jobBatchSize = jobBatchSize;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.isOcrIdle = () => true;
    this.isDatabaseReady = () => true;
    this.notBeforeAt = 0;
    this.idleTimer = null;
    this.interval = null;
    this.runPromise = null;
  }

  setOcrIdleCheck(check) {
    this.isOcrIdle = typeof check === 'function' ? check : () => true;
  }

  setDatabaseReadyCheck(check) {
    this.isDatabaseReady = typeof check === 'function' ? check : () => true;
  }

  start() {
    if (this.interval) return this;
    this.deferUntilOcrIdle();
    this.interval = this.setIntervalFn(() => {
      this.run().catch(() => {});
    }, this.reconcileIntervalMs);
    this.interval?.unref?.();
    return this;
  }

  stop() {
    if (this.idleTimer) {
      this.clearTimeoutFn(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.interval) {
      this.clearIntervalFn(this.interval);
      this.interval = null;
    }
  }

  noteOcrActivity() {
    this.notBeforeAt = this.now().getTime() + this.idleDelayMs;
    if (this.idleTimer) {
      this.clearTimeoutFn(this.idleTimer);
      this.idleTimer = null;
    }
  }

  deferUntilOcrIdle() {
    this.notBeforeAt = this.now().getTime() + this.idleDelayMs;
    this.schedule(this.idleDelayMs);
  }

  schedule(delayMs = this.idleDelayMs) {
    if (this.idleTimer) {
      this.clearTimeoutFn(this.idleTimer);
    }
    this.idleTimer = this.setTimeoutFn(() => {
      this.idleTimer = null;
      this.run().catch(() => {});
    }, Math.max(0, delayMs));
    this.idleTimer?.unref?.();
  }

  async run() {
    if (!this.isDatabaseReady()) {
      return { processed: 0, failed: 0, skipped: 'database_unavailable' };
    }
    if (this.runPromise) return this.runPromise;
    if (!this.isOcrIdle()) return { processed: 0, failed: 0, skipped: 'ocr_active' };

    const remainingDelay = this.notBeforeAt - this.now().getTime();
    if (remainingDelay > 0) {
      this.schedule(remainingDelay);
      return { processed: 0, failed: 0, skipped: 'idle_delay' };
    }

    this.runPromise = this.reconcile()
      .catch((error) => {
        this.logger.error('OCR embedding reconciliation failed', {
          category: 'ocr_embedding',
          metadata: { message: error?.message || error },
        });
        throw error;
      })
      .finally(() => {
        this.runPromise = null;
      });
    return this.runPromise;
  }

  async loadCandidateJobs() {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.processingStaleMs);
    let query = this.ocrJobModel.find({
      status: { $in: ['completed', 'failed'] },
      files: {
        $elemMatch: {
          status: 'completed',
          $or: [
            { embeddingStatus: { $exists: false } },
            { embeddingStatus: 'pending' },
            {
              embeddingStatus: 'processing',
              $or: [
                { embeddingUpdatedAt: { $exists: false } },
                { embeddingUpdatedAt: { $lte: staleBefore } },
              ],
            },
            {
              embeddingStatus: 'failed',
              embeddingRetryable: { $ne: false },
              embeddingAttempts: { $lt: this.maxAttempts },
              $or: [
                { embeddingNextAttemptAt: { $exists: false } },
                { embeddingNextAttemptAt: null },
                { embeddingNextAttemptAt: { $lte: now } },
              ],
            },
          ],
        },
      },
    });
    if (typeof query.sort === 'function') query = query.sort({ completedAt: 1, createdAt: 1 });
    if (typeof query.limit === 'function') query = query.limit(this.jobBatchSize);
    if (typeof query.lean === 'function') query = query.lean();
    if (typeof query.exec === 'function') return query.exec();
    return query;
  }

  async reconcile() {
    const jobs = await this.loadCandidateJobs();
    let processed = 0;
    let failed = 0;

    for (const job of jobs || []) {
      for (const file of job.files || []) {
        if (!this.isOcrIdle()) {
          return { processed, failed, skipped: 'ocr_active' };
        }
        const now = this.now();
        if (!isEmbeddingDue(file, now, this)) continue;

        const result = await this.processFile(job, file, now);
        if (result === 'completed' || result === 'not_applicable') processed += 1;
        if (result === 'failed') failed += 1;
      }
    }

    if (processed > 0 || failed > 0) {
      this.logger.notice('OCR embedding reconciliation completed', {
        category: 'ocr_embedding',
        metadata: { processed, failed },
      });
    }
    return { processed, failed };
  }

  async claimFile(job, file, now) {
    const currentStatus = file.embeddingStatus || null;
    let statusCondition = currentStatus
      ? { embeddingStatus: currentStatus }
      : { embeddingStatus: { $exists: false } };
    if (currentStatus === 'processing') {
      const previousUpdatedAt = toDate(file.embeddingUpdatedAt);
      statusCondition = {
        ...statusCondition,
        embeddingUpdatedAt: previousUpdatedAt || { $exists: false },
      };
    }
    const result = await this.ocrJobModel.updateOne(
      {
        _id: String(job._id || job.id),
        files: {
          $elemMatch: {
            id: file.id,
            status: 'completed',
            ...statusCondition,
          },
        },
      },
      {
        $set: {
          'files.$.embeddingStatus': 'processing',
          'files.$.embeddingRetryable': true,
          'files.$.embeddingError': null,
          'files.$.embeddingUpdatedAt': now,
          'files.$.embeddingNextAttemptAt': null,
          updatedAt: now,
        },
        $inc: { 'files.$.embeddingAttempts': 1 },
      },
    );
    return Boolean(result?.modifiedCount || result?.nModified);
  }

  async updateFileState(jobId, fileId, state) {
    const now = this.now();
    return this.ocrJobModel.updateOne(
      {
        _id: String(jobId),
        files: {
          $elemMatch: {
            id: fileId,
            status: 'completed',
            embeddingStatus: 'processing',
          },
        },
      },
      {
        $set: {
          'files.$.embeddingStatus': state.status,
          'files.$.embeddingRetryable': state.retryable,
          'files.$.embeddingError': state.error || null,
          'files.$.embeddingUpdatedAt': now,
          'files.$.embeddingNextAttemptAt': state.nextAttemptAt || null,
          updatedAt: now,
        },
      },
    );
  }

  retryDelayForAttempt(attempt) {
    return Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.max(0, attempt - 1)));
  }

  async processFile(job, file, now = this.now()) {
    const metadata = buildOcrEmbeddingMetadata(job, file);
    const jobId = String(job._id || job.id || '');
    if (!metadata) {
      this.logger.warning('Skipped OCR embedding with missing source metadata', {
        category: 'ocr_embedding',
        metadata: { jobId: jobId || null, fileId: file?.id || null },
      });
      return 'failed';
    }

    if (!await this.claimFile(job, file, now)) return 'skipped';

    const attempt = (Number(file.embeddingAttempts) || 0) + 1;
    const text = String(file.result?.layoutText || '').trim();
    try {
      if (text) {
        await this.embeddingService.embed([text], {}, [metadata]);
      } else {
        await this.embeddingService.deleteEmbeddings(metadata);
      }

      const status = text ? 'completed' : 'not_applicable';
      await this.updateFileState(jobId, file.id, {
        status,
        retryable: false,
        error: null,
        nextAttemptAt: null,
      });
      return status;
    } catch (error) {
      const transient = isRetryableEmbeddingError(error);
      const retryable = transient && attempt < this.maxAttempts;
      const nextAttemptAt = retryable
        ? new Date(this.now().getTime() + this.retryDelayForAttempt(attempt))
        : null;
      await this.updateFileState(jobId, file.id, {
        status: 'failed',
        retryable,
        error: String(error?.message || error || 'Embedding failed').slice(0, 1000),
        nextAttemptAt,
      });
      this.logger.warning('Background OCR embedding attempt failed', {
        category: 'ocr_embedding',
        metadata: {
          jobId,
          fileId: file.id,
          attempt,
          retryable,
          nextAttemptAt,
          message: error?.message || error,
        },
      });
      return 'failed';
    }
  }
}

const ocrEmbeddingService = new OcrEmbeddingService();

module.exports = ocrEmbeddingService;
module.exports.OcrEmbeddingService = OcrEmbeddingService;
module.exports.buildOcrEmbeddingMetadata = buildOcrEmbeddingMetadata;
module.exports.isEmbeddingDue = isEmbeddingDue;
module.exports.isRetryableEmbeddingError = isRetryableEmbeddingError;
