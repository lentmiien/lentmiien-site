const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const AsrApiService = require('../services/asrApiService');
const EmbeddingApiService = require('../services/embeddingApiService');
const { AsrJob } = require('../database');

const asrApiService = new AsrApiService();
const AUDIO_DIR = path.resolve(__dirname, '..', 'public', 'audio');
const PAGE_SIZE = 10;
const embeddingApiService = new EmbeddingApiService();
const ASR_REQUEST_TIMEOUT_MS = asrApiService.requestTimeoutMs;
const ASR_EMBED_COLLECTION = 'asr_jobs';
const ASR_EMBED_CONTENT_TYPE = 'asr_transcript';
const ASR_EMBED_PARENT = 'asr';

const ASR_DEFAULT_FORM = Object.freeze(asrApiService.defaultForm());
const defaultForm = () => ({ ...ASR_DEFAULT_FORM });
const normalizeAsrForm = (body = {}) => asrApiService.normalizeOptions(body);

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
  return asrApiService.transcribeBuffer({
    buffer: file?.buffer,
    originalName: file?.originalname,
    mimetype: file?.mimetype,
    options: normalized,
  });
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
      message = `Unable to reach the ASR API at ${asrApiService.apiBase}.`;
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
