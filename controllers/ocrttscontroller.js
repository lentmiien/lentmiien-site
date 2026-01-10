const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const EmbeddingApiService = require('../services/embeddingApiService');
const TtsService = require('../services/ttsService');
const { OcrTtsJob } = require('../database');

const DEFAULT_PROMPT = 'Detect and recognize text in the image, and output the text coordinates in a formatted manner.';
const DEFAULT_MAX_NEW_TOKENS = 2048;
const MAX_ALLOWED_TOKENS = 8192;
const MAX_COORD_VALUE = 1000;
const API_BASE_URL = process.env.OCR_API_BASE_URL || 'http://192.168.0.20:8080';
const OCR_TIMEOUT_MS = Number(process.env.OCR_API_TIMEOUT_MS || 1200000);
const OCR_PREVIEW_DIR = path.join(__dirname, '..', 'public', 'ocr_tts');
const MAX_PREVIEW_SIDE = 2048;
const OCR_EMBED_COLLECTION = 'ocr_tts_jobs';
const OCR_EMBED_CONTENT_TYPE = 'ocr_tts_text';
const OCR_PARENT_COLLECTION = 'ocr_tts';
const DEFAULT_COMBINE_SPACES = 0;
const ALLOWED_SPACE_VALUES = [0, 1];
const DEFAULT_TTS_VOICE = 'ja_shikoku_metan_normal';
const JOB_LIST_LIMIT = 50;

const logApiDebug = createApiDebugLogger('controllers/ocrttscontroller.js');
const embeddingApiService = new EmbeddingApiService();
const ttsService = new TtsService();

const resolveDefaultVoiceId = () => DEFAULT_TTS_VOICE;

const jobQueue = [];
let activeJobId = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percentOfCanvas = (value) => clamp((value / MAX_COORD_VALUE) * 100, 0, 100);

const normalizeSpaceCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && ALLOWED_SPACE_VALUES.includes(parsed)) {
    return parsed;
  }
  return DEFAULT_COMBINE_SPACES;
};

const normalizeGroup = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 60);
};

const formatPath = (storedPath) => {
  if (!storedPath) return null;
  const normalized = storedPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const TEXT_DIRECTION = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
};

const normalizeDirection = (value, fallback = TEXT_DIRECTION.HORIZONTAL) => {
  if (value === TEXT_DIRECTION.VERTICAL) return TEXT_DIRECTION.VERTICAL;
  if (value === TEXT_DIRECTION.HORIZONTAL) return TEXT_DIRECTION.HORIZONTAL;
  return fallback;
};

const guessDirection = (boxes, fallback = TEXT_DIRECTION.HORIZONTAL) => {
  if (!Array.isArray(boxes) || !boxes.length) return fallback;
  let horizontalCount = 0;
  let verticalCount = 0;

  boxes.forEach((box) => {
    if (!box) return;
    const width = Math.max(1, box.endX - box.startX);
    const height = Math.max(1, box.endY - box.startY);
    if (width > height) {
      horizontalCount += 1;
    } else if (height > width) {
      verticalCount += 1;
    }
  });

  if (verticalCount > horizontalCount) return TEXT_DIRECTION.VERTICAL;
  if (horizontalCount > verticalCount) return TEXT_DIRECTION.HORIZONTAL;
  return fallback;
};

const buildHorizontalRows = (boxes) => {
  const height = (box) => Math.max(1, box.endY - box.startY);
  const yOverlap = (a, b) => Math.max(0, Math.min(a.endY, b.endY) - Math.max(a.startY, b.startY));
  const sharesRow = (a, b) => {
    const overlap = yOverlap(a, b);
    return overlap >= 0.5 * height(a) && overlap >= 0.5 * height(b);
  };

  const sorted = boxes.sort((a, b) => (a.startY - b.startY) || (a.startX - b.startX));
  const rows = [];
  sorted.forEach((box) => {
    const targetRow = rows.find((row) => row.some((entry) => sharesRow(entry, box)));
    if (targetRow) {
      targetRow.push(box);
    } else {
      rows.push([box]);
    }
  });

  return rows.map((row) => row.sort((a, b) => a.startX - b.startX));
};

const buildVerticalColumns = (boxes) => {
  const width = (box) => Math.max(1, box.endX - box.startX);
  const xOverlap = (a, b) => Math.max(0, Math.min(a.endX, b.endX) - Math.max(a.startX, b.startX));
  const sharesColumn = (a, b) => {
    const overlap = xOverlap(a, b);
    return overlap >= 0.5 * width(a) && overlap >= 0.5 * width(b);
  };

  const sorted = boxes.sort((a, b) => (b.startX - a.startX) || (a.startY - b.startY));
  const columns = [];
  sorted.forEach((box) => {
    const targetColumn = columns.find((column) => column.some((entry) => sharesColumn(entry, box)));
    if (targetColumn) {
      targetColumn.push(box);
    } else {
      columns.push([box]);
    }
  });

  return columns.map((column) => column.sort((a, b) => a.startY - b.startY));
};

const buildEmbeddingMetadata = (job) => {
  const id = job?._id?.toString?.() || job?.id;
  if (!id) return null;
  return {
    collectionName: OCR_EMBED_COLLECTION,
    documentId: id,
    contentType: OCR_EMBED_CONTENT_TYPE,
    parentCollection: OCR_PARENT_COLLECTION,
    parentId: id,
  };
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

const buildTextsFromBoxes = (boxes, spaceCount = DEFAULT_COMBINE_SPACES, direction = 'auto') => {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    const normalizedDirection = normalizeDirection(direction);
    return {
      layoutText: '',
      paragraphText: '',
      rows: [],
      layoutDirection: normalizedDirection,
    };
  }

  const normalized = boxes
    .filter((box) => box && typeof box.text === 'string')
    .map((box) => ({
      ...box,
      text: box.text.trim(),
    }))
    .filter((box) => box.text);

  if (!normalized.length) {
    const normalizedDirection = normalizeDirection(direction);
    return {
      layoutText: '',
      paragraphText: '',
      rows: [],
      layoutDirection: normalizedDirection,
    };
  }

  const resolvedDirection = direction === 'auto'
    ? guessDirection(normalized, TEXT_DIRECTION.HORIZONTAL)
    : normalizeDirection(direction, TEXT_DIRECTION.HORIZONTAL);

  const rowGroups = resolvedDirection === TEXT_DIRECTION.VERTICAL
    ? buildVerticalColumns([...normalized])
    : buildHorizontalRows([...normalized]);

  const joiner = ' '.repeat(spaceCount);
  const rowTexts = rowGroups
    .map((row) => row
      .map((box) => (box.text || '').trim())
      .filter(Boolean)
      .join(joiner))
    .filter(Boolean);

  const layoutText = rowTexts.join('\n');
  const paragraphText = rowTexts.join(joiner);
  return {
    layoutText,
    paragraphText,
    rows: rowGroups,
    layoutDirection: resolvedDirection,
  };
};

const sanitizeAudio = (audio) => {
  if (!audio) return null;
  return {
    id: audio.id,
    voice: audio.voice,
    format: audio.format,
    status: audio.status,
    error: audio.error,
    fileName: audio.fileName,
    fileUrl: formatPath(audio.filePath),
    sizeBytes: audio.sizeBytes,
    maxNewTokens: audio.maxNewTokens,
    isDefault: Boolean(audio.isDefault),
    autoPlayedAt: audio.autoPlayedAt || null,
    createdAt: audio.createdAt,
    completedAt: audio.completedAt,
  };
};

const sanitizeJobSummary = (job) => {
  const id = job?._id?.toString?.() || job?.id;
  const defaultAudio = Array.isArray(job?.audios)
    ? job.audios.find((audio) => audio.isDefault) || job.audios[0]
    : null;
  return {
    id,
    group: job.group || null,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    startedAt: job.startedAt,
    spaceCount: job?.ocr?.spaceCount ?? DEFAULT_COMBINE_SPACES,
    embeddingStatus: job.embeddingStatus || 'pending',
    hqEmbeddingStatus: job.hqEmbeddingStatus || 'idle',
    defaultAudio: sanitizeAudio(defaultAudio),
    hasAudio: Array.isArray(job?.audios) && job.audios.length > 0,
  };
};

const sanitizeJobDetail = (job) => {
  if (!job) return null;
  const summary = sanitizeJobSummary(job);
  return {
    ...summary,
    image: job.image ? {
      originalname: job.image.originalname,
      mimetype: job.image.mimetype,
      size: job.image.size,
      previewPath: formatPath(job.image.previewPath),
    } : null,
    ocr: job.ocr ? {
      rawText: job.ocr.rawText,
      layoutText: job.ocr.layoutText,
      paragraphText: job.ocr.paragraphText,
      spaceCount: job.ocr.spaceCount ?? DEFAULT_COMBINE_SPACES,
      layoutDirection: normalizeDirection(job.ocr.layoutDirection, TEXT_DIRECTION.HORIZONTAL),
      originalLayoutDirection: normalizeDirection(
        job.ocr.originalLayoutDirection,
        job.ocr.layoutDirection || TEXT_DIRECTION.HORIZONTAL,
      ),
      overlayBoxes: Array.isArray(job.ocr.overlayBoxes) ? job.ocr.overlayBoxes : [],
      originalOverlayBoxes: Array.isArray(job.ocr.originalOverlayBoxes) ? job.ocr.originalOverlayBoxes : [],
      originalLayoutText: job.ocr.originalLayoutText || '',
      model: job.ocr.model,
      promptUsed: job.ocr.promptUsed,
      segmentsCount: job.ocr.segmentsCount,
      receivedAt: job.ocr.receivedAt,
    } : null,
    audios: Array.isArray(job.audios) ? job.audios.map(sanitizeAudio) : [],
    embeddingError: job.embeddingError || null,
    hqEmbeddingError: job.hqEmbeddingError || null,
  };
};

const savePreviewImage = async (buffer, jobId, originalname) => {
  await fs.mkdir(OCR_PREVIEW_DIR, { recursive: true });
  const safeBase = (originalname || 'image').replace(/[^a-zA-Z0-9-_]+/g, '').slice(0, 40) || 'image';
  const filename = `${jobId}-${safeBase}.jpg`;
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

  return path.join('ocr_tts', filename);
};

const runFileOcr = async (job, payload, spaceCount) => {
  const requestUrl = `${API_BASE_URL}/ocr`;
  const multipart = new FormData();
  multipart.append('file', payload.buffer, {
    filename: payload.originalname || `${job.id}.dat`,
    contentType: payload.mimetype || 'application/octet-stream',
    knownLength: payload.buffer.length,
  });
  multipart.append('prompt', job.prompt || DEFAULT_PROMPT);
  multipart.append('max_new_tokens', String(job.maxNewTokens || DEFAULT_MAX_NEW_TOKENS));

  logger.notice('Submitting OCR file to API', {
    category: 'ocr_tts',
    metadata: {
      jobId: job.id || job._id,
      filename: payload.originalname,
      sizeBytes: payload.size,
      spaceCount,
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
        category: 'ocr_tts',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    const rawText = typeof data?.text === 'string' ? data.text : '';
    const boxes = parseOcrText(rawText);
    const overlayBoxes = enrichBoxesForOverlay(boxes);
    const textResult = buildTextsFromBoxes(boxes, spaceCount, 'auto');

    return {
      rawText,
      layoutText: textResult.layoutText || rawText,
      paragraphText: textResult.paragraphText || rawText,
      layoutDirection: textResult.layoutDirection,
      originalLayoutDirection: textResult.layoutDirection,
      overlayBoxes,
      originalOverlayBoxes: overlayBoxes,
      originalLayoutText: textResult.layoutText || rawText,
      model: data?.model || 'Unknown model',
      promptUsed: data?.prompt || job.prompt,
      segmentsCount: overlayBoxes.length,
      receivedAt: new Date(),
      spaceCount,
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
        category: 'ocr_tts',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    throw new Error(message);
  }
};

const embedPrimaryText = async (job, text, { silent = false } = {}) => {
  const metadata = buildEmbeddingMetadata(job);
  if (!metadata) {
    logger.warning('Missing OCR-TTS metadata for embedding sync', {
      category: 'ocr_tts',
      metadata: { jobId: job?.id || job?._id },
    });
    return;
  }

  try {
    await embeddingApiService.embed([text], {}, [metadata]);
    job.embeddingStatus = 'stored';
    job.embeddingError = null;
    job.updatedAt = new Date();
    await job.save();
  } catch (error) {
    job.embeddingStatus = 'failed';
    job.embeddingError = error?.message || 'Failed to store embedding.';
    job.updatedAt = new Date();
    await job.save();
    logger.error('Failed to sync OCR-TTS embeddings', {
      category: 'ocr_tts',
      metadata: { jobId: job?.id || job?._id, message: job.embeddingError },
    });
    if (!silent) {
      throw error;
    }
  }
};

const setDefaultAudioFlag = (job, audioId) => {
  let found = false;
  (job.audios || []).forEach((entry) => {
    if (entry.id === audioId) {
      entry.isDefault = true;
      entry.autoPlayedAt = null;
      found = true;
    } else {
      entry.isDefault = false;
    }
  });
  return found;
};

const addAudioEntry = (job, {
  voice = resolveDefaultVoiceId(),
  format = 'wav',
  setDefault = false,
} = {}) => {
  const id = `${job.id || job._id}-audio-${randomUUID()}`;
  const fallbackVoice = resolveDefaultVoiceId();
  const entry = {
    id,
    voice: (voice || fallbackVoice).trim() || fallbackVoice,
    format: (format || 'wav').trim() || 'wav',
    status: 'queued',
    createdAt: new Date(),
    isDefault: Boolean(setDefault),
    autoPlayedAt: null,
  };
  job.audios = Array.isArray(job.audios) ? job.audios : [];
  if (entry.isDefault) {
    job.audios.forEach((audio) => { audio.isDefault = false; });
  }
  job.audios.push(entry);
  return entry;
};

const startTtsForAudio = async (jobId, audioId, text) => {
  const job = await OcrTtsJob.findById(jobId);
  if (!job) return;

  const audio = job.audios.find((entry) => entry.id === audioId);
  if (!audio) return;

  audio.status = 'processing';
  audio.error = null;
  audio.completedAt = null;
  audio.autoPlayedAt = null;
  job.updatedAt = new Date();
  await job.save();

  try {
    const targetFormat = 'wav';
    const result = await ttsService.synthesize({
      text,
      voiceId: audio.voice,
      format: targetFormat,
    });
    audio.status = 'completed';
    audio.error = null;
    audio.voice = result.voiceId || audio.voice;
    audio.format = targetFormat;
    audio.fileName = result.fileName;
    audio.filePath = path.posix.join('mp3', result.fileName);
    audio.sizeBytes = result.size;
    audio.maxNewTokens = null;
    audio.completedAt = new Date();

    logger.notice('TTS audio generated for OCR-TTS job', {
      category: 'ocr_tts',
      metadata: {
        jobId,
        audioId,
        voice: audio.voice,
        sizeBytes: result.size,
      },
    });
  } catch (error) {
    audio.status = 'failed';
    audio.error = error?.message || 'Failed to generate audio.';
    audio.completedAt = new Date();

    logger.error('Failed to generate TTS audio for OCR-TTS job', {
      category: 'ocr_tts',
      metadata: { jobId, audioId, message: audio.error },
    });
  }

  job.updatedAt = new Date();
  await job.save();
};

const ensureDefaultAudioForJob = (job, text) => {
  const hasDefault = Array.isArray(job.audios) && job.audios.some((audio) => audio.isDefault);
  if (hasDefault) {
    return job.audios.find((audio) => audio.isDefault);
  }
  const entry = addAudioEntry(job, { setDefault: true, voice: resolveDefaultVoiceId() });
  return entry;
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
      logger.error('Unexpected OCR-TTS job failure', {
        category: 'ocr_tts',
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
  const job = await OcrTtsJob.findById(queueItem.jobId);
  if (!job) {
    logger.error('OCR-TTS job not found during processing', { category: 'ocr_tts', metadata: { jobId: queueItem.jobId } });
    return;
  }

  job.status = 'processing';
  job.startedAt = job.startedAt || new Date();
  job.updatedAt = new Date();
  job.prompt = job.prompt || DEFAULT_PROMPT;
  job.maxNewTokens = job.maxNewTokens || DEFAULT_MAX_NEW_TOKENS;
  await job.save();

  let hadError = false;
  try {
    const ocrResult = await runFileOcr(job, queueItem.file, queueItem.spaceCount ?? job.ocr?.spaceCount ?? DEFAULT_COMBINE_SPACES);
    job.ocr = {
      ...ocrResult,
    };
    job.embeddingStatus = 'pending';
    job.embeddingError = null;
    job.updatedAt = new Date();

    const defaultAudio = ensureDefaultAudioForJob(job, ocrResult.paragraphText);
    await job.save();

    if (ocrResult.paragraphText && ocrResult.paragraphText.trim()) {
      await embedPrimaryText(job, ocrResult.paragraphText, { silent: true });
    } else {
      job.embeddingStatus = 'failed';
      job.embeddingError = 'OCR text is empty.';
      await job.save();
    }

    if (defaultAudio && ocrResult.paragraphText && ocrResult.paragraphText.trim()) {
      await startTtsForAudio(job.id, defaultAudio.id, ocrResult.paragraphText);
    }
  } catch (error) {
    hadError = true;
    job.error = error?.message || 'Job failed.';
    job.updatedAt = new Date();
    await job.save();
  }

  const latest = await OcrTtsJob.findById(queueItem.jobId);
  if (!latest) return;
  const defaultAudio = (latest.audios || []).find((audio) => audio.isDefault);
  const audioFailed = defaultAudio && defaultAudio.status === 'failed';
  const audioIncomplete = defaultAudio && defaultAudio.status !== 'completed' && defaultAudio.status !== 'failed';
  if (hadError || audioFailed) {
    latest.status = 'failed';
    latest.error = latest.error || (defaultAudio?.error || 'TTS failed.');
  } else if (audioIncomplete) {
    latest.status = 'processing';
  } else {
    latest.status = 'completed';
    latest.error = null;
  }
  latest.completedAt = new Date();
  latest.updatedAt = new Date();
  await latest.save();

  logger.notice('OCR-TTS job finished', {
    category: 'ocr_tts',
    metadata: {
      jobId: latest.id,
      status: latest.status,
    },
  });
};

const queryJobs = async ({ group = null, limit = JOB_LIST_LIMIT } = {}) => {
  const normalizedLimit = clamp(limit, 1, 100);
  const query = {};
  if (group) {
    query.group = group;
  }
  const jobs = await OcrTtsJob.find(query)
    .sort({ createdAt: -1 })
    .limit(normalizedLimit)
    .lean();
  const groups = await OcrTtsJob.distinct('group', { group: { $nin: [null, ''] } });
  return {
    jobs: jobs.map(sanitizeJobSummary),
    groups: groups.sort(),
  };
};

exports.renderTool = async (req, res) => {
  const group = normalizeGroup(req.query.group);
  try {
    const initial = await queryJobs({ group, limit: 20 });
    const selectedJobId = initial.jobs.length ? initial.jobs[0].id : null;
    let initialDetail = null;
    if (selectedJobId) {
      const job = await OcrTtsJob.findById(selectedJobId);
      if (job) {
        initialDetail = sanitizeJobDetail(job);
      }
    }
    let voiceData = null;
    try {
      voiceData = await ttsService.getVoices();
    } catch (err) {
      voiceData = ttsService.getCachedVoices();
      logger.warning('Unable to refresh TTS voice list for OCR-TTS tool', {
        category: 'ocr_tts',
        metadata: { message: err?.message || err },
      });
    }
    const defaultVoice = voiceData?.defaultVoiceId || DEFAULT_TTS_VOICE;

    res.render('ocr_tts_tool', {
      title: 'OCR to TTS',
      jobs: initial.jobs,
      groups: initial.groups,
      selectedJobId,
      initialJobDetail: initialDetail,
      ttsVoices: voiceData,
      defaults: {
        spaceCount: DEFAULT_COMBINE_SPACES,
        voice: defaultVoice,
      },
    });
  } catch (error) {
    logger.error('Failed to render OCR-TTS tool', {
      category: 'ocr_tts',
      metadata: { message: error?.message || error },
    });
    res.status(500).render('error_page', { error: 'Unable to load OCR to TTS tool.' });
  }
};

exports.listJobs = async (req, res) => {
  const group = normalizeGroup(req.query.group);
  try {
    const result = await queryJobs({ group });
    res.json(result);
  } catch (error) {
    logger.error('Failed to list OCR-TTS jobs', { category: 'ocr_tts', metadata: { message: error?.message || error } });
    res.status(500).json({ error: 'Unable to load OCR-TTS jobs.' });
  }
};

exports.getJobDetails = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    return res.json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to load OCR-TTS job details', { category: 'ocr_tts', metadata: { jobId, message: error?.message || error } });
    return res.status(500).json({ error: 'Unable to load job.' });
  }
};

exports.enqueueJob = async (req, res) => {
  const file = req.file;
  const spaceCount = normalizeSpaceCount(req.body?.space_count ?? req.body?.combine_spaces);
  const group = normalizeGroup(req.body?.group);

  if (!file) {
    return res.status(400).json({ error: 'Please upload one image file.' });
  }

  const jobId = randomUUID();

  try {
    const previewPath = await savePreviewImage(file.buffer, jobId, file.originalname);
    const job = new OcrTtsJob({
      _id: jobId,
      prompt: DEFAULT_PROMPT,
      maxNewTokens: DEFAULT_MAX_NEW_TOKENS,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
      group,
      owner: req.user ? { id: req.user._id?.toString?.(), name: req.user.name } : null,
      image: {
        originalname: file.originalname || 'upload',
        mimetype: file.mimetype,
        size: file.size,
        previewPath,
      },
      ocr: {
        spaceCount,
      },
      embeddingStatus: 'pending',
      hqEmbeddingStatus: 'idle',
    });

    await job.save();
    jobQueue.push({
      jobId,
      file: {
        buffer: Buffer.from(file.buffer),
        mimetype: file.mimetype,
        size: file.size,
        originalname: file.originalname || 'upload',
      },
      spaceCount,
    });
    processQueue();

    logger.notice('Queued OCR-TTS job', {
      category: 'ocr_tts',
      metadata: {
        jobId,
        spaceCount,
        group,
      },
    });

    return res.status(202).json({
      job: sanitizeJobSummary(job),
    });
  } catch (error) {
    logger.error('Failed to queue OCR-TTS job', {
      category: 'ocr_tts',
      metadata: { message: error?.message || error },
    });
    return res.status(500).json({ error: 'Failed to queue OCR-TTS job.' });
  }
};

exports.updateText = async (req, res) => {
  const { jobId } = req.params;
  const spaceCount = normalizeSpaceCount(req.body?.space_count);
  const rebuildFromBoxes = String(req.body?.rebuild_from_boxes || '').toLowerCase() === 'true';
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const requestedDirection = req.body?.direction || req.body?.layout_direction || 'auto';

  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (!job.ocr) {
      return res.status(400).json({ error: 'OCR result not ready for this job.' });
    }

    job.ocr.spaceCount = spaceCount;
    if (rebuildFromBoxes && Array.isArray(job.ocr.originalOverlayBoxes) && job.ocr.originalOverlayBoxes.length) {
      const rebuilt = buildTextsFromBoxes(job.ocr.originalOverlayBoxes, spaceCount, requestedDirection);
      job.ocr.layoutText = rebuilt.layoutText;
      job.ocr.paragraphText = rebuilt.paragraphText;
      job.ocr.layoutDirection = rebuilt.layoutDirection;
      if (!job.ocr.originalLayoutDirection) {
        job.ocr.originalLayoutDirection = rebuilt.layoutDirection;
      }
    } else if (text) {
      job.ocr.layoutText = text;
      job.ocr.paragraphText = text;
      job.ocr.layoutDirection = normalizeDirection(
        requestedDirection,
        job.ocr.layoutDirection || TEXT_DIRECTION.HORIZONTAL,
      );
    }
    if (!job.ocr.originalLayoutDirection) {
      job.ocr.originalLayoutDirection = job.ocr.layoutDirection || TEXT_DIRECTION.HORIZONTAL;
    }
    job.updatedAt = new Date();
    job.embeddingStatus = 'pending';
    job.embeddingError = null;
    await job.save();

    if (job.ocr.paragraphText && job.ocr.paragraphText.trim()) {
      await embedPrimaryText(job, job.ocr.paragraphText, { silent: true });
    }

    return res.json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to update OCR-TTS text', {
      category: 'ocr_tts',
      metadata: { jobId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to save OCR text.' });
  }
};

exports.createAudio = async (req, res) => {
  const { jobId } = req.params;
  const fallbackVoice = resolveDefaultVoiceId();
  const voice = (req.body?.voice || fallbackVoice).trim() || fallbackVoice;
  const format = (req.body?.format || 'wav').trim() || 'wav';
  const setDefault = String(req.body?.set_default || '').toLowerCase() === 'true';
  const providedText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const text = providedText || null;

  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (!job.ocr || !(job.ocr.paragraphText || text)) {
      return res.status(400).json({ error: 'OCR text is empty; run OCR first.' });
    }
    const ttsText = text || job.ocr.paragraphText;

    const audio = addAudioEntry(job, { voice, format, setDefault });
    setDefaultAudioFlag(job, audio.id);
    audio.status = 'processing';
    await job.save();

    setImmediate(() => startTtsForAudio(job.id, audio.id, ttsText));

    return res.status(202).json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to create OCR-TTS audio', {
      category: 'ocr_tts',
      metadata: { jobId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to generate audio for this job.' });
  }
};

exports.setDefaultAudio = async (req, res) => {
  const { jobId, audioId } = req.params;

  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const found = setDefaultAudioFlag(job, audioId);
    if (!found) {
      return res.status(404).json({ error: 'Audio not found.' });
    }
    job.updatedAt = new Date();
    await job.save();
    return res.json({ job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to set default OCR-TTS audio', {
      category: 'ocr_tts',
      metadata: { jobId, audioId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to update default audio.' });
  }
};

exports.markAudioPlayed = async (req, res) => {
  const { jobId, audioId } = req.params;
  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const audio = (job.audios || []).find((entry) => entry.id === audioId);
    if (!audio) {
      return res.status(404).json({ error: 'Audio not found.' });
    }
    audio.autoPlayedAt = new Date();
    job.updatedAt = new Date();
    await job.save();
    return res.json({ ok: true, job: sanitizeJobDetail(job) });
  } catch (error) {
    logger.error('Failed to mark OCR-TTS audio as played', {
      category: 'ocr_tts',
      metadata: { jobId, audioId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to update playback state.' });
  }
};

exports.embedHighQuality = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await OcrTtsJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (!job.ocr || !job.ocr.paragraphText) {
      return res.status(400).json({ error: 'OCR text is empty; save text before embedding.' });
    }
    const metadata = buildEmbeddingMetadata(job);
    if (!metadata) {
      return res.status(400).json({ error: 'Missing embedding metadata.' });
    }

    job.hqEmbeddingStatus = 'pending';
    job.hqEmbeddingError = null;
    await job.save();

    await embeddingApiService.embedHighQuality([job.ocr.paragraphText], {}, [metadata]);

    job.hqEmbeddingStatus = 'stored';
    job.hqEmbeddingError = null;
    job.updatedAt = new Date();
    await job.save();

    logger.notice('Synced OCR-TTS text to high-quality embeddings', {
      category: 'ocr_tts',
      metadata: { jobId: job.id || job._id, textLength: job.ocr.paragraphText.length },
    });

    return res.json({ ok: true, job: sanitizeJobDetail(job) });
  } catch (error) {
    const job = await OcrTtsJob.findById(req.params.jobId);
    if (job) {
      job.hqEmbeddingStatus = 'failed';
      job.hqEmbeddingError = error?.message || 'Failed to store high-quality embeddings.';
      job.updatedAt = new Date();
      await job.save();
    }
    logger.error('Failed to sync OCR-TTS text to high-quality embeddings', {
      category: 'ocr_tts',
      metadata: { jobId: req.params.jobId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Failed to store high-quality embeddings.' });
  }
};
