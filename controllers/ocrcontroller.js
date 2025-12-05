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

  const sorted = boxes.slice().sort((a, b) => {
    const yDiff = Math.abs(a.startY - b.startY);
    if (yDiff <= 16) {
      return a.startX - b.startX;
    }
    return a.startY - b.startY;
  });

  const lines = [];
  let currentLine = [];
  let currentBaseline = null;
  const LINE_THRESHOLD = 24;

  sorted.forEach((box) => {
    const midY = (box.startY + box.endY) / 2;
    if (!currentLine.length) {
      currentLine.push(box);
      currentBaseline = midY;
      return;
    }
    if (Math.abs(midY - currentBaseline) > LINE_THRESHOLD) {
      lines.push(currentLine);
      currentLine = [box];
      currentBaseline = midY;
    } else {
      currentLine.push(box);
      currentBaseline = (currentBaseline * (currentLine.length - 1) + midY) / currentLine.length;
    }
  });

  if (currentLine.length) {
    lines.push(currentLine);
  }

  const toLineText = (line) => {
    const fragments = [];
    let previousBox = null;
    line.forEach((box) => {
      const text = box.text.trim();
      if (!text) {
        return;
      }
      if (!previousBox) {
        fragments.push(text);
        previousBox = box;
        return;
      }

      const gap = Math.max(0, box.startX - previousBox.endX);
      let spacer = ' ';
      if (gap >= 60) {
        spacer = ' '.repeat(clamp(Math.round(gap / 30), 2, 12));
      } else if (gap <= 6) {
        spacer = '';
      }

      fragments.push(`${spacer}${text}`);
      previousBox = box;
    });

    return fragments.join('').trim();
  };

  return lines
    .map(toLineText)
    .filter(Boolean)
    .join('\n');
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
  }));
};

exports.listJobs = (_req, res) => {
  res.json({ jobs: getJobsSnapshot() });
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
  });
};
