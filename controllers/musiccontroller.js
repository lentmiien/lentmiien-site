const axios = require('axios');
const crypto = require('crypto');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const { MusicGeneration } = require('../database');
const { formatBytes } = require('../utils/metricsFormatter');
const { generateStructuredOutput } = require('../utils/OpenAI_API');
const logger = require('../utils/logger');

const JS_FILE_NAME = 'controllers/musiccontroller.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const MUSIC_API_BASE = process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080';
const MUSIC_GENERATE_ENDPOINT = '/music/acestep15/generate';
const MUSIC_OUTPUTS_ENDPOINT = '/music/acestep15/outputs';
const MUSIC_OUTPUT_ENDPOINT = '/music/acestep15/output';
const MUSIC_DEFAULT_TIMEOUT_SEC = 7200;
const MUSIC_MIN_TIMEOUT_SEC = 60;
const MUSIC_MAX_TIMEOUT_SEC = 14400;
const MUSIC_TIMEOUT_BUFFER_MS = 30 * 1000;
const MUSIC_OUTPUT_TIMEOUT_MS = 10 * 60 * 1000;
const MUSIC_OUTPUTS_DEFAULT_LIMIT = 20;
const MUSIC_OUTPUTS_MAX_LIMIT = 200;
const MUSIC_CAPTION_MAX_LENGTH = 512;
const MUSIC_LYRICS_MAX_LENGTH = 4096;
const MUSIC_BPM_MIN = 30;
const MUSIC_BPM_MAX = 300;
const MUSIC_DURATION_MIN = 10;
const MUSIC_DURATION_MAX = 600;
const MUSIC_VOCAL_LANGUAGES = [
  'unknown',
  'en',
  'ja',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ko',
  'zh',
];
const MUSIC_DEFAULT_FORM = Object.freeze({
  caption: 'Ambient techno with soft pads',
  lyrics: '',
  instrumental: false,
  bpm: null,
  vocalLanguage: 'unknown',
  durationSec: 0,
  timeoutSec: MUSIC_DEFAULT_TIMEOUT_SEC,
  loadLlm: true,
  llmBackend: 'vllm',
});
const MUSIC_JOB_RETENTION_MS = 60 * 60 * 1000;
const MUSIC_BACKGROUND_UNPLAYED_LIMIT = 2;
const musicJobs = new Map();

function parseCheckbox(value) {
  return value === 'on' || value === 'true' || value === true || value === '1';
}

function defaultMusicForm() {
  return { ...MUSIC_DEFAULT_FORM };
}

function normalizeMusicTimeout(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MUSIC_DEFAULT_TIMEOUT_SEC;
  }
  if (parsed < MUSIC_MIN_TIMEOUT_SEC) {
    return MUSIC_MIN_TIMEOUT_SEC;
  }
  if (parsed > MUSIC_MAX_TIMEOUT_SEC) {
    return MUSIC_MAX_TIMEOUT_SEC;
  }
  return parsed;
}

function normalizeMusicText(raw, maxLength) {
  if (typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeMusicBpm(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MUSIC_BPM_MIN) return MUSIC_BPM_MIN;
  if (parsed > MUSIC_BPM_MAX) return MUSIC_BPM_MAX;
  return parsed;
}

function normalizeMusicDuration(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed <= 0) return 0;
  if (parsed < MUSIC_DURATION_MIN) return MUSIC_DURATION_MIN;
  if (parsed > MUSIC_DURATION_MAX) return MUSIC_DURATION_MAX;
  return parsed;
}

function normalizeMusicVocalLanguage(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (MUSIC_VOCAL_LANGUAGES.includes(value)) {
    return value;
  }
  return MUSIC_DEFAULT_FORM.vocalLanguage;
}

function normalizeMusicForm(body = {}) {
  const caption = normalizeMusicText(body.caption, MUSIC_CAPTION_MAX_LENGTH);
  const lyrics = normalizeMusicText(body.lyrics, MUSIC_LYRICS_MAX_LENGTH);
  const instrumental = parseCheckbox(body.instrumental);
  const bpm = normalizeMusicBpm(body.bpm);
  const vocalLanguage = normalizeMusicVocalLanguage(body.vocal_language ?? body.vocalLanguage);
  const durationSec = normalizeMusicDuration(body.duration ?? body.duration_sec ?? body.durationSec);
  const timeoutSec = normalizeMusicTimeout(body.timeout_sec ?? body.timeoutSec);

  let loadLlm = null;
  const loadRaw = body.load_llm ?? body.loadLlm;
  if (loadRaw === 'true' || loadRaw === true) {
    loadLlm = true;
  } else if (loadRaw === 'false' || loadRaw === false) {
    loadLlm = false;
  }

  const llmBackend = typeof body.llm_backend === 'string' ? body.llm_backend.trim() : '';

  return {
    caption,
    lyrics,
    instrumental,
    bpm,
    vocalLanguage,
    durationSec,
    timeoutSec,
    loadLlm,
    llmBackend: llmBackend || null,
  };
}

function buildMusicRequestUrl(endpoint) {
  try {
    return new URL(endpoint, MUSIC_API_BASE).toString();
  } catch (error) {
    return `${MUSIC_API_BASE}${endpoint}`;
  }
}

function buildMusicGeneratePayload(form) {
  const payload = {
    caption: form.caption,
    timeout_sec: form.timeoutSec,
  };
  if (form.lyrics) {
    payload.lyrics = form.lyrics;
  }
  if (form.instrumental) {
    payload.instrumental = true;
  }
  if (form.loadLlm === true) {
    payload.thinking = true;
  }
  if (typeof form.bpm === 'number') {
    payload.bpm = form.bpm;
  }
  if (form.vocalLanguage) {
    payload.vocal_language = form.vocalLanguage;
  }
  if (typeof form.durationSec === 'number') {
    payload.duration = form.durationSec;
  }
  const load = {};
  if (form.loadLlm !== null) {
    load.load_llm = form.loadLlm;
  }
  if (form.llmBackend) {
    load.llm_backend = form.llmBackend;
  }
  if (Object.keys(load).length) {
    payload.load = load;
  }
  return payload;
}

function buildMusicOutputsResponse(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    ok: data.ok,
    root: data.root || null,
    jobId: data.job_id || null,
    total: data.total ?? null,
    page: data.page ?? null,
    limit: data.limit ?? null,
    pages: data.pages ?? null,
    items: items.map((item) => {
      const viewPath = item.path ? `/music/output?path=${encodeURIComponent(item.path)}` : null;
      return {
        name: item.name || item.path || 'output',
        path: item.path || null,
        sizeBytes: item.size_bytes ?? null,
        sizeLabel: typeof item.size_bytes === 'number' ? formatBytes(item.size_bytes) : null,
        modifiedTs: item.modified_ts ?? null,
        modifiedLabel: item.modified_ts ? new Date(item.modified_ts * 1000).toLocaleString('en-US') : null,
        viewUrl: viewPath,
      };
    }),
  };
}

async function fetchMusicOutputs(query) {
  const requestUrl = buildMusicRequestUrl(MUSIC_OUTPUTS_ENDPOINT);
  const params = {
    page: query.page,
    limit: query.limit,
  };
  if (query.jobId) {
    params.job_id = query.jobId;
  }

  try {
    const response = await axios.get(requestUrl, { params, timeout: 5000 });
    await recordApiDebugLog({
      functionName: 'music_outputs',
      requestUrl,
      requestBody: params,
      responseHeaders: response.headers || null,
      responseBody: response.data,
    });
    return buildMusicOutputsResponse(response.data);
  } catch (error) {
    await recordApiDebugLog({
      functionName: 'music_outputs',
      requestUrl,
      requestBody: params,
      responseHeaders: error?.response?.headers || null,
      responseBody: error?.response?.data || error?.message || 'Unknown error',
    });
    throw error;
  }
}

function buildMusicErrorMessage(error, timeoutMs) {
  let message = 'Unable to generate music.';

  if (error?.response) {
    const detail = typeof error.response.data === 'string' ? error.response.data.slice(0, 200) : '';
    message = `Music gateway returned ${error.response.status}. ${detail}`.trim();
    if (error.response.status === 429) {
      message = 'Music gateway is busy (429). Another GPU-heavy job is running.';
    }
  } else if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    message = `Unable to reach the gateway at ${MUSIC_API_BASE}.`;
  } else if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
    message = `Music request timed out after ${timeoutMs}ms.`;
  }

  return message;
}

function createJobId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleMusicJobCleanup(jobId) {
  setTimeout(() => {
    musicJobs.delete(jobId);
  }, MUSIC_JOB_RETENTION_MS);
}

function sanitizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    result: job.result,
    outputs: job.outputs,
    outputsError: job.outputsError,
    error: job.error,
    saved: job.saved || [],
    ai: job.ai || null,
  };
}

function serializeLibraryItem(entry) {
  if (!entry) return null;
  const outputPath = entry.outputPath || entry.path || null;
  const viewUrl = outputPath ? `/music/output?path=${encodeURIComponent(outputPath)}` : null;
  return {
    id: entry._id?.toString?.() || entry.id || null,
    caption: entry.caption || '',
    lyrics: entry.lyrics || '',
    instrumental: Boolean(entry.instrumental),
    bpm: entry.bpm ?? null,
    vocalLanguage: entry.vocalLanguage || MUSIC_DEFAULT_FORM.vocalLanguage,
    durationSec: entry.durationSec ?? null,
    promptSource: entry.promptSource || 'manual',
    rating: Number.isFinite(entry.rating) ? entry.rating : null,
    ratingAt: entry.ratingAt || null,
    lastPlayedAt: entry.lastPlayedAt || null,
    createdAt: entry.createdAt || null,
    outputName: entry.outputName || entry.outputPath || 'output',
    outputPath,
    outputSizeBytes: entry.outputSizeBytes ?? null,
    outputSizeLabel: typeof entry.outputSizeBytes === 'number' ? formatBytes(entry.outputSizeBytes) : null,
    outputModifiedAt: entry.outputModifiedAt || null,
    viewUrl,
  };
}

async function persistMusicOutputs({ form, outputs, jobId, source, aiPromptInput }) {
  const items = Array.isArray(outputs?.items) ? outputs.items : [];
  if (!items.length) return [];
  const savedEntries = [];
  const now = new Date();

  for (const item of items) {
    if (!item.path) continue;
    const outputModifiedAt = item.modifiedTs ? new Date(item.modifiedTs * 1000) : null;
    const update = {
      $set: {
        jobId: jobId || null,
        outputName: item.name || item.path || 'output',
        outputSizeBytes: item.sizeBytes ?? null,
        outputModifiedAt,
        caption: form.caption,
        lyrics: form.lyrics,
        instrumental: Boolean(form.instrumental),
        bpm: typeof form.bpm === 'number' ? form.bpm : null,
        vocalLanguage: form.vocalLanguage,
        durationSec: typeof form.durationSec === 'number' ? form.durationSec : null,
        promptSource: source,
        aiPromptInput: aiPromptInput || null,
        updatedAt: now,
      },
      $setOnInsert: {
        outputPath: item.path,
        createdAt: now,
      },
    };

    try {
      const doc = await MusicGeneration.findOneAndUpdate(
        { outputPath: item.path },
        update,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      if (doc) savedEntries.push(doc);
    } catch (error) {
      logger.error('Failed to save music output', {
        category: 'music_library',
        metadata: { error: error.message, outputPath: item.path },
      });
    }
  }

  return savedEntries;
}

function startMusicJob({ form, requestPayload, user, source = 'manual', aiPromptInput = null, aiOutput = null }) {
  const id = createJobId();
  const timeoutMs = (form.timeoutSec * 1000) + MUSIC_TIMEOUT_BUFFER_MS;
  const job = {
    id,
    status: 'queued',
    form,
    requestPayload,
    result: null,
    outputs: null,
    outputsError: null,
    error: null,
    createdAt: Date.now(),
    user,
    source,
    ai: aiOutput ? { output: aiOutput } : null,
    saved: [],
  };

  musicJobs.set(id, job);
  scheduleMusicJobCleanup(id);

  setImmediate(async () => {
    job.status = 'processing';
    logger.debug('Music generation job started', {
      category: 'music_library',
      metadata: {
        jobId: id,
        captionLength: form.caption.length,
        user,
      },
    });

    try {
      const requestUrl = buildMusicRequestUrl(MUSIC_GENERATE_ENDPOINT);
      const response = await axios.post(requestUrl, requestPayload, { timeout: timeoutMs });
      await recordApiDebugLog({
        functionName: 'music_generate',
        requestUrl,
        requestBody: requestPayload,
        responseHeaders: response.headers || null,
        responseBody: response.data,
      });

      job.result = response.data;
      job.status = 'completed';

      if (job.result?.job_id) {
        try {
          const outputsQuery = {
            jobId: job.result.job_id,
            page: 1,
            limit: MUSIC_OUTPUTS_DEFAULT_LIMIT,
          };
          job.outputs = await fetchMusicOutputs(outputsQuery);
        } catch (error) {
          const statusCode = error?.response?.status;
          job.outputsError = statusCode
            ? `Outputs request failed with ${statusCode}.`
            : (error?.message || 'Unable to fetch outputs for this job.');
        }
      }

      if (job.outputs) {
        const saved = await persistMusicOutputs({
          form: job.form,
          outputs: job.outputs,
          jobId: job.result?.job_id || null,
          source,
          aiPromptInput,
        });
        job.saved = saved.map(serializeLibraryItem).filter(Boolean);
      }

      logger.notice('Music generation completed', {
        category: 'music_library',
        metadata: {
          jobId: job.result?.job_id || null,
          captionLength: form.caption.length,
          hasOutputs: Boolean(job.outputs && job.outputs.items && job.outputs.items.length),
        },
      });
    } catch (error) {
      await recordApiDebugLog({
        functionName: 'music_generate',
        requestUrl: buildMusicRequestUrl(MUSIC_GENERATE_ENDPOINT),
        requestBody: requestPayload,
        responseHeaders: error?.response?.headers || null,
        responseBody: error?.response?.data || error?.message || 'Unknown error',
      });

      job.status = 'failed';
      job.error = buildMusicErrorMessage(error, timeoutMs);

      logger.error('Music generation failed', {
        category: 'music_library',
        metadata: {
          error: error?.message,
          status: error?.response?.status,
          code: error?.code,
        },
      });
    }
  });

  return job;
}

function normalizeRating(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 5) return null;
  return parsed;
}

function normalizeMinRating(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  if (parsed > 5) return 5;
  return parsed;
}

async function countUnplayedTracks() {
  return MusicGeneration.countDocuments({
    $or: [
      { lastPlayedAt: { $exists: false } },
      { lastPlayedAt: null },
    ],
  });
}

async function shouldSkipBackgroundGeneration(req) {
  const isBackground = parseCheckbox(req.body?.background);
  if (!isBackground) {
    return { skip: false, unplayedCount: null };
  }

  const unplayedCount = await countUnplayedTracks();
  if (unplayedCount >= MUSIC_BACKGROUND_UNPLAYED_LIMIT) {
    return { skip: true, unplayedCount };
  }

  return { skip: false, unplayedCount };
}

function computeWeightedRandom(candidates, { includeUnrated }) {
  if (!candidates.length) return null;
  const now = Date.now();
  const weights = candidates.map((entry) => {
    const rating = Number.isFinite(entry.rating) ? entry.rating : null;
    if (rating === null && !includeUnrated) return 0;
    const ratingWeight = rating === null ? 7 : Math.max(1, rating + 1);
    const lastPlayed = entry.lastPlayedAt ? new Date(entry.lastPlayedAt).getTime() : 0;
    const hoursSince = lastPlayed ? Math.max(0, (now - lastPlayed) / 3600000) : 24;
    const recencyFactor = Math.min(3, 0.25 + (hoursSince / 12));
    return ratingWeight * recencyFactor;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return candidates[0];
  let threshold = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    threshold -= weights[i];
    if (threshold <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

async function sampleTopRatedExamples() {
  const tiers = [5, 4, 3];
  for (const minRating of tiers) {
    const samples = await MusicGeneration.aggregate([
      { $match: { rating: { $gte: minRating } } },
      { $sample: { size: 3 } },
      { $project: { caption: 1, lyrics: 1, vocalLanguage: 1, durationSec: 1, bpm: 1, rating: 1 } },
    ]);
    if (samples.length >= 2 || (samples.length > 0 && minRating === 3)) {
      return samples;
    }
  }
  return [];
}

function buildAiPrompt({ direction, examples }) {
  const exampleText = examples.length
    ? examples.map((ex, index) => {
      const caption = ex.caption || '';
      const lyrics = ex.lyrics || '';
      const vocalLanguage = ex.vocalLanguage || 'unknown';
      const durationSec = Number.isFinite(ex.durationSec) ? ex.durationSec : 'auto';
      return `Example ${index + 1}:\ncaption: ${caption}\nlyrics: ${lyrics || '[instrumental]'}\nvocal_language: ${vocalLanguage}\nduration_seconds: ${durationSec}`;
    }).join('\n\n')
    : 'No prior examples available.';

  const userDirection = direction
    ? `User direction: ${direction.trim()}`
    : 'User direction: none.';

  return `You generate prompts for a music generation model.\n\n${userDirection}\n\nUse the following high-rated examples for style guidance (similar vibe, but clearly different):\n\n${exampleText}\n\nReturn a NEW prompt that is similar in vibe but not a copy.\n- caption must be concise (<= ${MUSIC_CAPTION_MAX_LENGTH} chars)\n- lyrics should be empty for instrumental tracks, otherwise include short lyrics (<= ${MUSIC_LYRICS_MAX_LENGTH} chars)\n- vocal_language must be one of: ${MUSIC_VOCAL_LANGUAGES.join(', ')}\n- duration_seconds must be between ${MUSIC_DURATION_MIN} and ${MUSIC_DURATION_MAX}\n`;
}

function normalizeAiOutput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const caption = normalizeMusicText(raw.caption, MUSIC_CAPTION_MAX_LENGTH);
  const lyrics = normalizeMusicText(raw.lyrics, MUSIC_LYRICS_MAX_LENGTH);
  const vocalLanguage = normalizeMusicVocalLanguage(raw.vocal_language || raw.vocalLanguage);
  const durationSec = normalizeMusicDuration(raw.duration_seconds ?? raw.durationSec ?? raw.duration);

  if (!caption) return null;

  return {
    caption,
    lyrics,
    vocalLanguage,
    durationSec,
  };
}

exports.music_page = async (req, res) => {
  try {
    const libraryDocs = await MusicGeneration.find()
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();
    const library = libraryDocs.map(serializeLibraryItem).filter(Boolean);

    res.render('music_library', {
      apiBase: MUSIC_API_BASE,
      form: defaultMusicForm(),
      library,
      vocalLanguages: MUSIC_VOCAL_LANGUAGES,
      limits: {
        minTimeout: MUSIC_MIN_TIMEOUT_SEC,
        maxTimeout: MUSIC_MAX_TIMEOUT_SEC,
        maxOutputs: MUSIC_OUTPUTS_MAX_LIMIT,
        maxCaption: MUSIC_CAPTION_MAX_LENGTH,
        maxLyrics: MUSIC_LYRICS_MAX_LENGTH,
        bpmMin: MUSIC_BPM_MIN,
        bpmMax: MUSIC_BPM_MAX,
        durationMin: MUSIC_DURATION_MIN,
        durationMax: MUSIC_DURATION_MAX,
      },
      defaults: {
        minRating: 2,
        includeUnrated: true,
      },
    });
  } catch (error) {
    logger.error('Failed to render music library', {
      category: 'music_library',
      metadata: { error: error.message },
    });
    res.status(500).send('Unable to load music library.');
  }
};

exports.music_generate = async (req, res) => {
  try {
    const backgroundGate = await shouldSkipBackgroundGeneration(req);
    if (backgroundGate.skip) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Background generation paused: ${backgroundGate.unplayedCount} unplayed tracks in library.`,
        unplayedCount: backgroundGate.unplayedCount,
      });
    }
  } catch (error) {
    logger.error('Failed to check background generation gate', {
      category: 'music_library',
      metadata: { error: error.message },
    });
  }

  const form = normalizeMusicForm(req.body || {});
  const requestPayload = buildMusicGeneratePayload(form);

  if (!form.caption) {
    return res.status(400).json({ error: 'Please enter a caption or prompt to generate music.' });
  }

  const job = startMusicJob({
    form,
    requestPayload,
    user: req.user?.name || 'unknown',
    source: 'manual',
  });

  return res.json({ ok: true, job: sanitizeJob(job) });
};

exports.music_generate_ai = async (req, res) => {
  const directionRaw = typeof req.body?.direction === 'string' ? req.body.direction.trim() : '';
  try {
    const backgroundGate = await shouldSkipBackgroundGeneration(req);
    if (backgroundGate.skip) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Background generation paused: ${backgroundGate.unplayedCount} unplayed tracks in library.`,
        unplayedCount: backgroundGate.unplayedCount,
      });
    }

    const examples = await sampleTopRatedExamples();
    const prompt = buildAiPrompt({ direction: directionRaw, examples });
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        caption: { type: 'string' },
        lyrics: { type: 'string' },
        vocal_language: { type: 'string', enum: MUSIC_VOCAL_LANGUAGES },
        duration_seconds: { type: 'integer', minimum: MUSIC_DURATION_MIN, maximum: MUSIC_DURATION_MAX },
      },
      required: ['caption', 'lyrics', 'vocal_language', 'duration_seconds'],
    };

    const aiRaw = await generateStructuredOutput({
      model: 'gpt-5.2-2025-12-11',
      prompt,
      schema,
      schemaName: 'music_prompt',
      temperature: 0.7,
    });

    const aiOutput = normalizeAiOutput(aiRaw);
    if (!aiOutput) {
      return res.status(502).json({ error: 'AI prompt generation failed. Please try again.' });
    }

    const form = defaultMusicForm();
    form.caption = aiOutput.caption;
    form.lyrics = aiOutput.lyrics;
    form.vocalLanguage = aiOutput.vocalLanguage;
    form.durationSec = aiOutput.durationSec;

    const requestPayload = buildMusicGeneratePayload(form);

    const job = startMusicJob({
      form,
      requestPayload,
      user: req.user?.name || 'unknown',
      source: 'ai',
      aiPromptInput: directionRaw || null,
      aiOutput,
    });

    return res.json({ ok: true, job: sanitizeJob(job), ai: aiOutput });
  } catch (error) {
    logger.error('Failed to generate AI music prompt', {
      category: 'music_library',
      metadata: { error: error.message },
    });
    return res.status(500).json({ error: 'Unable to generate AI prompt.' });
  }
};

exports.music_status = (req, res) => {
  const jobId = req.params?.id;
  const job = jobId ? musicJobs.get(jobId) : null;

  if (!job) {
    return res.status(404).json({ status: 'not_found' });
  }

  return res.json(sanitizeJob(job));
};

exports.music_output = async (req, res) => {
  const pathParam = typeof req.query?.path === 'string' ? req.query.path.trim() : '';
  if (!pathParam) {
    return res.status(400).send('Missing output path.');
  }

  const requestUrl = buildMusicRequestUrl(MUSIC_OUTPUT_ENDPOINT);

  try {
    const response = await axios.get(requestUrl, {
      params: { path: pathParam },
      responseType: 'stream',
      timeout: MUSIC_OUTPUT_TIMEOUT_MS,
    });

    res.status(response.status);
    if (response.headers?.['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers?.['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers?.['content-disposition']) {
      res.setHeader('Content-Disposition', response.headers['content-disposition']);
    }

    return response.data.pipe(res);
  } catch (error) {
    const statusCode = error?.response?.status || 502;
    res.status(statusCode);
    if (error?.response?.data) {
      return res.send('Unable to fetch output from gateway.');
    }
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      return res.send(`Unable to reach the gateway at ${MUSIC_API_BASE}.`);
    }
    return res.send('Unable to fetch output from gateway.');
  }
};

exports.music_library_list = async (req, res) => {
  const limitRaw = Number.parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, 200)
    : 40;

  const docs = await MusicGeneration.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return res.json({
    items: docs.map(serializeLibraryItem).filter(Boolean),
  });
};

exports.music_library_random = async (req, res) => {
  const minRating = normalizeMinRating(req.query?.minRating);
  const includeUnrated = parseCheckbox(req.query?.includeUnrated);

  const filter = includeUnrated
    ? { $or: [{ rating: { $gte: minRating } }, { rating: null }] }
    : { rating: { $gte: minRating } };

  const candidates = await MusicGeneration.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  if (!candidates.length) {
    return res.status(404).json({ error: 'No matching tracks found.' });
  }

  const selected = computeWeightedRandom(candidates, { includeUnrated });
  if (!selected) {
    return res.status(404).json({ error: 'No matching tracks found.' });
  }

  return res.json({ item: serializeLibraryItem(selected) });
};

exports.music_library_rate = async (req, res) => {
  const id = req.params?.id;
  const rating = normalizeRating(req.body?.rating);

  if (!id) {
    return res.status(400).json({ error: 'Missing music id.' });
  }
  if (rating === null) {
    return res.status(400).json({ error: 'Rating must be an integer between 0 and 5.' });
  }

  if (rating === 0) {
    await MusicGeneration.deleteOne({ _id: id });
    return res.json({ deleted: true });
  }

  const updated = await MusicGeneration.findOneAndUpdate(
    { _id: id },
    { $set: { rating, ratingAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    return res.status(404).json({ error: 'Music entry not found.' });
  }

  return res.json({ item: serializeLibraryItem(updated) });
};

exports.music_library_played = async (req, res) => {
  const id = req.params?.id;
  if (!id) {
    return res.status(400).json({ error: 'Missing music id.' });
  }

  const updated = await MusicGeneration.findOneAndUpdate(
    { _id: id },
    { $set: { lastPlayedAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    return res.status(404).json({ error: 'Music entry not found.' });
  }

  return res.json({ item: serializeLibraryItem(updated) });
};
