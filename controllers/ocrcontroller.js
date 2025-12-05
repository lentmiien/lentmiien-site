const axios = require('axios');
const FormData = require('form-data');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_PROMPT = 'Detect and recognize text in the image, and output the text coordinates in a formatted manner.';
const DEFAULT_MAX_NEW_TOKENS = 2048;
const MAX_ALLOWED_TOKENS = 8192;
const MAX_COORD_VALUE = 1000;
const API_BASE_URL = process.env.OCR_API_BASE_URL || 'http://192.168.0.20:8000';
const OCR_TIMEOUT_MS = Number(process.env.OCR_API_TIMEOUT_MS || 1200000);
const JOB_HISTORY_LIMIT = Number(process.env.OCR_JOB_HISTORY_LIMIT || 30);
const logApiDebug = createApiDebugLogger('controllers/ocrcontroller.js');

const jobStore = [];
const jobQueue = [];
let activeJobId = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percentOfCanvas = (value) => clamp((value / MAX_COORD_VALUE) * 100, 0, 100);
const coerceDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getJobLastUpdated = (job) => {
  if (!job) return null;
  const timestamps = [
    job.updatedAt,
    job.completedAt,
    job.startedAt,
    job.createdAt,
  ];

  job.files.forEach((file) => {
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

const getLatestUpdatedAt = () => {
  if (!jobStore.length) {
    return null;
  }
  const latest = jobStore.reduce((max, job) => {
    const updated = getJobLastUpdated(job);
    return Math.max(max, updated ? updated.getTime() : 0);
  }, 0);
  return latest ? new Date(latest) : null;
};

const buildViewState = (overrides = {}) => ({
  title: 'OCR Workspace',
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

const sanitizeJob = (job) => ({
  id: job.id,
  prompt: job.prompt,
  maxNewTokens: job.maxNewTokens,
  status: job.status,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  updatedAt: job.updatedAt,
  lastUpdatedAt: getJobLastUpdated(job),
  error: job.error,
  owner: job.owner,
  files: job.files.map((file) => {
    const { buffer, ...rest } = file;
    return rest;
  }),
});

const getJobsSnapshot = () => jobStore.map(sanitizeJob);

const createJobRecord = (files, prompt, maxNewTokens, user) => {
  const jobId = randomUUID();
  const now = new Date();
  const normalizedFiles = files.map((file, index) => ({
    id: `${jobId}-file-${index + 1}`,
    originalname: file.originalname || `upload-${index + 1}`,
    mimetype: file.mimetype,
    size: file.size,
    buffer: Buffer.from(file.buffer),
    previewDataUrl: `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`,
    status: 'queued',
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    error: null,
    result: null,
  }));

  const job = {
    id: jobId,
    prompt,
    maxNewTokens,
    status: 'queued',
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    error: null,
    owner: user ? { id: user._id?.toString?.(), name: user.name } : null,
    files: normalizedFiles,
  };

  jobStore.unshift(job);
  if (jobStore.length > JOB_HISTORY_LIMIT) {
    jobStore.pop();
  }

  jobQueue.push(job);
  processQueue();

  return job;
};

const processQueue = () => {
  if (activeJobId || !jobQueue.length) {
    return;
  }

  const job = jobQueue.shift();
  if (!job) {
    return;
  }

  activeJobId = job.id;
  executeJob(job)
    .catch((error) => {
      job.status = 'failed';
      job.error = error?.message || 'Unexpected error while running OCR job.';
      job.completedAt = new Date();
      job.updatedAt = new Date();
      logger.error('Unexpected OCR job failure', {
        category: 'ocr',
        metadata: { jobId: job.id, message: job.error },
      });
    })
    .finally(() => {
      activeJobId = null;
      if (jobQueue.length) {
        setImmediate(processQueue);
      }
    });
};

const executeJob = async (job) => {
  job.status = 'processing';
  job.startedAt = new Date();
  job.updatedAt = new Date();
  let hadError = false;

  for (const file of job.files) {
    file.status = 'processing';
    file.startedAt = new Date();
    file.updatedAt = new Date();

    try {
      const result = await runFileOcr(job, file);
      file.result = result;
      file.status = 'completed';
      file.completedAt = new Date();
      logger.notice('OCR file completed', {
        category: 'ocr',
        metadata: {
          jobId: job.id,
          fileId: file.id,
          filename: file.originalname,
          segments: result.segmentsCount,
        },
      });
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
          filename: file.originalname,
          message: file.error,
        },
      });
    } finally {
      file.updatedAt = new Date();
      job.updatedAt = new Date();
      file.buffer = null; // release memory once processed
    }
  }

  job.status = hadError ? 'failed' : 'completed';
  job.error = hadError ? 'One or more files failed. Expand file entries for details.' : null;
  job.completedAt = new Date();
  job.updatedAt = new Date();

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

const runFileOcr = async (job, file) => {
  const requestUrl = `${API_BASE_URL}/ocr`;
  const multipart = new FormData();
  multipart.append('file', file.buffer, {
    filename: file.originalname || `${file.id}.dat`,
    contentType: file.mimetype || 'application/octet-stream',
    knownLength: file.buffer.length,
  });
  multipart.append('prompt', job.prompt);
  multipart.append('max_new_tokens', String(job.maxNewTokens));

  logger.notice('Submitting OCR file to API', {
    category: 'ocr',
    metadata: {
      jobId: job.id,
      fileId: file.id,
      filename: file.originalname,
      sizeBytes: file.size,
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
          jobId: job.id,
          fileId: file.id,
          prompt: job.prompt,
          max_new_tokens: job.maxNewTokens,
          fileSizeBytes: file.size,
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
      imageDataUrl: file.previewDataUrl,
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
          jobId: job.id,
          fileId: file.id,
          prompt: job.prompt,
          max_new_tokens: job.maxNewTokens,
          fileSizeBytes: file.size,
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

exports.renderTool = async (_req, res) => {
  const health = await fetchHealth();
  res.render('ocr_tool', buildViewState({
    health,
    jobs: getJobsSnapshot(),
    latestUpdatedAt: getLatestUpdatedAt(),
  }));
};

exports.listJobs = (req, res) => {
  const updatedSince = coerceDate(req.query.updated_since);
  const latestUpdatedAt = getLatestUpdatedAt();
  const targetJobs = updatedSince
    ? jobStore.filter((job) => {
      const lastUpdated = getJobLastUpdated(job);
      return lastUpdated && lastUpdated > updatedSince;
    })
    : jobStore;

  res.json({
    jobs: targetJobs.map(sanitizeJob),
    latestUpdatedAt: latestUpdatedAt ? latestUpdatedAt.toISOString() : null,
    jobIds: jobStore.map((job) => job.id),
  });
};

exports.enqueueJob = (req, res) => {
  const prompt = req.body.prompt && req.body.prompt.trim() ? req.body.prompt.trim() : DEFAULT_PROMPT;
  const requestedTokens = parseInt(req.body.max_new_tokens, 10);
  const maxNewTokens = Number.isFinite(requestedTokens)
    ? clamp(requestedTokens, 1, MAX_ALLOWED_TOKENS)
    : DEFAULT_MAX_NEW_TOKENS;

  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'Please upload at least one image.' });
  }

  const job = createJobRecord(req.files, prompt, maxNewTokens, req.user);

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
    jobs: getJobsSnapshot(),
    jobId: job.id,
    latestUpdatedAt: getLatestUpdatedAt()?.toISOString() || null,
    jobIds: jobStore.map((entry) => entry.id),
  });
};
