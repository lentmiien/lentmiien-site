const fs = require('fs/promises');
const sharp = require('sharp');
const logger = require('../utils/logger');
const Trellis2Job = require('../models/trellis2_job');
const Trellis2GatewayService = require('../services/trellis2GatewayService');
const Trellis2JobService = require('../services/trellis2JobService');
const {
  containerIsRunning,
} = require('../services/trellis2GatewayService');
const {
  DEFAULT_TRELLIS2_PARAMETERS,
  SUPPORTED_TRELLIS2_IMAGE_FORMATS,
  buildTrellis2OwnerQuery,
  buildVisibleTrellis2JobsQuery,
  isTrellis2JobOwner,
  normalizeTrellis2Parameters,
  userIdentity,
} = require('../utils/trellis2');

const PAGE_SIZE = 10;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_DECODED_PIXELS = 25000000;
const gateway = new Trellis2GatewayService();
const jobService = new Trellis2JobService({ gateway });
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function wantsJson(req) {
  return req.xhr || String(req.get('accept') || '').includes('application/json');
}

function statusError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parsePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return '';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatSeconds(value) {
  if (value === null || value === undefined || value === '') return '';
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds.toFixed(1)} sec`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${(seconds % 60).toFixed(0)} sec`;
}

function buildPageLinks(currentPage, totalPages) {
  const candidates = new Set([1, totalPages, currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]);
  const pages = [...candidates]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const links = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) {
      links.push({ ellipsis: true });
    }
    links.push({ page, href: `/trellis2?page=${page}`, current: page === currentPage });
  });
  return links;
}

function buildJobView(job, user) {
  const isOwner = isTrellis2JobOwner(job, user);
  const hasCompletedModel = job.status === 'completed' && job.outputModel;
  const encodedJobId = encodeURIComponent(job._id);
  return {
    id: String(job._id),
    status: job.status,
    statusLabel: job.status === 'processing' ? 'Generating' : `${job.status.charAt(0).toUpperCase()}${job.status.slice(1)}`,
    error: job.error || '',
    shared: job.shared === true,
    isOwner,
    ownerLabel: isOwner ? 'You' : (job.owner?.name || 'Another user'),
    inputImage: job.inputImage || {},
    outputModel: job.outputModel || null,
    parameters: job.parameters || DEFAULT_TRELLIS2_PARAMETERS,
    metrics: job.metrics || {},
    gatewayJobId: job.gatewayJobId || '',
    createdAt: job.createdAt,
    createdAtIso: job.createdAt ? new Date(job.createdAt).toISOString() : '',
    createdAtLabel: formatDate(job.createdAt),
    completedAtLabel: formatDate(job.completedAt),
    inputSizeLabel: formatBytes(job.inputImage?.sizeBytes),
    outputSizeLabel: formatBytes(job.outputModel?.sizeBytes),
    durationLabel: formatSeconds(job.metrics?.totalSeconds),
    previewUrl: hasCompletedModel ? `/model-previewer/trellis2/${encodedJobId}` : '',
    downloadUrl: hasCompletedModel ? `/trellis2/jobs/${encodedJobId}/download` : '',
    legoSculptureUrl: hasCompletedModel
      ? `/lego-sculpture-converter?source=trellis2&jobId=${encodedJobId}`
      : '',
  };
}

function jobAccessQuery(jobId, user) {
  return {
    $and: [
      { _id: String(jobId || '') },
      buildVisibleTrellis2JobsQuery(user),
    ],
  };
}

function jobOwnerQuery(jobId, user, extraConditions = []) {
  return {
    $and: [
      { _id: String(jobId || '') },
      buildTrellis2OwnerQuery(user),
      ...extraConditions,
    ],
  };
}

function sanitizeOriginalName(value) {
  const baseName = String(value || 'image')
    .replace(/\0/g, '')
    .split(/[\\/]/)
    .pop();
  return (baseName || 'image').slice(0, 255);
}

async function inspectUploadedImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw statusError('Choose an image to generate a 3D model.');
  }
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw statusError('The image is too large. The maximum size is 30 MiB.');
  }

  let metadata;
  try {
    metadata = await sharp(file.buffer, {
      animated: true,
      limitInputPixels: MAX_DECODED_PIXELS,
    }).metadata();
  } catch {
    throw statusError('The uploaded file is not a readable image or exceeds the 25 megapixel limit.');
  }

  const formatInfo = SUPPORTED_TRELLIS2_IMAGE_FORMATS[metadata.format];
  if (!formatInfo) {
    throw statusError('Use a PNG, JPEG, or WebP image.');
  }
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const pages = Math.max(1, Number(metadata.pages) || 1);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw statusError('The uploaded image has invalid dimensions.');
  }
  if (width * height * pages > MAX_DECODED_PIXELS) {
    throw statusError('The uploaded image exceeds the 25 megapixel decoded-image limit.');
  }

  return {
    format: metadata.format,
    mimeType: formatInfo.mimeType,
    width,
    height,
  };
}

async function renderIndex(req, res) {
  try {
    const visibleQuery = buildVisibleTrellis2JobsQuery(req.user);
    const totalJobs = await Trellis2Job.countDocuments(visibleQuery).exec();
    const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
    const page = Math.min(parsePage(req.query.page), totalPages);
    const jobs = await Trellis2Job.find(visibleQuery)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean()
      .exec();

    return res.render('trellis2/index', {
      pageTitle: 'Image to 3D · TRELLIS.2',
      defaults: DEFAULT_TRELLIS2_PARAMETERS,
      jobs: jobs.map((job) => buildJobView(job, req.user)),
      pagination: {
        page,
        totalPages,
        totalJobs,
        previousUrl: page > 1 ? `/trellis2?page=${page - 1}` : '',
        nextUrl: page < totalPages ? `/trellis2?page=${page + 1}` : '',
        links: buildPageLinks(page, totalPages),
      },
      queuedNotice: req.query.queued === '1',
      maxImageMiB: 30,
    });
  } catch (error) {
    logger.error('Unable to render TRELLIS.2 tool', {
      category: 'trellis2',
      metadata: { user: req.user?.name || null, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to load the image-to-3D tool right now.' });
  }
}

async function createJob(req, res) {
  let storedInput = null;
  try {
    const parameters = normalizeTrellis2Parameters(req.body || {});
    const image = await inspectUploadedImage(req.file);
    storedInput = await jobService.storeInputImage(req.file.buffer, image.format);
    const identity = userIdentity(req.user);
    if (!identity.id || !identity.name) {
      throw statusError('Your signed-in account could not be identified.', 401);
    }

    const job = await Trellis2Job.create({
      owner: identity,
      shared: false,
      status: 'queued',
      inputImage: {
        ...storedInput,
        originalName: sanitizeOriginalName(req.file.originalname),
        format: image.format,
        sizeBytes: req.file.buffer.length,
        width: image.width,
        height: image.height,
      },
      parameters,
    });

    jobService.enqueue(job._id);
    logger.notice('TRELLIS.2 job queued', {
      category: 'trellis2',
      metadata: {
        jobId: job._id,
        user: identity.name,
        inputBytes: req.file.buffer.length,
        resolution: parameters.resolution,
      },
    });

    if (wantsJson(req)) {
      return res.status(202).json({
        ok: true,
        jobId: job._id,
        redirectUrl: '/trellis2?queued=1',
      });
    }
    return res.redirect(303, '/trellis2?queued=1');
  } catch (error) {
    if (storedInput?.fileName) {
      await jobService.removeInputImage(storedInput.fileName).catch((cleanupError) => {
        logger.warning('Unable to clean up rejected TRELLIS.2 input', {
          category: 'trellis2',
          metadata: { message: cleanupError.message },
        });
      });
    }
    const status = error.statusCode || 500;
    const message = status < 500 ? error.message : 'Unable to queue the TRELLIS.2 job right now.';
    logger.warning('TRELLIS.2 job submission failed', {
      category: 'trellis2',
      metadata: { user: req.user?.name || null, status, message: error.message },
    });
    if (wantsJson(req)) {
      return res.status(status).json({ ok: false, error: message });
    }
    return res.status(status).render('error_page', { error: message });
  }
}

async function getJob(req, res) {
  try {
    const job = await Trellis2Job.findOne(jobAccessQuery(req.params.jobId, req.user)).lean().exec();
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({
      id: String(job._id),
      status: job.status,
      error: job.error || '',
      shared: job.shared === true,
      isOwner: isTrellis2JobOwner(job, req.user),
      updatedAt: job.updatedAt,
      downloadUrl: job.status === 'completed' && job.outputModel
        ? `/trellis2/jobs/${encodeURIComponent(job._id)}/download`
        : '',
      previewUrl: job.status === 'completed' && job.outputModel
        ? `/model-previewer/trellis2/${encodeURIComponent(job._id)}`
        : '',
    });
  } catch (error) {
    logger.warning('Unable to read TRELLIS.2 job', {
      category: 'trellis2',
      metadata: { jobId: req.params.jobId, message: error.message },
    });
    return res.status(500).json({ error: 'Unable to load the job.' });
  }
}

async function toggleShare(req, res) {
  if (typeof req.body?.shared !== 'boolean') {
    return res.status(400).json({ error: 'shared must be true or false.' });
  }
  try {
    const job = await Trellis2Job.findOneAndUpdate(
      jobOwnerQuery(req.params.jobId, req.user),
      { $set: { shared: req.body.shared } },
      { new: true },
    ).lean().exec();
    if (!job) return res.status(404).json({ error: 'Job not found or not owned by you.' });
    return res.json({ ok: true, shared: job.shared === true });
  } catch (error) {
    logger.warning('Unable to update TRELLIS.2 sharing', {
      category: 'trellis2',
      metadata: { jobId: req.params.jobId, user: req.user?.name || null, message: error.message },
    });
    return res.status(500).json({ error: 'Unable to update sharing right now.' });
  }
}

async function deleteJob(req, res) {
  const jobId = String(req.params.jobId || '');
  const ownerQuery = jobOwnerQuery(jobId, req.user);
  try {
    const job = await Trellis2Job.findOne(ownerQuery).lean().exec();
    if (!job) {
      return res.status(404).json({ error: 'Job not found or not owned by you.' });
    }
    if (!['completed', 'failed'].includes(job.status)) {
      return res.status(409).json({ error: 'Wait for the job to finish before deleting it.' });
    }

    await jobService.removeJobFiles(job);
    const deletion = await Trellis2Job.deleteOne(jobOwnerQuery(jobId, req.user, [
      { status: { $in: ['completed', 'failed'] } },
    ])).exec();
    if (deletion.deletedCount !== 1) {
      return res.status(409).json({ error: 'The job changed while it was being deleted. Refresh and try again.' });
    }

    logger.notice('TRELLIS.2 job deleted', {
      category: 'trellis2',
      metadata: {
        jobId,
        user: req.user?.name || null,
        removedModel: Boolean(job.outputModel?.fileName),
      },
    });
    return res.json({ ok: true, jobId });
  } catch (error) {
    logger.error('Unable to delete TRELLIS.2 job', {
      category: 'trellis2',
      metadata: { jobId, user: req.user?.name || null, message: error.message },
    });
    return res.status(500).json({ error: 'Unable to delete the job and its files right now.' });
  }
}

async function downloadModel(req, res, next) {
  try {
    const job = await Trellis2Job.findOne(jobAccessQuery(req.params.jobId, req.user)).lean().exec();
    if (!job || job.status !== 'completed' || !job.outputModel?.fileName) {
      return res.status(404).render('error_page', { error: 'Completed 3D model not found.' });
    }
    const filePath = jobService.outputPath(job.outputModel.fileName);
    await fs.access(filePath);
    return res.download(filePath, `trellis2-${job._id}.glb`, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).render('error_page', { error: 'The 3D model file is missing.' });
    }
    return next(error);
  }
}

async function serviceState(_req, res) {
  try {
    const container = await gateway.getContainerState();
    const running = containerIsRunning(container);
    let health = container?.health?.json || null;
    let healthError = '';
    if (running && !health) {
      try {
        health = await gateway.getHealth();
      } catch (error) {
        healthError = error.message || 'Health check failed.';
      }
    }
    return res.json({
      running,
      containerState: container?.state || container?.status || (running ? 'running' : 'stopped'),
      modelState: health?.model_state || 'unknown',
      busy: health?.busy === true,
      healthOk: health?.status === 'ok' || container?.health?.ok === true,
      healthError,
      autoStart: true,
    });
  } catch (error) {
    return res.status(502).json({ error: 'Unable to check the TRELLIS.2 service.' });
  }
}

function handleUploadError(req, res, error) {
  let message = 'Unable to upload that image.';
  if (error?.code === 'LIMIT_FILE_SIZE') {
    message = 'The image is too large. The maximum size is 30 MiB.';
  } else if (error?.code === 'LIMIT_UNEXPECTED_FILE') {
    message = 'Upload one image using the image field.';
  } else if (error?.code === 'LIMIT_FIELD_COUNT') {
    message = 'Too many form fields were submitted.';
  }
  if (wantsJson(req)) {
    return res.status(400).json({ ok: false, error: message });
  }
  return res.status(400).render('error_page', { error: message });
}

module.exports = {
  MAX_IMAGE_BYTES,
  createJob,
  deleteJob,
  downloadModel,
  getJob,
  handleUploadError,
  inspectUploadedImage,
  renderIndex,
  serviceState,
  toggleShare,
};
