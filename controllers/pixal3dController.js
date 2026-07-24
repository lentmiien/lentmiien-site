const fs = require('fs/promises');
const sharp = require('sharp');
const logger = require('../utils/logger');
const Pixal3dJob = require('../models/pixal3d_job');
const { containerIsRunning } = require('../services/pixal3dGatewayService');
const { gateway, jobService } = require('../services/pixal3dRuntime');
const {
  DEFAULT_PIXAL3D_PARAMETERS,
  SUPPORTED_PIXAL3D_IMAGE_FORMATS,
  buildPixal3dOwnerQuery,
  buildVisiblePixal3dJobsQuery,
  isPixal3dJobOwner,
  normalizePixal3dParameters,
  userIdentity,
} = require('../utils/pixal3d');

const PAGE_SIZE = 10;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_DECODED_PIXELS = 25000000;
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
    if (index > 0 && page - pages[index - 1] > 1) links.push({ ellipsis: true });
    links.push({ page, href: `/pixal3d?page=${page}`, current: page === currentPage });
  });
  return links;
}

function cameraLabel(parameters, metrics) {
  const actualFov = Number(metrics?.cameraFovDegrees);
  if (Number.isFinite(actualFov)) {
    const mode = parameters?.fovDegrees === 0 ? 'Auto' : 'Manual';
    const source = metrics?.cameraSource ? ` (${metrics.cameraSource})` : '';
    return `${mode}${source} · ${actualFov.toFixed(2)}°`;
  }
  if (parameters?.fovDegrees === 0) return 'Automatic FOV requested';
  return `${Number(parameters?.fovDegrees).toFixed(2)}° manual FOV`;
}

function buildJobView(job, user) {
  const isOwner = isPixal3dJobOwner(job, user);
  const parameters = job.parameters || DEFAULT_PIXAL3D_PARAMETERS;
  const metrics = job.metrics || {};
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
    parameters,
    metrics,
    cameraLabel: cameraLabel(parameters, metrics),
    gatewayJobId: job.gatewayJobId || '',
    createdAt: job.createdAt,
    createdAtIso: job.createdAt ? new Date(job.createdAt).toISOString() : '',
    createdAtLabel: formatDate(job.createdAt),
    completedAtLabel: formatDate(job.completedAt),
    inputSizeLabel: formatBytes(job.inputImage?.sizeBytes),
    outputSizeLabel: formatBytes(job.outputModel?.sizeBytes),
    durationLabel: formatSeconds(metrics?.totalSeconds),
    previewUrl: hasCompletedModel ? `/model-previewer/pixal3d/${encodedJobId}` : '',
    downloadUrl: hasCompletedModel ? `/pixal3d/jobs/${encodedJobId}/download` : '',
    legoSculptureUrl: hasCompletedModel
      ? `/lego-sculpture-converter?source=pixal3d&jobId=${encodedJobId}`
      : '',
  };
}

function jobAccessQuery(jobId, user) {
  return {
    $and: [
      { _id: String(jobId || '') },
      buildVisiblePixal3dJobsQuery(user),
    ],
  };
}

function jobOwnerQuery(jobId, user, extraConditions = []) {
  return {
    $and: [
      { _id: String(jobId || '') },
      buildPixal3dOwnerQuery(user),
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

  const formatInfo = SUPPORTED_PIXAL3D_IMAGE_FORMATS[metadata.format];
  if (!formatInfo) throw statusError('Use a PNG, JPEG, or WebP image.');
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const pages = Math.max(1, Number(metadata.pages) || 1);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw statusError('The uploaded image has invalid dimensions.');
  }
  if (width * height * pages > MAX_DECODED_PIXELS) {
    throw statusError('The uploaded image exceeds the 25 megapixel decoded-image limit.');
  }
  return { format: metadata.format, mimeType: formatInfo.mimeType, width, height };
}

async function renderIndex(req, res) {
  try {
    const visibleQuery = buildVisiblePixal3dJobsQuery(req.user);
    const totalJobs = await Pixal3dJob.countDocuments(visibleQuery).exec();
    const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
    const page = Math.min(parsePage(req.query.page), totalPages);
    const jobs = await Pixal3dJob.find(visibleQuery)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean()
      .exec();

    return res.render('pixal3d/index', {
      pageTitle: 'Image to 3D · Pixal3D',
      defaults: DEFAULT_PIXAL3D_PARAMETERS,
      jobs: jobs.map((job) => buildJobView(job, req.user)),
      pagination: {
        page,
        totalPages,
        totalJobs,
        previousUrl: page > 1 ? `/pixal3d?page=${page - 1}` : '',
        nextUrl: page < totalPages ? `/pixal3d?page=${page + 1}` : '',
        links: buildPageLinks(page, totalPages),
      },
      queuedNotice: req.query.queued === '1',
      maxImageMiB: 30,
    });
  } catch (error) {
    logger.error('Unable to render Pixal3D tool', {
      category: 'pixal3d',
      metadata: { user: req.user?.name || null, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to load the Pixal3D tool right now.' });
  }
}

async function createJob(req, res) {
  let storedInput = null;
  try {
    const parameters = normalizePixal3dParameters(req.body || {});
    const image = await inspectUploadedImage(req.file);
    storedInput = await jobService.storeInputImage(req.file.buffer, image.format);
    const identity = userIdentity(req.user);
    if (!identity.id || !identity.name) {
      throw statusError('Your signed-in account could not be identified.', 401);
    }

    const job = await Pixal3dJob.create({
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
    logger.notice('Pixal3D job queued', {
      category: 'pixal3d',
      metadata: {
        jobId: job._id,
        user: identity.name,
        inputBytes: req.file.buffer.length,
        resolution: parameters.resolution,
      },
    });

    if (wantsJson(req)) {
      return res.status(202).json({ ok: true, jobId: job._id, redirectUrl: '/pixal3d?queued=1' });
    }
    return res.redirect(303, '/pixal3d?queued=1');
  } catch (error) {
    if (storedInput?.fileName) {
      await jobService.removeInputImage(storedInput.fileName).catch((cleanupError) => {
        logger.warning('Unable to clean up rejected Pixal3D input', {
          category: 'pixal3d',
          metadata: { message: cleanupError.message },
        });
      });
    }
    const status = error.statusCode || 500;
    const message = status < 500 ? error.message : 'Unable to queue the Pixal3D job right now.';
    logger.warning('Pixal3D job submission failed', {
      category: 'pixal3d',
      metadata: { user: req.user?.name || null, status, message: error.message },
    });
    if (wantsJson(req)) return res.status(status).json({ ok: false, error: message });
    return res.status(status).render('error_page', { error: message });
  }
}

async function getJob(req, res) {
  try {
    const job = await Pixal3dJob.findOne(jobAccessQuery(req.params.jobId, req.user)).lean().exec();
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    return res.json({
      id: String(job._id),
      status: job.status,
      error: job.error || '',
      shared: job.shared === true,
      isOwner: isPixal3dJobOwner(job, req.user),
      updatedAt: job.updatedAt,
      downloadUrl: job.status === 'completed' && job.outputModel
        ? `/pixal3d/jobs/${encodeURIComponent(job._id)}/download`
        : '',
      previewUrl: job.status === 'completed' && job.outputModel
        ? `/model-previewer/pixal3d/${encodeURIComponent(job._id)}`
        : '',
    });
  } catch (error) {
    logger.warning('Unable to read Pixal3D job', {
      category: 'pixal3d',
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
    const job = await Pixal3dJob.findOneAndUpdate(
      jobOwnerQuery(req.params.jobId, req.user),
      { $set: { shared: req.body.shared } },
      { new: true },
    ).lean().exec();
    if (!job) return res.status(404).json({ error: 'Job not found or not owned by you.' });
    return res.json({ ok: true, shared: job.shared === true });
  } catch (error) {
    logger.warning('Unable to update Pixal3D sharing', {
      category: 'pixal3d',
      metadata: { jobId: req.params.jobId, user: req.user?.name || null, message: error.message },
    });
    return res.status(500).json({ error: 'Unable to update sharing right now.' });
  }
}

async function deleteJob(req, res) {
  const jobId = String(req.params.jobId || '');
  try {
    const job = await Pixal3dJob.findOne(jobOwnerQuery(jobId, req.user)).lean().exec();
    if (!job) return res.status(404).json({ error: 'Job not found or not owned by you.' });
    if (!['completed', 'failed'].includes(job.status)) {
      return res.status(409).json({ error: 'Wait for the job to finish before deleting it.' });
    }

    await jobService.removeJobFiles(job);
    const deletion = await Pixal3dJob.deleteOne(jobOwnerQuery(jobId, req.user, [
      { status: { $in: ['completed', 'failed'] } },
    ])).exec();
    if (deletion.deletedCount !== 1) {
      return res.status(409).json({ error: 'The job changed while it was being deleted. Refresh and try again.' });
    }

    logger.notice('Pixal3D job deleted', {
      category: 'pixal3d',
      metadata: { jobId, user: req.user?.name || null, removedModel: Boolean(job.outputModel?.fileName) },
    });
    return res.json({ ok: true, jobId });
  } catch (error) {
    logger.error('Unable to delete Pixal3D job', {
      category: 'pixal3d',
      metadata: { jobId, user: req.user?.name || null, message: error.message },
    });
    return res.status(500).json({ error: 'Unable to delete the job and its files right now.' });
  }
}

async function downloadModel(req, res, next) {
  try {
    const job = await Pixal3dJob.findOne(jobAccessQuery(req.params.jobId, req.user)).lean().exec();
    if (!job || job.status !== 'completed' || !job.outputModel?.fileName) {
      return res.status(404).render('error_page', { error: 'Completed 3D model not found.' });
    }
    const filePath = jobService.outputPath(job.outputModel.fileName);
    await fs.access(filePath);
    return res.download(filePath, `pixal3d-${job._id}.glb`, (error) => {
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
  } catch {
    return res.status(502).json({ error: 'Unable to check the Pixal3D service.' });
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
  if (wantsJson(req)) return res.status(400).json({ ok: false, error: message });
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
