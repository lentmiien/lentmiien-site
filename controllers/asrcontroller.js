const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const FormData = require('form-data');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const EmbeddingApiService = require('../services/embeddingApiService');
const { AsrJob } = require('../database');

const ASR_API_BASE = process.env.ASR_API_BASE || 'http://192.168.0.20:8010';
const ASR_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const AUDIO_DIR = path.resolve(__dirname, '..', 'public', 'audio');
const PAGE_SIZE = 10;
const JS_FILE_NAME = 'controllers/asrcontroller.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);
const embeddingApiService = new EmbeddingApiService();
const ASR_EMBED_COLLECTION = 'asr_jobs';
const ASR_EMBED_CONTENT_TYPE = 'asr_transcript';
const ASR_EMBED_PARENT = 'asr';

const ASR_DEFAULT_FORM = Object.freeze({
  language: 'auto',
  task: 'transcribe',
  vadFilter: true,
  beamSize: 5,
  temperature: 1.0,
  wordTimestamps: false,
});

const defaultForm = () => ({ ...ASR_DEFAULT_FORM });

function parseBooleanOption(raw, defaultValue = false) {
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  const normalized = String(raw).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function normalizeAsrForm(body = {}) {
  const defaults = defaultForm();
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : defaults.language;
  const task = body.task === 'translate' ? 'translate' : defaults.task;
  const beamSizeRaw = Number.parseInt(body.beam_size ?? body.beamSize, 10);
  const beamSize = Number.isFinite(beamSizeRaw) && beamSizeRaw > 0 ? beamSizeRaw : defaults.beamSize;
  const temperatureRaw = Number.parseFloat(body.temperature ?? body.temp);
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : defaults.temperature;
  const vadFilter = parseBooleanOption(body.vad_filter ?? body.vadFilter, defaults.vadFilter);
  const wordTimestamps = parseBooleanOption(body.word_timestamps ?? body.wordTimestamps, defaults.wordTimestamps);

  return {
    language,
    task,
    vadFilter,
    beamSize,
    temperature,
    wordTimestamps,
  };
}

function requestWantsJson(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  return accept.includes('application/json') || accept.includes('text/json') || req.xhr;
}

function buildRequestInfo(file, form) {
  return {
    fileName: file?.originalname || 'audio.webm',
    fileSize: Number.isFinite(file?.size) ? file.size : file?.buffer?.length || 0,
    mimeType: file?.mimetype || null,
    options: normalizeAsrForm(form),
  };
}

async function ensureAudioDirectory() {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
}

function guessExtension(mimetype) {
  const map = {
    'audio/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/flac': '.flac',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/m4a': '.m4a',
  };
  return map[mimetype] || '.webm';
}

function buildFileName(originalName, mimetype) {
  const extFromName = path.extname(originalName || '').slice(0, 8);
  const baseName = path.basename(originalName || 'audio', extFromName || undefined)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40) || 'audio';
  const ext = extFromName || guessExtension(mimetype);
  const suffix = randomUUID().slice(0, 8);
  return `${Date.now()}-${suffix}-${baseName}${ext}`;
}

async function saveAudioFile(file) {
  await ensureAudioDirectory();
  const fileName = buildFileName(file?.originalname, file?.mimetype);
  const storedPath = path.join(AUDIO_DIR, fileName);
  const buffer = file?.buffer || Buffer.alloc(0);
  await fs.writeFile(storedPath, buffer);
  const publicPath = path.posix.join('audio', fileName);
  return {
    fileName,
    storedPath,
    publicPath,
    sizeBytes: buffer.length,
  };
}

function buildEmbeddingMetadata(job) {
  const id = job?._id?.toString?.() || job?.id;
  return {
    collectionName: ASR_EMBED_COLLECTION,
    documentId: id,
    contentType: ASR_EMBED_CONTENT_TYPE,
    parentCollection: ASR_EMBED_PARENT,
    parentId: id,
  };
}

function sanitizeJob(job) {
  if (!job) return null;
  const id = job._id?.toString?.() || job.id;
  const rawUrl = job.publicUrl || '';
  const publicUrl = rawUrl ? (rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`) : null;
  return {
    id,
    sourceType: job.sourceType || 'upload',
    originalName: job.originalName || job.storedFileName,
    storedFileName: job.storedFileName,
    publicUrl,
    sizeBytes: job.sizeBytes || 0,
    transcriptText: job.transcriptText || '',
    detectedLanguage: job.detectedLanguage || job.requestOptions?.language || null,
    duration: job.duration || null,
    task: job.task || 'transcribe',
    model: job.model || null,
    status: job.status || 'completed',
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    embeddingStatus: job.embeddingStatus || 'pending',
    embeddingError: job.embeddingError || null,
    requestOptions: job.requestOptions || {},
  };
}

async function queryJobs(pageRaw = 1) {
  const page = Number.isFinite(parseInt(pageRaw, 10)) ? Math.max(1, parseInt(pageRaw, 10)) : 1;
  const skip = (page - 1) * PAGE_SIZE;
  const jobs = await AsrJob.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(PAGE_SIZE + 1)
    .lean();
  const hasNextPage = jobs.length > PAGE_SIZE;
  const slice = hasNextPage ? jobs.slice(0, PAGE_SIZE) : jobs;
  return {
    page,
    hasNextPage,
    hasPrevPage: page > 1,
    jobs: slice.map(sanitizeJob),
  };
}

async function transcribeAudioWithAsrApi(file, form) {
  const normalized = normalizeAsrForm(form);
  const requestUrl = `${ASR_API_BASE}/transcribe`;
  const fileName = file?.originalname || 'audio.webm';
  const requestMetadata = {
    fileName,
    fileSize: Number.isFinite(file?.size) ? file.size : file?.buffer?.length || 0,
    mimeType: file?.mimetype || null,
    options: normalized,
  };

  const formData = new FormData();
  formData.append('file', file.buffer, {
    filename: fileName,
    contentType: file?.mimetype || 'application/octet-stream',
  });
  formData.append('language', normalized.language);
  formData.append('task', normalized.task);
  formData.append('vad_filter', String(normalized.vadFilter));
  formData.append('beam_size', String(normalized.beamSize));
  formData.append('temperature', String(normalized.temperature));
  formData.append('word_timestamps', String(normalized.wordTimestamps));

  try {
    const response = await axios.post(requestUrl, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: ASR_REQUEST_TIMEOUT_MS,
    });

    await recordApiDebugLog({
      functionName: 'asr_transcribe',
      requestUrl,
      requestBody: requestMetadata,
      responseHeaders: response.headers || null,
      responseBody: response.data,
    });

    return { data: response.data, request: requestMetadata };
  } catch (error) {
    await recordApiDebugLog({
      functionName: 'asr_transcribe',
      requestUrl,
      requestBody: requestMetadata,
      responseHeaders: error?.response?.headers || null,
      responseBody: error?.response?.data || error?.message || 'Unknown error',
    });
    throw error;
  }
}

exports.renderTool = async (req, res) => {
  try {
    const { page } = req.query;
    const list = await queryJobs(page);
    res.render('asr_tool', {
      form: defaultForm(),
      jobs: list.jobs,
      page: list.page,
      hasNextPage: list.hasNextPage,
      hasPrevPage: list.hasPrevPage,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    logger.error('Failed to render ASR tool', {
      category: 'asr',
      metadata: { message: error?.message || error },
    });
    res.status(500).render('error_page', { error: 'Unable to load ASR tool right now.' });
  }
};

exports.listJobs = async (req, res) => {
  try {
    const { page } = req.query;
    const list = await queryJobs(page);
    res.json(list);
  } catch (error) {
    logger.error('Failed to list ASR jobs', {
      category: 'asr',
      metadata: { message: error?.message || error },
    });
    res.status(500).json({ error: 'Unable to load ASR jobs.' });
  }
};

exports.getJob = async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await AsrJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'ASR job not found.' });
    }
    return res.json({ job: sanitizeJob(job) });
  } catch (error) {
    logger.error('Failed to load ASR job', {
      category: 'asr',
      metadata: { jobId, message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to load ASR job.' });
  }
};

exports.transcribe = async (req, res) => {
  const wantsJson = requestWantsJson(req);
  const file = req.file;
  const form = normalizeAsrForm(req.body || {});
  const sourceType = req.body?.source === 'recording' ? 'recording' : 'upload';

  if (!file || !file.buffer) {
    const message = 'Please upload or record an audio file to transcribe.';
    if (wantsJson) {
      return res.status(400).json({ error: message });
    }
    const list = await queryJobs(1);
    return res.status(400).render('asr_tool', {
      form,
      jobs: list.jobs,
      page: list.page,
      hasNextPage: list.hasNextPage,
      hasPrevPage: list.hasPrevPage,
      pageSize: PAGE_SIZE,
      error: message,
    });
  }

  let savedAudio = null;
  try {
    savedAudio = await saveAudioFile(file);
  } catch (error) {
    logger.error('Failed to save uploaded audio', {
      category: 'asr',
      metadata: { message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to save uploaded audio file.' });
  }

  const owner = req.user ? {
    id: req.user._id?.toString?.() || String(req.user._id || ''),
    name: req.user.name,
  } : null;

  try {
    const { data, request } = await transcribeAudioWithAsrApi(file, form);
    const transcriptText = typeof data?.text === 'string' ? data.text.trim() : '';
    const job = await AsrJob.create({
      sourceType,
      originalName: file.originalname || null,
      storedFileName: savedAudio.fileName,
      storedPath: savedAudio.storedPath,
      publicUrl: `/${savedAudio.publicPath}`,
      mimeType: file.mimetype || null,
      sizeBytes: savedAudio.sizeBytes,
      requestOptions: request.options,
      transcriptText,
      detectedLanguage: data?.language || null,
      duration: typeof data?.duration === 'number' ? data.duration : null,
      task: request.options.task,
      model: data?.model || null,
      status: 'completed',
      error: null,
      owner,
      embeddingStatus: 'pending',
    });

    let embeddingStatus = 'pending';
    let embeddingError = null;

    if (transcriptText) {
      try {
        await embeddingApiService.embed(
          [transcriptText],
          {},
          [buildEmbeddingMetadata(job)],
        );
        embeddingStatus = 'stored';
        await AsrJob.updateOne({ _id: job._id }, { embeddingStatus, embeddingError: null });
        job.embeddingStatus = embeddingStatus;
      } catch (embedError) {
        embeddingStatus = 'failed';
        embeddingError = embedError?.message || 'Unable to store embeddings.';
        job.embeddingStatus = embeddingStatus;
        job.embeddingError = embeddingError;
        await AsrJob.updateOne(
          { _id: job._id },
          { embeddingStatus, embeddingError },
        );
        logger.error('Failed to sync ASR transcript embedding', {
          category: 'asr',
          metadata: {
            jobId: job._id,
            message: embeddingError,
          },
        });
      }
    } else {
      embeddingStatus = 'failed';
      embeddingError = 'Transcript text is empty.';
      job.embeddingStatus = embeddingStatus;
      job.embeddingError = embeddingError;
      await AsrJob.updateOne(
        { _id: job._id },
        { embeddingStatus, embeddingError },
      );
    }

    logger.notice('ASR transcription completed', {
      category: 'asr',
      metadata: {
        jobId: job._id,
        fileName: request.fileName,
        fileSize: request.fileSize,
        language: data?.language || request.options.language,
        task: request.options.task,
        model: data?.model,
        embeddingStatus,
      },
    });

    const payload = {
      job: sanitizeJob(job),
      result: {
        text: transcriptText,
        language: data?.language || request.options.language,
        duration: typeof data?.duration === 'number' ? data.duration : null,
        model: data?.model || null,
      },
      request,
      embeddingStatus,
      embeddingError,
    };

    return res.json(payload);
  } catch (error) {
    let status = error?.response?.status || 502;
    let message = 'Unable to transcribe audio.';

    if (error?.response) {
      const detail = typeof error.response.data === 'string' ? error.response.data.slice(0, 200) : '';
      message = `ASR API returned ${error.response.status}. ${detail}`.trim();
    } else if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      message = `Unable to reach the ASR API at ${ASR_API_BASE}.`;
    } else if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
      status = 504;
      message = `ASR API request timed out after ${ASR_REQUEST_TIMEOUT_MS}ms.`;
    }

    logger.error('ASR transcription failed', {
      category: 'asr',
      metadata: {
        error: error?.message,
        status: error?.response?.status,
        code: error?.code,
      },
    });

    if (savedAudio) {
      try {
        const failedJob = await AsrJob.create({
          sourceType,
          originalName: file.originalname || null,
          storedFileName: savedAudio.fileName,
          storedPath: savedAudio.storedPath,
          publicUrl: `/${savedAudio.publicPath}`,
          mimeType: file.mimetype || null,
          sizeBytes: savedAudio.sizeBytes,
          requestOptions: normalizeAsrForm(form),
          transcriptText: '',
          detectedLanguage: null,
          duration: null,
          task: form.task,
          model: null,
          status: 'failed',
          error: message,
          owner,
          embeddingStatus: 'failed',
          embeddingError: 'ASR failed',
        });
        return res.status(status).json({
          error: message,
          request: buildRequestInfo(file, form),
          job: sanitizeJob(failedJob),
        });
      } catch (storeError) {
        logger.error('Failed to store failed ASR job', {
          category: 'asr',
          metadata: { message: storeError?.message || storeError },
        });
      }
    }

    return res.status(status).json({ error: message });
  }
};
