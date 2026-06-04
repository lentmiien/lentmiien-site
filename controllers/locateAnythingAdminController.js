const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const logger = require('../utils/logger');
const LocateAnythingJob = require('../models/locateanything_job');
const LocateAnythingGatewayService = require('../services/locateAnythingGatewayService');
const {
  DEFAULT_LOCATEANYTHING_OPTIONS,
  LOCATEANYTHING_TASKS,
  LOCATEANYTHING_OUTPUT_TYPES,
  LOCATEANYTHING_GENERATION_MODES,
  SERVICE_PATH,
  buildGatewayErrorMessage,
  getErrorPayload,
} = require('../services/locateAnythingGatewayService');

const locateAnythingGateway = new LocateAnythingGatewayService();
const APP_ROOT = path.resolve(__dirname, '..');
const JOB_HISTORY_LIMIT = 20;
const QUERY_TASKS = new Set(['ground', 'ground_single', 'ground_text', 'ground_gui', 'point']);
const AXIS_SWAPPED_ORIENTATIONS = new Set([5, 6, 7, 8]);

const TASK_OPTIONS = Object.freeze([
  { value: 'ground_gui', label: 'ground_gui - UI target or region' },
  { value: 'point', label: 'point - click target' },
  { value: 'ground_single', label: 'ground_single - best single match' },
  { value: 'ground', label: 'ground - all matching instances' },
  { value: 'detect', label: 'detect - categories' },
  { value: 'ground_text', label: 'ground_text - visible phrase region' },
  { value: 'detect_text', label: 'detect_text - all visible text regions' },
]);

const OUTPUT_TYPE_OPTIONS = Object.freeze([
  { value: 'point', label: 'point' },
  { value: 'box', label: 'box' },
]);

const GENERATION_MODE_OPTIONS = Object.freeze([
  { value: 'hybrid', label: 'hybrid' },
  { value: 'fast', label: 'fast' },
  { value: 'slow', label: 'slow' },
]);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(value, fallback, { min = null, max = null } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (min !== null && parsed < min) {
    return min;
  }
  if (max !== null && parsed > max) {
    return max;
  }
  return parsed;
}

function parseNumber(value, fallback, { min = null, max = null } = {}) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (min !== null && parsed < min) {
    return min;
  }
  if (max !== null && parsed > max) {
    return max;
  }
  return parsed;
}

function splitCategories(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const categories = rawValues
    .flatMap((entry) => String(entry || '').split(/[\n,]/g))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(categories));
}

function defaultForm() {
  const defaults = DEFAULT_LOCATEANYTHING_OPTIONS;
  return {
    task: defaults.task,
    query: defaults.query,
    categoriesText: '',
    outputType: defaults.outputType,
    generationMode: defaults.generationMode,
    maxImageEdge: defaults.maxImageEdge,
    maxNewTokens: defaults.maxNewTokens,
    doSample: defaults.doSample,
    temperature: defaults.temperature,
    topP: defaults.topP,
    repetitionPenalty: defaults.repetitionPenalty,
  };
}

function normalizeForm(body = {}) {
  const defaults = DEFAULT_LOCATEANYTHING_OPTIONS;
  const task = LOCATEANYTHING_TASKS.includes(body.task) ? body.task : defaults.task;
  const categories = splitCategories(body.categories);
  const outputType = LOCATEANYTHING_OUTPUT_TYPES.includes(body.output_type || body.outputType)
    ? body.output_type || body.outputType
    : defaults.outputType;
  const generationMode = LOCATEANYTHING_GENERATION_MODES.includes(body.generation_mode || body.generationMode)
    ? body.generation_mode || body.generationMode
    : defaults.generationMode;

  return {
    task,
    query: typeof body.query === 'string' ? body.query.trim() : '',
    categories,
    categoriesText: categories.join(', '),
    outputType,
    generationMode,
    maxImageEdge: parseInteger(body.max_image_edge ?? body.maxImageEdge, defaults.maxImageEdge, { min: 0, max: 10000 }),
    maxNewTokens: parseInteger(body.max_new_tokens ?? body.maxNewTokens, defaults.maxNewTokens, { min: 1, max: 8192 }),
    doSample: parseBoolean(body.do_sample ?? body.doSample, defaults.doSample),
    temperature: parseNumber(body.temperature, defaults.temperature, { min: 0, max: 5 }),
    topP: parseNumber(body.top_p ?? body.topP, defaults.topP, { min: 0, max: 1 }),
    repetitionPenalty: parseNumber(body.repetition_penalty ?? body.repetitionPenalty, defaults.repetitionPenalty, { min: 0.1, max: 5 }),
  };
}

function buildRequestOptions(form) {
  return {
    task: form.task,
    query: form.query,
    categories: form.categories,
    outputType: form.outputType,
    generationMode: form.generationMode,
    maxImageEdge: form.maxImageEdge,
    maxNewTokens: form.maxNewTokens,
    doSample: form.doSample,
    temperature: form.temperature,
    topP: form.topP,
    repetitionPenalty: form.repetitionPenalty,
  };
}

function validateRequest(form, files, uploadError) {
  if (uploadError) {
    return uploadError;
  }
  if (!files || files.length === 0) {
    return 'Upload at least one image for the LocateAnything job.';
  }
  if (QUERY_TASKS.has(form.task) && !form.query) {
    return `${form.task} requires a query.`;
  }
  if (form.task === 'detect' && (!form.categories || form.categories.length === 0)) {
    return 'detect requires at least one category.';
  }
  return null;
}

function publicUrlForUpload(file) {
  return `/img/locateanything/${encodeURIComponent(file.filename)}`;
}

function storedPathForUpload(file) {
  return path.relative(APP_ROOT, file.path).split(path.sep).join('/');
}

function buildFileRecord(file) {
  return {
    originalName: file.originalname || null,
    storedFileName: file.filename,
    storedPath: storedPathForUpload(file),
    publicUrl: publicUrlForUpload(file),
    mimeType: file.mimetype || null,
    sizeBytes: Number.isFinite(file.size) ? file.size : 0,
    status: 'queued',
  };
}

function normalizeExifOrientation(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 1;
}

async function normalizeUploadedImageOrientation(file) {
  if (!file || !file.path) {
    return;
  }

  const tempPath = `${file.path}.oriented${path.extname(file.path) || '.img'}`;
  try {
    const metadata = await sharp(file.path, { failOn: 'none' }).metadata();
    const orientation = normalizeExifOrientation(metadata.orientation);
    if (orientation === 1 || (Number.isFinite(metadata.pages) && metadata.pages > 1)) {
      return;
    }

    await sharp(file.path, { failOn: 'none' })
      .rotate()
      .toFile(tempPath);
    await fs.promises.rename(tempPath, file.path);
    const stats = await fs.promises.stat(file.path);
    file.size = stats.size;

    logger.notice('Normalized LocateAnything upload orientation', {
      category: 'locateanything_admin',
      metadata: {
        fileName: file.originalname || file.filename || null,
        storedFileName: file.filename || null,
        orientation,
      },
    });
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        logger.warning('Unable to clean up LocateAnything orientation temp file', {
          category: 'locateanything_admin',
          metadata: {
            tempPath,
            message: cleanupError?.message || String(cleanupError),
          },
        });
      }
    }

    logger.warning('Unable to normalize LocateAnything upload orientation', {
      category: 'locateanything_admin',
      metadata: {
        fileName: file.originalname || file.filename || null,
        storedFileName: file.filename || null,
        message: error?.message || String(error),
      },
    });
  }
}

async function normalizeUploadedImageOrientations(files = []) {
  await Promise.all((files || []).map((file) => normalizeUploadedImageOrientation(file)));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampPercent(value) {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function getOverlayFrame(rawOutput) {
  const imageSize = rawOutput?.image_size || {};
  const resizeFinal = rawOutput?.resize?.final || {};
  const resizeOriginal = rawOutput?.resize?.original || {};
  const width = Number(imageSize.width || resizeFinal.width || resizeOriginal.width);
  const height = Number(imageSize.height || resizeFinal.height || resizeOriginal.height);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  return { width, height };
}

function getDisplayFrame(frame, orientation) {
  if (!frame) {
    return null;
  }
  return AXIS_SWAPPED_ORIENTATIONS.has(orientation)
    ? { width: frame.height, height: frame.width }
    : { ...frame };
}

function toFramePercent(value, total) {
  return clampPercent((Number(value) / total) * 100);
}

function transformPointForOrientation(x, y, frame, orientation) {
  switch (orientation) {
    case 2:
      return { x: frame.width - x, y };
    case 3:
      return { x: frame.width - x, y: frame.height - y };
    case 4:
      return { x, y: frame.height - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: frame.height - y, y: x };
    case 7:
      return { x: frame.height - y, y: frame.width - x };
    case 8:
      return { x: y, y: frame.width - x };
    default:
      return { x, y };
  }
}

function transformBoxForOrientation(box, frame, orientation) {
  if (orientation === 1) {
    return box;
  }

  const corners = [
    transformPointForOrientation(box.x1, box.y1, frame, orientation),
    transformPointForOrientation(box.x2, box.y1, frame, orientation),
    transformPointForOrientation(box.x2, box.y2, frame, orientation),
    transformPointForOrientation(box.x1, box.y2, frame, orientation),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);

  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function getExplicitOverlayLabel(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const refMatches = Array.from(trimmed.matchAll(/<ref>([\s\S]*?)(?:<\/ref>|$)/gi));
  if (refMatches.length) {
    const lastRef = refMatches[refMatches.length - 1];
    return getExplicitOverlayLabel(lastRef[1]);
  }

  if (/<\/?(?:ref|box|point)>|<\|im_end\|>/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function isNoneLocationMarkup(value) {
  const normalized = String(value || '')
    .replace(/<\|im_end\|>/g, '')
    .trim()
    .toLowerCase();
  return normalized === 'none' || normalized === 'null';
}

function extractAnswerOverlayLabels(answer) {
  if (typeof answer !== 'string' || !answer.trim()) {
    return { boxes: [], points: [] };
  }

  const labels = { boxes: [], points: [] };
  let currentLabel = null;
  const tokenPattern = /<ref>([\s\S]*?)<\/ref>|<box>([\s\S]*?)<\/box>|<point>([\s\S]*?)<\/point>/gi;
  let match;

  while ((match = tokenPattern.exec(answer)) !== null) {
    if (match[1] !== undefined) {
      currentLabel = getExplicitOverlayLabel(match[1]);
      continue;
    }

    if (match[2] !== undefined) {
      if (!isNoneLocationMarkup(match[2])) {
        labels.boxes.push(currentLabel);
      }
      continue;
    }

    if (match[3] !== undefined && !isNoneLocationMarkup(match[3])) {
      labels.points.push(currentLabel);
    }
  }

  return labels;
}

function buildBoxOverlay(box, index, frame, label, orientation = 1) {
  const x1 = Number(box?.x1);
  const y1 = Number(box?.y1);
  const x2 = Number(box?.x2);
  const y2 = Number(box?.y2);

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  const displayFrame = getDisplayFrame(frame, orientation);
  const orientedBox = transformBoxForOrientation({
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
  }, frame, orientation);
  const left = toFramePercent(orientedBox.x1, displayFrame.width);
  const right = toFramePercent(orientedBox.x2, displayFrame.width);
  const top = toFramePercent(orientedBox.y1, displayFrame.height);
  const bottom = toFramePercent(orientedBox.y2, displayFrame.height);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    type: 'box',
    label: label || `box ${index + 1}`,
    style: `left:${left}%;top:${top}%;width:${width}%;height:${height}%;`,
  };
}

function buildPointOverlay(point, index, frame, label, orientation = 1) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const displayFrame = getDisplayFrame(frame, orientation);
  const orientedPoint = transformPointForOrientation(x, y, frame, orientation);

  return {
    type: 'point',
    label: label || `point ${index + 1}`,
    style: `left:${toFramePercent(orientedPoint.x, displayFrame.width)}%;top:${toFramePercent(orientedPoint.y, displayFrame.height)}%;`,
  };
}

function buildBoxOverlays(boxes, frame, answerLabels = [], orientation = 1) {
  let lastLabel = null;
  return boxes.map((box, index) => {
    const answerLabel = getExplicitOverlayLabel(answerLabels[index]);
    const explicitLabel = answerLabel || getExplicitOverlayLabel(box?.label);
    if (explicitLabel) {
      lastLabel = explicitLabel;
    }
    return buildBoxOverlay(box, index, frame, explicitLabel || lastLabel, orientation);
  });
}

function buildPointOverlays(points, frame, answerLabels = [], orientation = 1) {
  let lastLabel = null;
  return points.map((point, index) => {
    const answerLabel = getExplicitOverlayLabel(answerLabels[index]);
    const explicitLabel = answerLabel || getExplicitOverlayLabel(point?.label);
    if (explicitLabel) {
      lastLabel = explicitLabel;
    }
    return buildPointOverlay(point, index, frame, explicitLabel || lastLabel, orientation);
  });
}

function resolveStoredFilePath(file) {
  if (!file?.storedPath) {
    return null;
  }

  const resolvedPath = path.resolve(APP_ROOT, file.storedPath);
  if (!resolvedPath.startsWith(`${APP_ROOT}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

function aspectDistance(width, height, targetWidth, targetHeight) {
  if (![width, height, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs((width / height) - (targetWidth / targetHeight));
}

function shouldApplyImageOrientationToOverlay(orientation, frame, metadata) {
  if (orientation === 1) {
    return false;
  }
  if (!frame || !metadata?.width || !metadata?.height) {
    return true;
  }
  if (!AXIS_SWAPPED_ORIENTATIONS.has(orientation)) {
    return true;
  }

  const rawDistance = aspectDistance(frame.width, frame.height, metadata.width, metadata.height);
  const orientedDistance = aspectDistance(frame.width, frame.height, metadata.height, metadata.width);
  return rawDistance <= orientedDistance;
}

async function getImageDisplayOrientation(file, frame) {
  const filePath = resolveStoredFilePath(file);
  if (!filePath) {
    return 1;
  }

  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    const orientation = normalizeExifOrientation(metadata.orientation);
    return shouldApplyImageOrientationToOverlay(orientation, frame, metadata) ? orientation : 1;
  } catch (error) {
    logger.warning('Unable to read LocateAnything image orientation metadata', {
      category: 'locateanything_admin',
      metadata: {
        storedPath: file.storedPath || null,
        message: error?.message || String(error),
      },
    });
    return 1;
  }
}

async function decorateFileForDisplay(file) {
  const rawOutput = file?.rawOutput || null;
  const frame = getOverlayFrame(rawOutput);
  const rawBoxes = Array.isArray(rawOutput?.boxes) ? rawOutput.boxes : [];
  const rawPoints = Array.isArray(rawOutput?.points) ? rawOutput.points : [];
  const answerLabels = extractAnswerOverlayLabels(rawOutput?.answer);
  const displayOrientation = await getImageDisplayOrientation(file, frame);
  const overlayItems = frame
    ? [
        ...buildBoxOverlays(rawBoxes, frame, answerLabels.boxes, displayOrientation),
        ...buildPointOverlays(rawPoints, frame, answerLabels.points, displayOrientation),
      ].filter(Boolean)
    : [];

  return {
    ...file,
    overlayFrame: frame,
    displayOrientation,
    overlayItems,
    overlaySummary: {
      boxes: rawBoxes.length,
      points: rawPoints.length,
      visible: overlayItems.length,
    },
  };
}

async function decorateJobForDisplay(job) {
  if (!job) {
    return null;
  }

  return {
    ...job,
    files: Array.isArray(job.files) ? await Promise.all(job.files.map(decorateFileForDisplay)) : [],
  };
}

async function cleanupUploadedFiles(files = []) {
  await Promise.all((files || [])
    .filter((file) => file && file.path)
    .map(async (file) => {
      try {
        await fs.promises.unlink(file.path);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger.warning('Unable to clean up rejected LocateAnything upload', {
            category: 'locateanything_admin',
            metadata: {
              path: file.path,
              message: error?.message || String(error),
            },
          });
        }
      }
    }));
}

async function loadPageJobs(selectedJobId) {
  const jobs = await LocateAnythingJob.find({})
    .sort({ createdAt: -1 })
    .limit(JOB_HISTORY_LIMIT)
    .lean()
    .exec();

  let selectedJob = null;
  if (selectedJobId) {
    selectedJob = jobs.find((job) => String(job._id) === String(selectedJobId)) ||
      await LocateAnythingJob.findById(selectedJobId).lean().exec();
  }
  if (!selectedJob && jobs.length) {
    selectedJob = jobs[0];
  }

  return { jobs, selectedJob: await decorateJobForDisplay(selectedJob) };
}

async function renderPage(req, res, {
  form = defaultForm(),
  error = null,
  success = null,
  selectedJobId = null,
  statusCode = 200,
} = {}) {
  const { jobs, selectedJob } = await loadPageJobs(selectedJobId || req.query?.jobId);
  const uploadMaxMb = Number.parseInt(process.env.LOCATEANYTHING_UPLOAD_MAX_MB, 10) || 25;

  return res.status(statusCode).render('admin_locateanything', {
    apiBase: locateAnythingGateway.gatewayBaseUrl,
    servicePath: SERVICE_PATH,
    form,
    error,
    success,
    jobs,
    selectedJob,
    taskOptions: TASK_OPTIONS,
    outputTypeOptions: OUTPUT_TYPE_OPTIONS,
    generationModeOptions: GENERATION_MODE_OPTIONS,
    uploadMaxMb,
  });
}

function finalizeJobStatus(job) {
  const files = Array.isArray(job.files) ? job.files : [];
  const completedCount = files.filter((file) => file.status === 'completed').length;
  const failedCount = files.filter((file) => file.status === 'failed').length;

  if (files.length > 0 && completedCount === files.length) {
    job.status = 'completed';
    job.error = null;
    return;
  }

  if (completedCount > 0 && failedCount > 0) {
    job.status = 'partial_failed';
    job.error = `${failedCount} of ${files.length} image request(s) failed.`;
    return;
  }

  job.status = 'failed';
  job.error = files.length > 0
    ? `${failedCount || files.length} of ${files.length} image request(s) failed.`
    : 'No image files were processed.';
}

async function processJobFiles(job, uploadedFiles, requestOptions) {
  for (let index = 0; index < uploadedFiles.length; index += 1) {
    const uploadedFile = uploadedFiles[index];
    const fileRecord = job.files[index];
    fileRecord.status = 'processing';
    fileRecord.error = null;
    fileRecord.startedAt = new Date();
    job.markModified('files');
    await job.save();

    try {
      const result = await locateAnythingGateway.locateFile({
        file: uploadedFile,
        options: requestOptions,
      });
      fileRecord.status = 'completed';
      fileRecord.gatewayStatusCode = result.status || 200;
      fileRecord.rawOutput = result.data;
      fileRecord.rawErrorOutput = null;
    } catch (error) {
      fileRecord.status = 'failed';
      fileRecord.gatewayStatusCode = error?.response?.status || null;
      fileRecord.error = buildGatewayErrorMessage(error);
      fileRecord.rawErrorOutput = getErrorPayload(error);
    } finally {
      fileRecord.completedAt = new Date();
      job.markModified('files');
      await job.save();
    }
  }
}

exports.render = async (req, res, next) => {
  try {
    const success = req.query?.status === 'saved'
      ? 'LocateAnything job saved.'
      : null;
    return renderPage(req, res, { success });
  } catch (error) {
    return next(error);
  }
};

exports.createJob = async (req, res, next) => {
  const form = normalizeForm(req.body || {});
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const validationError = validateRequest(form, uploadedFiles, req.locateAnythingUploadError);

  if (validationError) {
    await cleanupUploadedFiles(uploadedFiles);
    return renderPage(req, res, {
      form,
      error: validationError,
      statusCode: 400,
    }).catch(next);
  }

  const requestOptions = buildRequestOptions(form);
  let job = null;

  try {
    await normalizeUploadedImageOrientations(uploadedFiles);

    job = await LocateAnythingJob.create({
      status: 'processing',
      gatewayBaseUrl: locateAnythingGateway.gatewayBaseUrl,
      gatewayPath: SERVICE_PATH,
      requestOptions,
      owner: {
        id: req.user?._id ? String(req.user._id) : null,
        name: req.user?.name || null,
      },
      files: uploadedFiles.map(buildFileRecord),
      startedAt: new Date(),
    });

    logger.notice('LocateAnything admin job started', {
      category: 'locateanything_admin',
      metadata: {
        jobId: job._id,
        fileCount: uploadedFiles.length,
        task: requestOptions.task,
        owner: req.user?.name || null,
      },
    });

    await processJobFiles(job, uploadedFiles, requestOptions);
    finalizeJobStatus(job);
    job.completedAt = new Date();
    await job.save();

    logger.notice('LocateAnything admin job finished', {
      category: 'locateanything_admin',
      metadata: {
        jobId: job._id,
        status: job.status,
        fileCount: job.files.length,
      },
    });

    return res.redirect(`/admin/locateanything?jobId=${encodeURIComponent(job._id)}&status=saved`);
  } catch (error) {
    logger.error('LocateAnything admin job failed before it could be saved', {
      category: 'locateanything_admin',
      metadata: {
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
    });
    if (!job) {
      await cleanupUploadedFiles(uploadedFiles);
    }
    return next(error);
  }
};
