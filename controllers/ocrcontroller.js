const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const EmbeddingApiService = require('../services/embeddingApiService');
const { OcrJob } = require('../database');

const DEFAULT_PROMPT = 'Detect and recognize text in the image, and output the text coordinates in a formatted manner.';
const DEFAULT_MAX_NEW_TOKENS = 2048;
const MAX_ALLOWED_TOKENS = 8192;
const MAX_COORD_VALUE = 1000;
const API_BASE_URL = process.env.OCR_API_BASE_URL || 'http://192.168.0.20:8000';
const OCR_TIMEOUT_MS = Number(process.env.OCR_API_TIMEOUT_MS || 1200000);
const RECENT_WINDOW_DAYS = Number(process.env.OCR_JOB_RECENT_DAYS || 7);
const LIST_PAGE_SIZE = Number(process.env.OCR_JOB_PAGE_SIZE || 30);
const OCR_PREVIEW_DIR = path.join(__dirname, '..', 'public', 'ocr');
const MAX_PREVIEW_SIDE = 2048;
const logApiDebug = createApiDebugLogger('controllers/ocrcontroller.js');
const embeddingApiService = new EmbeddingApiService();
const OCR_EMBED_CONTENT_TYPE = 'ocr_layout_text';
const OCR_SOURCE_COLLECTION = 'ocr_job_files';
const OCR_PARENT_COLLECTION = 'ocr_job';

const jobQueue = [];
let activeJobId = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percentOfCanvas = (value) => clamp((value / MAX_COORD_VALUE) * 100, 0, 100);
const coerceDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const buildRecentCutoff = () => new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

const parseOcrText = (rawText) => {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const matches = [];
  const pattern = /([\s\S]*?)\((\d{1,3}),(\d{1,3})\),\((\d{1,3}),(\d{1,3})\)/g;
  let match;

  while ((match = pattern.exec(rawText)) !== null) {
    const text = match[1].trim();
    const coords = match.slice(2).map((value) => clamp(parseInt(value, 10), 0, MAX_COORD_VALUE));
    if (!text) {
      continue;
    }
    matches.push({
      text,
      startX: coords[0],
      startY: coords[1],
      endX: coords[2],
      endY: coords[3],
    });
  }
  return matches;
};

const buildLayoutText = (boxes) => {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return '';
  }

  const height = (box) => Math.max(1, box.endY - box.startY);
  const yOverlap = (a, b) => Math.max(0, Math.min(a.endY, b.endY) - Math.max(a.startY, b.startY));
  const sharesRow = (a, b) => {
    const overlap = yOverlap(a, b);
    return overlap >= 0.5 * height(a) && overlap >= 0.5 * height(b);
  };

  const normalized = boxes
    .filter((box) => box && typeof box.text === 'string')
    .map((box) => ({
      ...box,
      text: box.text.trim(),
    }))
    .filter((box) => box.text);

  if (!normalized.length) {
    return '';
  }

  const sorted = normalized
    .sort((a, b) => (a.startY - b.startY) || (a.startX - b.startX));

  const rows = [];
  sorted.forEach((box) => {
    const targetRow = rows.find((row) => row.some((entry) => sharesRow(entry, box)));
    if (targetRow) {
      targetRow.push(box);
    } else {
      rows.push([box]);
    }
  });

  const lines = rows
    .map((row) => row
      .sort((a, b) => a.startX - b.startX)
      .map((box) => (box.text || '').trim())
      .filter(Boolean)
      .join('  '))
    .filter(Boolean);

  return lines.join('\n');
};

const enrichBoxesForOverlay = (boxes) => boxes.map((box, index) => {
  const width = clamp(box.endX - box.startX, 1, MAX_COORD_VALUE);
  const height = clamp(box.endY - box.startY, 1, MAX_COORD_VALUE);
  return {
    ...box,
    id: `${index}-${box.startX}-${box.startY}`,
    leftPercent: percentOfCanvas(box.startX),
    topPercent: percentOfCanvas(box.startY),
    widthPercent: clamp((width / MAX_COORD_VALUE) * 100, 0.5, 100),
    heightPercent: clamp((height / MAX_COORD_VALUE) * 100, 0.5, 100),
  };
});

const fetchHealth = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/health`, { timeout: 2000 });
    if (data && typeof data === 'object') {
      return data;
    }
  } catch (error) {
    // Health is optional; ignore failures
  }
  return null;
};

const buildViewState = (overrides = {}) => ({
  title: overrides.title || 'OCR Workspace',
  tokenLimit: MAX_ALLOWED_TOKENS,
  defaults: {
    prompt: DEFAULT_PROMPT,
    maxNewTokens: DEFAULT_MAX_NEW_TOKENS,
  },
  formValues: {
    prompt: overrides.prompt ?? DEFAULT_PROMPT,
    maxNewTokens: overrides.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS,
  },
  error: overrides.error || null,
  health: overrides.health || null,
  jobs: overrides.jobs || [],
  latestUpdatedAt: overrides.latestUpdatedAt || null,
  hasOlder: Boolean(overrides.hasOlder),
  selectedJobId: overrides.selectedJobId || null,
  singleJobMode: Boolean(overrides.singleJobMode),
  highlightFileId: overrides.highlightFileId || null,
  initialJobDetail: overrides.initialJobDetail || null,
});

const formatImagePath = (storedPath) => {
  if (!storedPath) return null;
  const normalized = storedPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const buildOcrEmbeddingMetadata = (job, file) => {
  const documentId = (file?.id || file?._id?.toString?.() || '').trim();
  const parentId = (job?.id || job?._id?.toString?.() || '').trim();

  if (!documentId || !parentId) {
    return null;
  }

  return {
    collectionName: OCR_SOURCE_COLLECTION,
    documentId,
    contentType: OCR_EMBED_CONTENT_TYPE,
    parentCollection: OCR_PARENT_COLLECTION,
    parentId,
  };
};

const syncOcrEmbedding = async (job, file, { silent = false } = {}) => {
  const metadata = buildOcrEmbeddingMetadata(job, file);
  const text = (file?.result?.layoutText || '').trim();

  if (!metadata) {
    logger.warning('Missing OCR metadata for embedding sync', {
      category: 'ocr',
      metadata: {
        jobId: job?.id || job?._id,
        fileId: file?.id,
      },
    });
    return;
  }

  try {
    if (!text) {
      await embeddingApiService.deleteEmbeddings(metadata);
      return;
    }

    await embeddingApiService.embed([text], {}, [metadata]);
  } catch (error) {
    logger.error('Failed to sync OCR embeddings', {
      category: 'ocr',
      metadata: {
        jobId: job?.id || job?._id,
        fileId: file?.id,
        message: error?.message || error,
      },
    });
    if (!silent) {
      throw error;
    }
  }
};

const computeFileCounts = (job) => {
  const files = Array.isArray(job.files) ? job.files : [];
  const total = files.length;
  const completed = files.filter((f) => f.status === 'completed').length;
  const failed = files.filter((f) => f.status === 'failed').length;
  const processing = files.filter((f) => f.status === 'processing').length;
  return { total, completed, failed, processing };
};

const sanitizeJobSummary = (job) => {
  const counts = computeFileCounts(job);
  const id = job._id?.toString?.() || job.id;
  return {
    id,
    prompt: job.prompt,
    maxNewTokens: job.maxNewTokens,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
    error: job.error,
    owner: job.owner,
    counts,
    files: (job.files || []).map((file) => ({
      id: file.id,
      originalname: file.originalname,
      status: file.status,
      size: file.size,
      completedAt: file.completedAt,
      updatedAt: file.updatedAt,
    })),
  };
};

const sanitizeJobDetail = (job) => {
  const summary = sanitizeJobSummary(job);
  return {
    ...summary,
    files: (job.files || []).map((file) => ({
      id: file.id,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      status: file.status,
      createdAt: file.createdAt,
      startedAt: file.startedAt,
      completedAt: file.completedAt,
      updatedAt: file.updatedAt,
      error: file.error,
      previewPath: formatImagePath(file.previewPath),
      result: file.result ? {
        rawText: file.result.rawText,
        layoutText: file.result.layoutText,
        overlayBoxes: Array.isArray(file.result.overlayBoxes) ? file.result.overlayBoxes : [],
        originalOverlayBoxes: Array.isArray(file.result.originalOverlayBoxes) ? file.result.originalOverlayBoxes : [],
        originalLayoutText: file.result.originalLayoutText || file.result.layoutText,
        imagePath: formatImagePath(file.result.imagePath || file.previewPath),
        model: file.result.model,
        promptUsed: file.result.promptUsed,
        segmentsCount: file.result.segmentsCount,
        receivedAt: file.result.receivedAt,
      } : null,
    })),
  };
};

const getJobLastUpdated = (job) => {
  if (!job) return null;
  const timestamps = [
    job.updatedAt,
    job.completedAt,
    job.startedAt,
    job.createdAt,
  ];

  (job.files || []).forEach((file) => {
    timestamps.push(
      file.updatedAt,
      file.completedAt,
      file.startedAt,
      file.createdAt,
    );
  });

  const latest = timestamps
    .map(coerceDate)
    .filter(Boolean)
    .reduce((max, date) => Math.max(max, date.getTime()), 0);

  return latest ? new Date(latest) : null;
};

const deriveLatestUpdatedAt = (jobs = []) => {
  const latest = jobs.reduce((max, job) => {
    const updated = getJobLastUpdated(job);
    return Math.max(max, updated ? updated.getTime() : 0);
  }, 0);
  return latest ? new Date(latest).toISOString() : null;
};

const savePreviewImage = async (buffer, jobId, index, originalname) => {
  await fs.mkdir(OCR_PREVIEW_DIR, { recursive: true });
  const safeBase = (originalname || 'image').replace(/[^a-zA-Z0-9-_]+/g, '').slice(0, 40) || 'image';
  const filename = `${jobId}-${index + 1}-${safeBase}.jpg`;
  const targetPath = path.join(OCR_PREVIEW_DIR, filename);

  await sharp(buffer)
    .rotate()
    .resize({
      width: MAX_PREVIEW_SIDE,
      height: MAX_PREVIEW_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(targetPath);

  return path.join('ocr', filename);
};

const createJobRecord = async (files, prompt, maxNewTokens, user) => {
  const jobId = randomUUID();
  const now = new Date();
  const preparedFiles = [];
  const queueFiles = [];

  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const previewPath = await savePreviewImage(file.buffer, jobId, index, file.originalname);

      preparedFiles.push({
        id: `${jobId}-file-${index + 1}`,
        originalname: file.originalname || `upload-${index + 1}`,
        mimetype: file.mimetype,
        size: file.size,
        previewPath,
        status: 'queued',
        error: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        result: null,
      });

      queueFiles.push({
        id: preparedFiles[index].id,
        buffer: Buffer.from(file.buffer),
        mimetype: file.mimetype,
        size: file.size,
        originalname: file.originalname || `upload-${index + 1}`,
      });
    }

    const job = new OcrJob({
      _id: jobId,
      prompt,
      maxNewTokens,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      error: null,
      owner: user ? { id: user._id?.toString?.(), name: user.name } : null,
      files: preparedFiles,
    });

    await job.save();
    return { job, queueFiles };
  } catch (error) {
    await Promise.all(preparedFiles.map(async (file) => {
      if (!file.previewPath) return;
      try {
        await fs.unlink(path.join(__dirname, '..', 'public', file.previewPath));
      } catch {
        // ignore cleanup failures
      }
    }));
    throw error;
  }
};

const runFileOcr = async (job, file, payload) => {
  const requestUrl = `${API_BASE_URL}/ocr`;
  const multipart = new FormData();
  multipart.append('file', payload.buffer, {
    filename: payload.originalname || `${file.id}.dat`,
    contentType: payload.mimetype || 'application/octet-stream',
    knownLength: payload.buffer.length,
  });
  multipart.append('prompt', job.prompt);
  multipart.append('max_new_tokens', String(job.maxNewTokens));

  logger.notice('Submitting OCR file to API', {
    category: 'ocr',
    metadata: {
      jobId: job.id || job._id,
      fileId: file.id,
      filename: payload.originalname,
      sizeBytes: payload.size,
    },
  });

  try {
    const axiosResponse = await axios.post(requestUrl, multipart, {
      timeout: OCR_TIMEOUT_MS,
      headers: {
        ...multipart.getHeaders(),
        Accept: 'application/json',
      },
    });
    const { data } = axiosResponse;

    try {
      await logApiDebug({
        requestUrl,
        requestHeaders: axiosResponse.config?.headers,
        requestBody: {
          jobId: job.id || job._id,
          fileId: file.id,
          prompt: job.prompt,
          max_new_tokens: job.maxNewTokens,
          fileSizeBytes: payload.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: axiosResponse.headers,
        responseBody: {
          model: data?.model,
          prompt: data?.prompt,
          textLength: typeof data?.text === 'string' ? data.text.length : 0,
          keys: Object.keys(data || {}),
        },
        functionName: 'runFileOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    const rawText = typeof data?.text === 'string' ? data.text : '';
    const boxes = parseOcrText(rawText);
    const layoutText = buildLayoutText(boxes);
    const overlayBoxes = enrichBoxesForOverlay(boxes);

    return {
      rawText,
      layoutText: layoutText || rawText,
      overlayBoxes,
      originalOverlayBoxes: overlayBoxes,
      originalLayoutText: layoutText || rawText,
      model: data?.model || 'Unknown model',
      promptUsed: data?.prompt || job.prompt,
      segmentsCount: overlayBoxes.length,
      receivedAt: new Date(),
    };
  } catch (error) {
    let message = 'Unable to contact the OCR service.';
    if (error.response?.data?.error) {
      message = error.response.data.error;
    } else if (Array.isArray(error.response?.data?.detail)) {
      message = error.response.data.detail.map((d) => d.msg).join('; ');
    } else if (error.message) {
      message = error.message;
    }

    try {
      await logApiDebug({
        requestUrl,
        requestHeaders: error.config?.headers,
        requestBody: {
          jobId: job.id || job._id,
          fileId: file.id,
          prompt: job.prompt,
          max_new_tokens: job.maxNewTokens,
          fileSizeBytes: payload.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: error.response?.headers,
        responseBody: error.response?.data || { error: error.message },
        functionName: 'runFileOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    throw new Error(message);
  }
};

const processQueue = () => {
  if (activeJobId || !jobQueue.length) {
    return;
  }

  const nextJob = jobQueue.shift();
  if (!nextJob) {
    return;
  }

  activeJobId = nextJob.jobId;
  executeJob(nextJob)
    .catch((error) => {
      logger.error('Unexpected OCR job failure', {
        category: 'ocr',
        metadata: { jobId: nextJob.jobId, message: error?.message || error },
      });
    })
    .finally(() => {
      activeJobId = null;
      if (jobQueue.length) {
        setImmediate(processQueue);
      }
    });
};

const executeJob = async (queueItem) => {
  const job = await OcrJob.findById(queueItem.jobId);
  if (!job) {
    logger.error('OCR job not found during processing', { category: 'ocr', metadata: { jobId: queueItem.jobId } });
    return;
  }

  job.status = 'processing';
  job.startedAt = job.startedAt || new Date();
  job.updatedAt = new Date();
  await job.save();
  let hadError = false;

  for (const payload of queueItem.files) {
    const file = job.files.find((f) => f.id === payload.id);
    if (!file) {
      logger.error('OCR file not found during processing', { category: 'ocr', metadata: { jobId: job.id, fileId: payload.id } });
      continue;
    }

    file.status = 'processing';
    file.startedAt = new Date();
    file.updatedAt = new Date();
    await job.save();

    try {
      const result = await runFileOcr(job, file, payload);
      file.result = { ...result, imagePath: file.previewPath };
      file.status = 'completed';
      file.completedAt = new Date();
      file.error = null;
      logger.notice('OCR file completed', {
        category: 'ocr',
        metadata: {
          jobId: job.id,
          fileId: file.id,
          filename: payload.originalname,
          segments: result.segmentsCount,
        },
      });
      await syncOcrEmbedding(job, file, { silent: true });
    } catch (error) {
      file.status = 'failed';
      file.error = error.message || 'File failed to process.';
      file.completedAt = new Date();
      hadError = true;
      logger.error('OCR file failed', {
        category: 'ocr',
        metadata: {
          jobId: job.id,
          fileId: file.id,
          filename: payload.originalname,
          message: file.error,
        },
      });
    } finally {
      file.updatedAt = new Date();
      job.updatedAt = new Date();
      await job.save();
    }
  }

  job.status = hadError ? 'failed' : 'completed';
  job.error = hadError ? 'One or more files failed. Expand file entries for details.' : null;
  job.completedAt = new Date();
  job.updatedAt = new Date();
  await job.save();

  logger.notice('OCR job finished', {
    category: 'ocr',
    metadata: {
      jobId: job.id,
      status: job.status,
      files: job.files.length,
      failures: job.files.filter((f) => f.status === 'failed').length,
    },
  });
};

const buildListQuery = ({ scope, before, updatedSince }) => {
  const query = {};
  const recentCutoff = buildRecentCutoff();

  if (scope !== 'all') {
    query.createdAt = { $gte: recentCutoff };
  }

  if (before) {
    query.createdAt = {
      ...(query.createdAt || {}),
      $lt: before,
    };
  }

  if (updatedSince && !before) {
    query.updatedAt = { $gt: updatedSince };
  }

  return query;
};

const queryJobSummaries = async ({ scope = 'recent', before, updatedSince, limit = LIST_PAGE_SIZE } = {}) => {
  const normalizedLimit = clamp(limit, 1, 100);
  const query = buildListQuery({ scope, before, updatedSince });
  const jobs = await OcrJob.find(query)
    .sort({ createdAt: -1 })
    .limit(normalizedLimit)
    .lean();

  const latestUpdatedAt = deriveLatestUpdatedAt(jobs);
  let hasOlder = false;
  if (jobs.length) {
    const lastCreated = jobs[jobs.length - 1].createdAt;
    hasOlder = Boolean(await OcrJob.exists({ createdAt: { $lt: lastCreated } }));
  } else if (scope === 'recent') {
    hasOlder = Boolean(await OcrJob.exists({ createdAt: { $lt: buildRecentCutoff() } }));
  }

  return {
    jobs: jobs.map(sanitizeJobSummary),
    latestUpdatedAt,
    hasOlder,
  };
};

exports.renderTool = async (_req, res) => {
  const health = await fetchHealth();
  const initial = await queryJobSummaries({ scope: 'recent' });
  res.render('ocr_tool', buildViewState({
    health,
    jobs: initial.jobs,
    latestUpdatedAt: initial.latestUpdatedAt,
    hasOlder: initial.hasOlder,
  }));
};

exports.renderJobPage = async (req, res) => {
  const { jobId } = req.params;
  const highlightFileId = (req.params.fileId || req.query.fileId || '').trim();
  try {
    const job = await OcrJob.findById(jobId);
    if (!job) {
      return res.status(404).render('error_page', { error: 'Job not found.' });
    }

    const health = await fetchHealth();
    const detail = sanitizeJobDetail(job);
    const summary = sanitizeJobSummary(job);
    const latestUpdatedAt = deriveLatestUpdatedAt([job]);

    return res.render('ocr_tool', buildViewState({
      health,
      jobs: [summary],
      latestUpdatedAt,
      hasOlder: false,
      selectedJobId: summary.id,
      singleJobMode: true,
      highlightFileId: highlightFileId || null,
      initialJobDetail: detail,
      title: 'OCR Job',
    }));
  } catch (error) {
    logger.error('Failed to render OCR job page', { category: 'ocr', metadata: { jobId, message: error?.message || error } });
    return res.status(500).render('error_page', { error: 'Unable to load OCR job.' });
  }
};

exports.listJobs = async (req, res) => {
  const updatedSince = coerceDate(req.query.updated_since);
  const before = coerceDate(req.query.before);
  const scope = req.query.scope === 'all' ? 'all' : 'recent';
  const limit = Number.isFinite(parseInt(req.query.limit, 10)) ? parseInt(req.query.limit, 10) : LIST_PAGE_SIZE;

  try {
    const result = await queryJobSummaries({
      scope,
      before,
      updatedSince,
      limit,
    });

    res.json({
      jobs: result.jobs,
      latestUpdatedAt: result.latestUpdatedAt,
      hasOlder: result.hasOlder,
    });
  } catch (error) {
    logger.error('Failed to list OCR jobs', { category: 'ocr', metadata: { message: error?.message || error } });
    res.status(500).json({ error: 'Unable to load OCR jobs.' });
  }
};

exports.getJobDetails = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await OcrJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    return res.json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to load OCR job details', { category: 'ocr', metadata: { jobId, message: error?.message || error } });
    return res.status(500).json({ error: 'Unable to load job.' });
  }
};

exports.enqueueJob = async (req, res) => {
  const prompt = req.body.prompt && req.body.prompt.trim() ? req.body.prompt.trim() : DEFAULT_PROMPT;
  const requestedTokens = parseInt(req.body.max_new_tokens, 10);
  const maxNewTokens = Number.isFinite(requestedTokens)
    ? clamp(requestedTokens, 1, MAX_ALLOWED_TOKENS)
    : DEFAULT_MAX_NEW_TOKENS;

  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'Please upload at least one image.' });
  }

  try {
    const { job, queueFiles } = await createJobRecord(req.files, prompt, maxNewTokens, req.user);
    jobQueue.push({ jobId: job.id, files: queueFiles });
    processQueue();

    logger.notice('Queued OCR job', {
      category: 'ocr',
      metadata: {
        jobId: job.id,
        files: job.files.length,
        promptLength: prompt.length,
        maxNewTokens,
      },
    });

    return res.status(202).json({
      job: sanitizeJobSummary(job),
    });
  } catch (error) {
    logger.error('Failed to queue OCR job', {
      category: 'ocr',
      metadata: { message: error?.message || error },
    });
    return res.status(500).json({ error: 'Failed to queue OCR job.' });
  }
};

exports.updateFileResult = async (req, res) => {
  const { jobId, fileId } = req.params;
  const { layoutText, overlayBoxes } = req.body || {};

  try {
    const job = await OcrJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const file = job.files.find((entry) => entry.id === fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (!file.result) {
      return res.status(400).json({ error: 'OCR result not ready for this file.' });
    }

    let normalizedBoxes = Array.isArray(overlayBoxes) ? overlayBoxes : file.result.overlayBoxes || [];
    normalizedBoxes = normalizedBoxes
      .map((box) => ({
        text: (box.text || '').trim(),
        startX: clamp(parseInt(box.startX, 10) || 0, 0, MAX_COORD_VALUE),
        startY: clamp(parseInt(box.startY, 10) || 0, 0, MAX_COORD_VALUE),
        endX: clamp(parseInt(box.endX, 10) || 0, 0, MAX_COORD_VALUE),
        endY: clamp(parseInt(box.endY, 10) || 0, 0, MAX_COORD_VALUE),
      }))
      .filter((box) => box.text);

    const enrichedBoxes = enrichBoxesForOverlay(normalizedBoxes);
    const nextLayoutText = typeof layoutText === 'string' && layoutText.trim()
      ? layoutText
      : buildLayoutText(normalizedBoxes);

    file.result.overlayBoxes = enrichedBoxes;
    file.result.layoutText = nextLayoutText;
    if (!Array.isArray(file.result.originalOverlayBoxes) || !file.result.originalOverlayBoxes.length) {
      file.result.originalOverlayBoxes = enrichedBoxes;
    }
    if (!file.result.originalLayoutText) {
      file.result.originalLayoutText = nextLayoutText;
    }
    file.updatedAt = new Date();
    job.updatedAt = new Date();
    await job.save();

    await syncOcrEmbedding(job, file);

    return res.json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to update OCR edits', {
      category: 'ocr',
      metadata: { jobId, fileId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to save OCR edits.' });
  }
};

exports.embedFileHighQuality = async (req, res) => {
  const { jobId, fileId } = req.params;

  try {
    const job = await OcrJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const file = job.files.find((entry) => entry.id === fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (file.status !== 'completed' || !file.result) {
      return res.status(400).json({ error: 'OCR result not ready for this file.' });
    }

    const metadata = buildOcrEmbeddingMetadata(job, file);
    const layoutText = (file.result?.layoutText || '').trim();

    if (!metadata || !layoutText) {
      return res.status(400).json({ error: 'Layout text is empty; save edits before embedding.' });
    }

    await embeddingApiService.embedHighQuality([layoutText], {}, [metadata]);

    logger.notice('Synced OCR layout to high-quality embeddings', {
      category: 'ocr',
      metadata: {
        jobId: job.id || job._id,
        fileId: file.id,
        textLength: layoutText.length,
      },
    });

    return res.json({ ok: true, jobId: job.id || job._id, fileId });
  } catch (error) {
    logger.error('Failed to sync OCR layout to high-quality embeddings', {
      category: 'ocr',
      metadata: { jobId, fileId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Failed to store high-quality embeddings.' });
  }
};

exports.deleteJob = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await OcrJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    if (job.status === 'processing') {
      return res.status(400).json({ error: 'Cannot delete a job that is currently processing.' });
    }

    const queuedIndex = jobQueue.findIndex((entry) => entry.jobId === jobId);
    if (queuedIndex !== -1) {
      jobQueue.splice(queuedIndex, 1);
    }

    await Promise.all((job.files || []).map(async (file) => {
      if (!file.previewPath) return;
      try {
        await fs.unlink(path.join(__dirname, '..', 'public', file.previewPath));
      } catch {
        // ignore removal failures
      }
    }));

    await OcrJob.deleteOne({ _id: jobId });
    return res.json({ ok: true, jobId });
  } catch (error) {
    logger.error('Failed to delete OCR job', { category: 'ocr', metadata: { jobId, message: error?.message || error } });
    return res.status(500).json({ error: 'Unable to delete job.' });
  }
};
