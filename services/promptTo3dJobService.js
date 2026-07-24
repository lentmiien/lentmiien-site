const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const logger = require('../utils/logger');
const PromptTo3dJob = require('../models/prompt_to_3d_job');
const Pixal3dJob = require('../models/pixal3d_job');
const {
  DEFAULT_FORM_VALUES,
  createImageGeneration,
  normalizeGenerationForm,
} = require('./gptImageService');
const { jobService: sharedPixal3dJobService } = require('./pixal3dRuntime');
const {
  DEFAULT_PIXAL3D_PARAMETERS,
  SUPPORTED_PIXAL3D_IMAGE_FORMATS,
  normalizePixal3dParameters,
  userIdentity,
} = require('../utils/pixal3d');

const ACTIVE_STATUSES = Object.freeze(['queued', 'generating_image', 'generating_model']);
const TERMINAL_STATUSES = Object.freeze(['completed', 'failed']);
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_DECODED_PIXELS = 25000000;
const MONITOR_INTERVAL_MS = 3000;

function statusError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function plainObject(value) {
  return value && typeof value.toObject === 'function' ? value.toObject() : value;
}

function activeKeyForUser(user) {
  const identity = userIdentity(user);
  if (!identity.id || !identity.name) {
    throw statusError('Your signed-in account could not be identified.', 401);
  }
  return {
    activeKey: `user:${identity.id}`,
    identity,
  };
}

function normalizeSubmission(raw = {}, user = {}) {
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  const imageValidation = normalizeGenerationForm({
    ...raw,
    prompt,
    n: 1,
  });
  if (!imageValidation.ok) {
    throw statusError(imageValidation.message, 400);
  }

  const pixal3dParameters = normalizePixal3dParameters(raw);
  const { activeKey, identity } = activeKeyForUser(user);
  return {
    activeKey,
    identity,
    prompt: imageValidation.requestOptions.prompt,
    imageOptions: {
      ...imageValidation.formValues,
      prompt: imageValidation.requestOptions.prompt,
      n: 1,
    },
    pixal3dParameters,
  };
}

function assertGeneratedImageFileName(fileName) {
  const normalized = String(fileName || '');
  if (
    !normalized
    || path.basename(normalized) !== normalized
    || !/\.(?:png|jpe?g|webp)$/i.test(normalized)
  ) {
    throw new Error('The generated GPT Image file name is invalid.');
  }
  return normalized;
}

async function inspectGeneratedImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('The generated GPT Image file is empty.');
  }

  const metadata = await sharp(buffer, {
    animated: true,
    limitInputPixels: MAX_DECODED_PIXELS,
  }).metadata();
  const formatInfo = SUPPORTED_PIXAL3D_IMAGE_FORMATS[metadata.format];
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const pages = Math.max(1, Number(metadata.pages) || 1);
  if (
    !formatInfo
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width * height * pages > MAX_DECODED_PIXELS
  ) {
    throw new Error('The generated GPT Image is not a supported Pixal3D input.');
  }

  return {
    format: metadata.format,
    mimeType: formatInfo.mimeType,
    width,
    height,
  };
}

function generatedInputName(prompt, format) {
  const formatInfo = SUPPORTED_PIXAL3D_IMAGE_FORMATS[format];
  const stem = String(prompt || '')
    .replace(/\0/g, '')
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Prompt to 3D';
  return `${stem}${formatInfo?.extension || '.png'}`;
}

function safeWorkflowError(error) {
  const message = error?.statusCode && error.statusCode < 500
    ? error.message
    : error?.message || 'Prompt-to-3D generation failed.';
  return String(message).slice(0, 1000);
}

function serializeJob(job) {
  if (!job) return null;
  const normalized = plainObject(job);
  const jobId = String(normalized._id || '');
  const pixal3dJobId = normalized.pixal3dJobId ? String(normalized.pixal3dJobId) : '';
  const generationId = normalized.gptImageGenerationId || '';
  return {
    id: jobId,
    status: normalized.status,
    prompt: normalized.prompt || '',
    error: normalized.error || '',
    imageUrl: normalized.imageUrl || '',
    imageGalleryUrl: generationId
      ? `/gpt-image?highlight=${encodeURIComponent(generationId)}`
      : '',
    pixal3dUrl: pixal3dJobId
      ? `/pixal3d?wrapperJob=${encodeURIComponent(pixal3dJobId)}`
      : '',
    previewUrl: normalized.status === 'completed' && pixal3dJobId
      ? `/model-previewer/pixal3d/${encodeURIComponent(pixal3dJobId)}`
      : '',
    createdAt: normalized.createdAt || null,
    updatedAt: normalized.updatedAt || null,
  };
}

class PromptTo3dJobService {
  constructor({
    JobModel = PromptTo3dJob,
    Pixal3dJobModel = Pixal3dJob,
    imageGenerator = createImageGeneration,
    pixal3dJobService = sharedPixal3dJobService,
    publicRoot = path.join(__dirname, '..', 'public'),
    monitorIntervalMs = MONITOR_INTERVAL_MS,
  } = {}) {
    this.JobModel = JobModel;
    this.Pixal3dJobModel = Pixal3dJobModel;
    this.imageGenerator = imageGenerator;
    this.pixal3dJobService = pixal3dJobService;
    this.imageDirectory = path.join(publicRoot, 'img');
    this.monitorIntervalMs = monitorIntervalMs;
    this.queue = [];
    this.queuedJobIds = new Set();
    this.monitors = new Map();
    this.draining = false;
  }

  async createJob({ raw = {}, user = {} } = {}) {
    const submission = normalizeSubmission(raw, user);
    const existing = await this.getActiveJob(user);
    if (existing && ACTIVE_STATUSES.includes(existing.status)) {
      const error = statusError('Wait for your current Prompt to 3D job to finish before starting another.', 409);
      error.job = existing;
      throw error;
    }

    let job;
    try {
      job = await this.JobModel.create({
        owner: submission.identity,
        activeKey: submission.activeKey,
        status: 'queued',
        prompt: submission.prompt,
        imageOptions: submission.imageOptions,
        pixal3dParameters: submission.pixal3dParameters,
      });
    } catch (error) {
      if (error?.code === 11000) {
        const conflict = statusError(
          'Wait for your current Prompt to 3D job to finish before starting another.',
          409,
        );
        conflict.job = await this.getActiveJob(user);
        throw conflict;
      }
      throw error;
    }

    this.enqueue(job._id);
    return plainObject(job);
  }

  enqueue(jobId) {
    const normalizedId = String(jobId || '');
    if (!normalizedId || this.queuedJobIds.has(normalizedId)) return;
    this.queuedJobIds.add(normalizedId);
    this.queue.push(normalizedId);
    void this.drainQueue();
  }

  async drainQueue() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const jobId = this.queue.shift();
        try {
          await this.processJob(jobId);
        } catch (error) {
          logger.error('Unexpected Prompt to 3D queue error', {
            category: 'prompt_to_3d',
            metadata: { jobId, message: error.message },
          });
        } finally {
          this.queuedJobIds.delete(jobId);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length) void this.drainQueue();
    }
  }

  async processJob(jobId) {
    const job = await this.JobModel.findOneAndUpdate(
      { _id: String(jobId), status: 'queued' },
      {
        $set: {
          status: 'generating_image',
          startedAt: new Date(),
          error: null,
        },
      },
      { new: true },
    ).lean().exec();
    if (!job) return;

    let storedInput = null;
    let pixal3dJob = null;
    let pixal3dQueued = false;
    try {
      const imageResult = await this.imageGenerator({
        rawOptions: {
          ...plainObject(job.imageOptions),
          prompt: job.prompt,
          n: 1,
        },
        uploadedFiles: [],
        selectedImageIds: [],
        user: {
          _id: job.owner.id,
          name: job.owner.name,
        },
        createdBy: job.owner.name,
        openaiUser: job.owner.id,
      });
      const image = imageResult.images?.[0];
      if (!image?.outputFileName) {
        throw new Error('GPT Image did not return a saved image for Pixal3D.');
      }

      const imageFileName = assertGeneratedImageFileName(image.outputFileName);
      const imageBuffer = await fs.readFile(path.join(this.imageDirectory, imageFileName));
      const metadata = await inspectGeneratedImage(imageBuffer);
      storedInput = await this.pixal3dJobService.storeInputImage(imageBuffer, metadata.format);

      pixal3dJob = await this.Pixal3dJobModel.create({
        owner: plainObject(job.owner),
        shared: false,
        status: 'queued',
        inputImage: {
          ...storedInput,
          originalName: generatedInputName(job.prompt, metadata.format),
          format: metadata.format,
          sizeBytes: imageBuffer.length,
          width: metadata.width,
          height: metadata.height,
        },
        parameters: plainObject(job.pixal3dParameters),
      });

      await this.JobModel.updateOne({ _id: job._id }, {
        $set: {
          status: 'generating_model',
          gptImageGenerationId: imageResult.generationId,
          gptImageId: image.id || null,
          imageUrl: image.outputUrl || null,
          pixal3dJobId: String(pixal3dJob._id),
          error: null,
        },
      }).exec();

      this.pixal3dJobService.enqueue(pixal3dJob._id);
      pixal3dQueued = true;
      this.startMonitor(job._id, pixal3dJob._id);
      logger.notice('Prompt to 3D image saved and Pixal3D job queued', {
        category: 'prompt_to_3d',
        metadata: {
          jobId: job._id,
          generationId: imageResult.generationId,
          pixal3dJobId: pixal3dJob._id,
          user: job.owner.name,
        },
      });
    } catch (error) {
      if (pixal3dJob && !pixal3dQueued) {
        this.pixal3dJobService.enqueue(pixal3dJob._id);
      }
      if (storedInput?.fileName && !pixal3dJob) {
        await this.pixal3dJobService.removeInputImage(storedInput.fileName).catch((cleanupError) => {
          logger.warning('Unable to remove rejected Prompt to 3D Pixal3D input', {
            category: 'prompt_to_3d',
            metadata: { jobId, message: cleanupError.message },
          });
        });
      }
      await this.markTerminal(job._id, 'failed', safeWorkflowError(error));
      logger.warning('Prompt to 3D job failed', {
        category: 'prompt_to_3d',
        metadata: {
          jobId: job._id,
          user: job.owner?.name || null,
          message: error.message,
        },
      });
    }
  }

  async markTerminal(jobId, status, error = null) {
    const completedAt = new Date();
    const updated = await this.JobModel.findOneAndUpdate(
      { _id: String(jobId), status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status,
          error: error || null,
          completedAt,
          expiresAt: new Date(completedAt.getTime() + TERMINAL_RETENTION_MS),
        },
        $unset: { activeKey: 1 },
      },
      { new: true },
    ).lean().exec();
    if (updated) return updated;
    return this.JobModel.findOne({ _id: String(jobId) }).lean().exec();
  }

  async syncJob(job) {
    const normalized = plainObject(job);
    if (!normalized || normalized.status !== 'generating_model' || !normalized.pixal3dJobId) {
      return normalized;
    }

    const pixal3dJob = await this.Pixal3dJobModel.findOne({
      _id: String(normalized.pixal3dJobId),
      'owner.id': normalized.owner.id,
    }).lean().exec();
    if (!pixal3dJob || !TERMINAL_STATUSES.includes(pixal3dJob.status)) {
      return normalized;
    }

    if (pixal3dJob.status === 'completed' && pixal3dJob.outputModel?.fileName) {
      return this.markTerminal(normalized._id, 'completed');
    }
    const message = pixal3dJob.error
      ? `Pixal3D generation failed: ${pixal3dJob.error}`
      : 'Pixal3D generation failed.';
    return this.markTerminal(normalized._id, 'failed', message);
  }

  startMonitor(jobId, pixal3dJobId) {
    const normalizedJobId = String(jobId || '');
    if (!normalizedJobId || this.monitors.has(normalizedJobId)) return;

    const poll = async () => {
      try {
        const job = await this.JobModel.findOne({
          _id: normalizedJobId,
          pixal3dJobId: String(pixal3dJobId),
        }).lean().exec();
        if (!job || job.status !== 'generating_model') {
          this.stopMonitor(normalizedJobId);
          return;
        }
        const synced = await this.syncJob(job);
        if (!synced || TERMINAL_STATUSES.includes(synced.status)) {
          this.stopMonitor(normalizedJobId);
          return;
        }
      } catch (error) {
        logger.warning('Unable to monitor Prompt to 3D model job', {
          category: 'prompt_to_3d',
          metadata: { jobId: normalizedJobId, message: error.message },
        });
      }

      const timer = setTimeout(poll, this.monitorIntervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.monitors.set(normalizedJobId, timer);
    };

    this.monitors.set(normalizedJobId, null);
    void poll();
  }

  stopMonitor(jobId) {
    const normalizedJobId = String(jobId || '');
    const timer = this.monitors.get(normalizedJobId);
    if (timer) clearTimeout(timer);
    this.monitors.delete(normalizedJobId);
  }

  async getActiveJob(user) {
    const { activeKey } = activeKeyForUser(user);
    const job = await this.JobModel.findOne({ activeKey }).sort({ createdAt: -1 }).lean().exec();
    if (!job) return null;
    const synced = await this.syncJob(job);
    if (synced?.status === 'generating_model' && synced.pixal3dJobId) {
      this.startMonitor(synced._id, synced.pixal3dJobId);
    }
    return synced;
  }

  async getOwnedJob(jobId, user) {
    const { identity } = activeKeyForUser(user);
    const job = await this.JobModel.findOne({
      _id: String(jobId || ''),
      'owner.id': identity.id,
    }).lean().exec();
    if (!job) return null;
    const synced = await this.syncJob(job);
    if (synced?.status === 'generating_model' && synced.pixal3dJobId) {
      this.startMonitor(synced._id, synced.pixal3dJobId);
    }
    return synced;
  }
}

const promptTo3dJobService = new PromptTo3dJobService();

module.exports = {
  ACTIVE_STATUSES,
  DEFAULT_FORM_VALUES,
  DEFAULT_PIXAL3D_PARAMETERS,
  MONITOR_INTERVAL_MS,
  PromptTo3dJobService,
  activeKeyForUser,
  inspectGeneratedImage,
  normalizeSubmission,
  promptTo3dJobService,
  serializeJob,
};
