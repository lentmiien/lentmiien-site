const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const AsrApiService = require('./asrApiService');
const TtsService = require('./ttsService');
const MessageService = require('./messageService');
const {
  AudioWorkflowJob,
  AudioWorkflowTrigger,
  AsrJob,
  Conversation5Model,
  Chat5Model,
  PendingRequests,
  Chat4Model,
  FileMetaModel,
} = require('../database');

const AUDIO_DIR = path.resolve(__dirname, '..', 'public', 'audio');
const MP3_DIR = path.resolve(__dirname, '..', 'public', 'mp3');
const DEFAULT_LLM_MODEL = process.env.AUDIO_WORKFLOW_LLM_MODEL || 'gpt-5.5';
const LEGACY_DEFAULT_TTS_VOICE = 'piper_en_amy';
const DEFAULT_TTS_VOICE_EN = process.env.AUDIO_WORKFLOW_TTS_VOICE_EN
  || process.env.AUDIO_WORKFLOW_TTS_VOICE
  || LEGACY_DEFAULT_TTS_VOICE;
const DEFAULT_TTS_VOICE_JP = process.env.AUDIO_WORKFLOW_TTS_VOICE_JP
  || process.env.AUDIO_WORKFLOW_TTS_VOICE_JA
  || 'ja_shikoku_metan_amaama';
const DEFAULT_TTS_VOICE_SV = process.env.AUDIO_WORKFLOW_TTS_VOICE_SV || 'piper_sv';
const DEFAULT_TTS_VOICE = DEFAULT_TTS_VOICE_EN;
const DEFAULT_TTS_VOICES_BY_LANGUAGE = Object.freeze({
  en: DEFAULT_TTS_VOICE_EN,
  jp: DEFAULT_TTS_VOICE_JP,
  ja: DEFAULT_TTS_VOICE_JP,
  sv: DEFAULT_TTS_VOICE_SV,
  unknown: DEFAULT_TTS_VOICE_EN,
});
const DEFAULT_TTS_FORMAT = process.env.AUDIO_WORKFLOW_TTS_FORMAT || 'wav';
const DEFAULT_CATEGORY = 'Audio workflow';
const DEFAULT_TAGS = ['audio-workflow', 'asr'];
const SUPPORTED_TRANSCRIPTION_LANGUAGES = Object.freeze(['en', 'ja', 'sv']);
const SUPPORTED_TRANSCRIPTION_LANGUAGE_SET = new Set(SUPPORTED_TRANSCRIPTION_LANGUAGES);

function parseInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value)) return value.some((entry) => parseBoolean(entry, false));
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizePhraseList(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/g);
  return Array.from(new Set(raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)));
}

function normalizeToolList(value = []) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)));
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeDetectedLanguage(language) {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (!raw || raw === 'unknown' || raw === 'und') return 'en';
  const primary = raw.split(/[-_]/)[0];
  if (primary === 'ja' || primary === 'jp') return 'jp';
  if (primary === 'sv') return 'sv';
  if (primary === 'en') return 'en';
  return 'en';
}

function normalizeSupportedTranscriptionLanguage(language) {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (!raw || raw === 'unknown' || raw === 'und') return null;
  const primary = raw.split(/[-_]/)[0];
  return primary === 'jp' ? 'ja' : primary;
}

function isSupportedTranscriptionLanguage(language) {
  const normalized = normalizeSupportedTranscriptionLanguage(language);
  return SUPPORTED_TRANSCRIPTION_LANGUAGE_SET.has(normalized);
}

function getDefaultTtsVoiceForLanguage(language) {
  const normalized = normalizeDetectedLanguage(language);
  return DEFAULT_TTS_VOICES_BY_LANGUAGE[normalized] || DEFAULT_TTS_VOICE_EN;
}

function isDefaultTtsVoiceSelection(voiceId) {
  const normalized = sanitizeText(voiceId, '');
  return !normalized
    || normalized === DEFAULT_TTS_VOICE
    || normalized === LEGACY_DEFAULT_TTS_VOICE;
}

function resolveTtsVoiceId({ detectedLanguage, triggerVoiceId } = {}) {
  const normalizedTriggerVoiceId = sanitizeText(triggerVoiceId, '');
  if (!isDefaultTtsVoiceSelection(normalizedTriggerVoiceId)) {
    return normalizedTriggerVoiceId;
  }
  return getDefaultTtsVoiceForLanguage(detectedLanguage);
}

function guessExtension(mimetype, fallbackFormat = '') {
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
  if (map[mimetype]) return map[mimetype];
  const normalizedFormat = String(fallbackFormat || '').toLowerCase();
  if (normalizedFormat.includes('wav')) return '.wav';
  if (normalizedFormat.includes('mp3')) return '.mp3';
  if (normalizedFormat.includes('webm')) return '.webm';
  return '.webm';
}

function buildStoredFileName(originalName, mimetype, format) {
  const extFromName = path.extname(originalName || '').slice(0, 8);
  const baseName = path.basename(originalName || 'audio', extFromName || undefined)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40) || 'audio';
  const ext = extFromName || guessExtension(mimetype, format);
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}${ext}`;
}

function resolvePathInside(rootDir, filePath) {
  if (!filePath) return null;
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return resolvedPath;
  }
  return null;
}

function addStoredAudioPath(paths, audio = {}) {
  if (audio.storedPath) {
    paths.add(audio.storedPath);
  }
  if (audio.storedFileName) {
    paths.add(path.join(AUDIO_DIR, audio.storedFileName));
  }
}

function buildTextContent(text) {
  return {
    text,
    image: null,
    audio: null,
    tts: null,
    transcript: null,
    revisedPrompt: null,
    imageQuality: null,
    toolOutput: null,
  };
}

function renderTemplate(template, context = {}) {
  const source = typeof template === 'string' ? template : '';
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey || singleKey;
    if (!Object.prototype.hasOwnProperty.call(context, key)) return match;
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function extractJobId(job) {
  return job?._id?.toString?.() || job?.id || null;
}

function sanitizeJob(job) {
  if (!job) return null;
  const outputAudioId = job.outputAudio && job.outputAudio.id ? job.outputAudio.id : null;
  return {
    job_id: extractJobId(job),
    status: job.status || 'queued',
    transcribed_text: job.transcriptText || '',
    detected_language: job.detectedLanguage || null,
    output_audio_id: outputAudioId,
    error: job.error || null,
    device_id: job.deviceId || null,
    audio_file_name: job.inputAudio?.storedFileName || null,
    transcribe_work_id: job.transcribeWorkId || null,
    conversation5_id: job.conversation5Id || null,
    tts_id: job.ttsId || null,
    matched_trigger_id: job.matchedTriggerId || null,
    matched_trigger_name: job.matchedTriggerName || null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    completed_at: job.completedAt || null,
  };
}

function sanitizeMissingCompletedJob(jobId) {
  return {
    job_id: jobId || null,
    status: 'completed',
    transcribed_text: '',
    detected_language: null,
    output_audio_id: null,
    error: null,
    device_id: null,
    audio_file_name: null,
    transcribe_work_id: null,
    conversation5_id: null,
    tts_id: null,
    matched_trigger_id: null,
    matched_trigger_name: null,
    created_at: null,
    updated_at: null,
    completed_at: null,
  };
}

function sanitizeTrigger(trigger) {
  if (!trigger) return null;
  return {
    id: trigger._id?.toString?.() || trigger.id,
    name: trigger.name,
    enabled: trigger.enabled !== false,
    shouldInclude: Array.isArray(trigger.shouldInclude) ? trigger.shouldInclude : [],
    shouldNotInclude: Array.isArray(trigger.shouldNotInclude) ? trigger.shouldNotInclude : [],
    systemPrompt: trigger.systemPrompt || '',
    messagePrompt: trigger.messagePrompt || '{{transcript}}',
    llmModel: trigger.llmModel || DEFAULT_LLM_MODEL,
    reasoning: trigger.reasoning || 'medium',
    verbosity: trigger.verbosity || 'medium',
    outputFormat: trigger.outputFormat || 'text',
    tools: Array.isArray(trigger.tools) ? trigger.tools : [],
    ttsEnabled: trigger.ttsEnabled !== false,
    ttsVoiceId: trigger.ttsVoiceId || DEFAULT_TTS_VOICE,
    ttsFormat: trigger.ttsFormat || DEFAULT_TTS_FORMAT,
    sortOrder: Number.isFinite(trigger.sortOrder) ? trigger.sortOrder : 0,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
  };
}

function normalizeTriggerInput(input = {}) {
  const name = sanitizeText(input.name);
  if (!name) {
    throw new Error('Trigger name is required.');
  }

  const reasoningValues = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  const verbosityValues = new Set(['low', 'medium', 'high']);
  const outputFormatValues = new Set(['text', 'json']);
  const reasoning = reasoningValues.has(input.reasoning) ? input.reasoning : 'medium';
  const verbosity = verbosityValues.has(input.verbosity) ? input.verbosity : 'medium';
  const outputFormat = outputFormatValues.has(input.outputFormat) ? input.outputFormat : 'text';

  return {
    name,
    enabled: parseBoolean(input.enabled, false),
    shouldInclude: normalizePhraseList(input.shouldInclude),
    shouldNotInclude: normalizePhraseList(input.shouldNotInclude),
    systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : '',
    messagePrompt: sanitizeText(input.messagePrompt, '{{transcript}}'),
    llmModel: sanitizeText(input.llmModel, DEFAULT_LLM_MODEL),
    reasoning,
    verbosity,
    outputFormat,
    tools: normalizeToolList(input.tools),
    ttsEnabled: parseBoolean(input.ttsEnabled, false),
    ttsVoiceId: sanitizeText(input.ttsVoiceId, DEFAULT_TTS_VOICE),
    ttsFormat: sanitizeText(input.ttsFormat, DEFAULT_TTS_FORMAT).toLowerCase().replace(/[^a-z0-9]/g, '') || DEFAULT_TTS_FORMAT,
    sortOrder: parseInteger(input.sortOrder, 0),
  };
}

function buildOwner(reqUser, fallbackName = 'audio-api') {
  if (!reqUser) return { id: null, name: fallbackName };
  return {
    id: reqUser._id?.toString?.() || String(reqUser._id || ''),
    name: reqUser.name || fallbackName,
  };
}

function extractAssistantTextFromMessages(messages = []) {
  if (!Array.isArray(messages)) return { text: '', messageId: null };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.contentType !== 'text') continue;
    if (message.user_id && message.user_id !== 'bot') continue;
    const text = typeof message.content?.text === 'string' ? message.content.text.trim() : '';
    if (!text) continue;
    return {
      text,
      messageId: message._id?.toString?.() || message.id || null,
    };
  }
  return { text: '', messageId: null };
}

class AudioWorkflowService {
  constructor({
    jobModel = AudioWorkflowJob,
    triggerModel = AudioWorkflowTrigger,
    asrJobModel = AsrJob,
    conversationModel = Conversation5Model,
    chatModel = Chat5Model,
    pendingModel = PendingRequests,
    asrApiService = new AsrApiService(),
    ttsService = new TtsService(),
    messageService = new MessageService(Chat4Model, FileMetaModel),
  } = {}) {
    this.jobModel = jobModel;
    this.triggerModel = triggerModel;
    this.asrJobModel = asrJobModel;
    this.conversationModel = conversationModel;
    this.chatModel = chatModel;
    this.pendingModel = pendingModel;
    this.asrApiService = asrApiService;
    this.ttsService = ttsService;
    this.messageService = messageService;
    this.queueRunning = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      await this.recoverInterruptedJobs();
    } catch (error) {
      logger.error('Failed to recover interrupted audio workflow jobs', {
        category: 'audio_workflow',
        metadata: { message: error?.message || error },
      });
    }
    this.kickQueue();
  }

  async recoverInterruptedJobs() {
    await this.jobModel.updateMany(
      { status: { $in: ['processing_asr', 'processing_tts'] } },
      { $set: { status: 'queued', error: null } },
    );
  }

  async ensureAudioDirectory() {
    await fs.mkdir(AUDIO_DIR, { recursive: true });
  }

  async deleteStoredAudioFiles(job, asrJob = null) {
    const paths = new Set();
    addStoredAudioPath(paths, job?.inputAudio || {});
    addStoredAudioPath(paths, asrJob || {});
    const deleted = [];

    for (const candidatePath of paths) {
      const safePath = resolvePathInside(AUDIO_DIR, candidatePath);
      if (!safePath) {
        logger.warning('Skipped unsafe audio workflow file cleanup path', {
          category: 'audio_workflow',
          metadata: {
            jobId: extractJobId(job),
            path: candidatePath,
          },
        });
        continue;
      }

      try {
        await fs.unlink(safePath);
        deleted.push(safePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger.warning('Failed to delete audio workflow file during cleanup', {
            category: 'audio_workflow',
            metadata: {
              jobId: extractJobId(job),
              path: safePath,
              message: error?.message || error,
            },
          });
        }
      }
    }

    return deleted;
  }

  async deleteDiscardedTranscriptionJob(job, asrJob = null, reason = 'discarded_transcription') {
    const jobId = extractJobId(job);
    const asrJobId = extractJobId(asrJob);
    const deletedFiles = await this.deleteStoredAudioFiles(job, asrJob);

    if (asrJobId && this.asrJobModel?.deleteOne) {
      await this.asrJobModel.deleteOne({ _id: asrJobId });
    }
    if (jobId && this.jobModel?.deleteOne) {
      await this.jobModel.deleteOne({ _id: jobId });
    }

    const logMessage = reason === 'empty_transcript'
      ? 'Audio workflow empty transcript job deleted'
      : reason === 'unsupported_language'
        ? 'Audio workflow unsupported language job deleted'
        : 'Audio workflow discarded transcription job deleted';

    logger.notice(logMessage, {
      category: 'audio_workflow',
      metadata: {
        jobId,
        asrJobId,
        reason,
        detectedLanguage: job?.detectedLanguage || asrJob?.detectedLanguage || null,
        deletedFileCount: deletedFiles.length,
      },
    });
    this.kickQueue();
  }

  async deleteEmptyTranscriptJob(job, asrJob = null) {
    await this.deleteDiscardedTranscriptionJob(job, asrJob, 'empty_transcript');
  }

  async deleteUnsupportedLanguageJob(job, asrJob = null) {
    await this.deleteDiscardedTranscriptionJob(job, asrJob, 'unsupported_language');
  }

  async saveUploadedAudio(file, fields = {}) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new Error('Audio file is required.');
    }
    await this.ensureAudioDirectory();
    const fileName = buildStoredFileName(file.originalname, file.mimetype, fields.format);
    const storedPath = path.join(AUDIO_DIR, fileName);
    await fs.writeFile(storedPath, file.buffer);
    return {
      originalName: file.originalname || null,
      storedFileName: fileName,
      storedPath,
      publicUrl: `/audio/${fileName}`,
      mimeType: file.mimetype || null,
      sizeBytes: file.buffer.length,
    };
  }

  async enqueueUpload({ file, fields = {}, user = null } = {}) {
    const inputAudio = await this.saveUploadedAudio(file, fields);
    const deviceId = sanitizeText(fields.device_id || fields.deviceId, null);
    const job = await this.jobModel.create({
      status: 'queued',
      error: null,
      deviceId,
      sampleRate: parseInteger(fields.sample_rate ?? fields.sampleRate, null),
      channels: parseInteger(fields.channels, null),
      format: sanitizeText(fields.format, null),
      owner: buildOwner(user, deviceId || 'audio-api'),
      inputAudio,
      queuedAt: new Date(),
    });

    logger.notice('Audio workflow job queued', {
      category: 'audio_workflow',
      metadata: { jobId: job._id, deviceId, fileName: inputAudio.storedFileName },
    });

    this.kickQueue();
    return sanitizeJob(job);
  }

  kickQueue() {
    if (this.queueRunning) return;
    setImmediate(() => {
      this.drainQueue().catch((error) => {
        logger.error('Audio workflow queue failed', {
          category: 'audio_workflow',
          metadata: { message: error?.message || error },
        });
      });
    });
  }

  async hasActiveJob() {
    return !!(await this.jobModel.exists({
      status: { $in: ['processing_asr', 'waiting_for_llm', 'processing_tts'] },
    }));
  }

  async drainQueue() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (true) {
        if (await this.hasActiveJob()) break;
        const job = await this.jobModel.findOneAndUpdate(
          { status: 'queued' },
          { $set: { status: 'processing_asr', startedAt: new Date(), error: null } },
          { sort: { queuedAt: 1, createdAt: 1 }, new: true },
        );
        if (!job) break;
        await this.processClaimedJob(job._id.toString());
      }
    } finally {
      this.queueRunning = false;
    }
  }

  buildAsrOptions(job) {
    const options = {
      model: 'whisper-api',
      language: 'auto',
      task: 'transcribe',
      vadFilter: true,
      beamSize: 5,
      temperature: 1.0,
      wordTimestamps: false,
    };
    if (job.sampleRate) {
      options.sampling_rate = job.sampleRate;
      options.samplingRate = job.sampleRate;
    }
    return options;
  }

  async createAsrJobRecord({ job, data = {}, request = {}, status = 'completed', error = null }) {
    const inputAudio = job.inputAudio || {};
    const transcriptText = typeof data?.text === 'string' ? data.text.trim() : '';
    const asrJob = await this.asrJobModel.create({
      sourceType: 'upload',
      originalName: inputAudio.originalName || null,
      storedFileName: inputAudio.storedFileName,
      storedPath: inputAudio.storedPath,
      publicUrl: inputAudio.publicUrl,
      mimeType: inputAudio.mimeType || null,
      sizeBytes: inputAudio.sizeBytes || 0,
      requestOptions: request.options || this.buildAsrOptions(job),
      transcriptText,
      detectedLanguage: data?.language || null,
      duration: typeof data?.duration === 'number' ? data.duration : null,
      task: request.options?.task || 'transcribe',
      model: data?.model || null,
      status,
      error,
      owner: job.owner || {},
      embeddingStatus: transcriptText ? 'pending' : 'failed',
      embeddingError: transcriptText ? null : (status === 'failed' ? 'ASR failed' : 'Transcript text is empty.'),
    });
    return asrJob;
  }

  async processClaimedJob(jobId) {
    const job = await this.jobModel.findById(jobId);
    if (!job) return;

    let asrJob = null;
    try {
      const inputAudio = job.inputAudio || {};
      const buffer = await fs.readFile(inputAudio.storedPath);
      const { data, request } = await this.asrApiService.transcribeBuffer({
        buffer,
        originalName: inputAudio.originalName || inputAudio.storedFileName || 'audio.webm',
        mimetype: inputAudio.mimeType || 'application/octet-stream',
        options: this.buildAsrOptions(job),
      });

      const transcriptText = typeof data?.text === 'string' ? data.text.trim() : '';
      asrJob = await this.createAsrJobRecord({ job, data, request, status: 'completed', error: null });

      job.asrJobId = asrJob._id.toString();
      job.transcribeWorkId = asrJob._id.toString();
      job.transcriptText = transcriptText;
      job.detectedLanguage = data?.language || null;
      job.duration = typeof data?.duration === 'number' ? data.duration : null;
      await job.save();

      logger.notice('Audio workflow ASR completed', {
        category: 'audio_workflow',
        metadata: {
          jobId,
          asrJobId: asrJob._id,
          transcriptLength: transcriptText.length,
          detectedLanguage: job.detectedLanguage,
        },
      });

      if (!transcriptText) {
        await this.deleteEmptyTranscriptJob(job, asrJob);
        return;
      }

      if (!isSupportedTranscriptionLanguage(job.detectedLanguage)) {
        await this.deleteUnsupportedLanguageJob(job, asrJob);
        return;
      }

      const trigger = await this.findBestTrigger(transcriptText);
      if (!trigger) {
        await this.completeJobWithoutOutput(jobId);
        return;
      }

      await this.startLlmForJob(jobId, trigger._id.toString());
    } catch (error) {
      if (!asrJob) {
        try {
          const latestJob = await this.jobModel.findById(jobId);
          if (latestJob) {
            const failedAsrJob = await this.createAsrJobRecord({
              job: latestJob,
              data: {},
              request: { options: this.buildAsrOptions(latestJob) },
              status: 'failed',
              error: error?.message || 'ASR failed.',
            });
            await this.jobModel.updateOne(
              { _id: jobId },
              { $set: { asrJobId: failedAsrJob._id.toString(), transcribeWorkId: failedAsrJob._id.toString() } },
            );
          }
        } catch (storeError) {
          logger.error('Failed to store failed ASR record for audio workflow', {
            category: 'audio_workflow',
            metadata: { jobId, message: storeError?.message || storeError },
          });
        }
      }
      await this.failJob(jobId, error);
    }
  }

  async findBestTrigger(transcriptText) {
    const normalizedTranscript = String(transcriptText || '').toLowerCase();
    const triggers = await this.triggerModel.find({ enabled: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    let best = null;
    let bestScore = -1;

    for (const trigger of triggers) {
      const shouldInclude = normalizePhraseList(trigger.shouldInclude);
      const shouldNotInclude = normalizePhraseList(trigger.shouldNotInclude);
      if (shouldInclude.length === 0) continue;

      const includesMatch = shouldInclude.every((phrase) => normalizedTranscript.includes(phrase.toLowerCase()));
      if (!includesMatch) continue;

      const blocked = shouldNotInclude.some((phrase) => normalizedTranscript.includes(phrase.toLowerCase()));
      if (blocked) continue;

      const score = shouldInclude.length + shouldNotInclude.length;
      if (score > bestScore) {
        best = trigger;
        bestScore = score;
      }
    }

    return best;
  }

  buildTemplateContext(job, trigger) {
    return {
      transcript: job.transcriptText || '',
      transcribed_text: job.transcriptText || '',
      job_id: job._id.toString(),
      device_id: job.deviceId || '',
      sample_rate: job.sampleRate || '',
      channels: job.channels || '',
      format: job.format || '',
      trigger_name: trigger.name || '',
    };
  }

  async startLlmForJob(jobId, triggerId) {
    const job = await this.jobModel.findById(jobId);
    const trigger = await this.triggerModel.findById(triggerId);
    if (!job || !trigger) return;

    const context = this.buildTemplateContext(job, trigger);
    const systemPrompt = renderTemplate(trigger.systemPrompt || '', context).trim();
    const messagePrompt = renderTemplate(trigger.messagePrompt || '{{transcript}}', context).trim() || job.transcriptText;
    const memberName = job.owner?.name || job.deviceId || 'audio-workflow';
    const tags = [...DEFAULT_TAGS, job.deviceId ? `device:${job.deviceId}` : null].filter(Boolean);

    const conversation = await this.conversationModel.create({
      title: `Audio workflow ${new Date().toISOString()}`,
      summary: `Audio workflow job ${job._id}`,
      category: DEFAULT_CATEGORY,
      tags,
      messages: [],
      metadata: {
        contextPrompt: systemPrompt,
        model: trigger.llmModel || DEFAULT_LLM_MODEL,
        maxMessages: 999,
        maxAudioMessages: 0,
        tools: Array.isArray(trigger.tools) ? trigger.tools : [],
        reasoning: trigger.reasoning || 'medium',
        verbosity: trigger.verbosity || 'medium',
        outputFormat: trigger.outputFormat || 'text',
      },
      members: [memberName],
    });

    const userMessage = await this.chatModel.create({
      user_id: memberName,
      category: conversation.category,
      tags: conversation.tags,
      contentType: 'text',
      content: buildTextContent(messagePrompt),
      timestamp: new Date(),
      hideFromBot: false,
    });
    conversation.messages.push(userMessage._id.toString());
    await conversation.save();

    job.matchedTriggerId = trigger._id.toString();
    job.matchedTriggerName = trigger.name;
    job.conversation5Id = conversation._id.toString();
    await job.save();

    try {
      const { response_id, msg, messages: generatedMessages } = await this.messageService.generateAIMessage({ conversation });
      const placeholderText = typeof msg?.content?.text === 'string' ? msg.content.text.trim().toLowerCase() : '';
      if (!response_id && msg?.hideFromBot && placeholderText === 'pending response') {
        if (msg._id && typeof this.chatModel.deleteOne === 'function') {
          await this.chatModel.deleteOne({ _id: msg._id }).catch(() => {});
        }
        throw new Error('Unable to queue OpenAI response for audio workflow job.');
      }

      const messagesToAppend = Array.isArray(generatedMessages) && generatedMessages.length > 0
        ? generatedMessages
        : (msg ? [msg] : []);
      const existingMessageIds = new Set(conversation.messages.map((id) => id.toString()));
      for (const generatedMessage of messagesToAppend) {
        if (!generatedMessage?._id) continue;
        const messageId = generatedMessage._id.toString();
        if (!existingMessageIds.has(messageId)) {
          conversation.messages.push(messageId);
          existingMessageIds.add(messageId);
        }
      }
      conversation.updatedAt = new Date();
      await conversation.save();

      if (response_id && msg?._id) {
        await this.pendingModel.create({
          response_id,
          conversation_id: conversation._id.toString(),
          placeholder_id: msg._id.toString(),
          sourceType: 'audio_workflow',
          sourceId: job._id.toString(),
        });
        await this.jobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              status: 'waiting_for_llm',
              conversation5Id: conversation._id.toString(),
              matchedTriggerId: trigger._id.toString(),
              matchedTriggerName: trigger.name,
              error: null,
            },
            $addToSet: { 'llm.responseIds': response_id },
          },
        );
        logger.notice('Audio workflow LLM response queued', {
          category: 'audio_workflow',
          metadata: { jobId: job._id, responseId: response_id, triggerId: trigger._id },
        });
        return;
      }

      const final = extractAssistantTextFromMessages(messagesToAppend);
      await this.finalizeLlmText(job._id.toString(), final.text, final.messageId);
    } catch (error) {
      await this.failJob(job._id.toString(), error);
    }
  }

  async handleOpenAiResponseCompleted(responseId, conversationResult = {}) {
    if (!responseId) return null;
    const job = await this.jobModel.findOne({ 'llm.responseIds': responseId });
    if (!job) return null;

    const followUpResponseIds = Array.isArray(conversationResult.followUpResponseIds)
      ? conversationResult.followUpResponseIds.filter(Boolean)
      : [];

    if (followUpResponseIds.length > 0) {
      await this.jobModel.updateOne(
        { _id: job._id },
        { $addToSet: { 'llm.responseIds': { $each: followUpResponseIds } }, $set: { status: 'waiting_for_llm' } },
      );
      return { jobId: job._id.toString(), status: 'waiting_for_llm', followUpResponseIds };
    }

    if (conversationResult.hasFunctionCalls) {
      await this.failJob(job._id.toString(), new Error('LLM requested a tool call, but no follow-up response was queued.'));
      return { jobId: job._id.toString(), status: 'failed' };
    }

    const final = extractAssistantTextFromMessages(conversationResult.messages || []);
    await this.finalizeLlmText(job._id.toString(), final.text, final.messageId);
    return { jobId: job._id.toString(), status: final.text ? 'processing_tts' : 'completed' };
  }

  async handleOpenAiResponseFailed(responseId, errorMessage = '') {
    if (!responseId) return null;
    const job = await this.jobModel.findOne({ 'llm.responseIds': responseId });
    if (!job) return null;
    await this.failJob(job._id.toString(), new Error(errorMessage || 'OpenAI response failed.'));
    return { jobId: job._id.toString(), status: 'failed' };
  }

  async finalizeLlmText(jobId, outputText, finalMessageId = null) {
    const job = await this.jobModel.findById(jobId);
    if (!job) return;

    const normalizedText = typeof outputText === 'string' ? outputText.trim() : '';
    job.llm = job.llm || {};
    job.llm.outputText = normalizedText;
    job.llm.finalMessageId = finalMessageId || job.llm.finalMessageId || null;
    job.llm.error = null;
    await job.save();

    const trigger = job.matchedTriggerId ? await this.triggerModel.findById(job.matchedTriggerId) : null;
    if (!normalizedText || !trigger || trigger.ttsEnabled === false) {
      await this.completeJobWithoutOutput(jobId);
      return;
    }

    await this.jobModel.updateOne({ _id: jobId }, { $set: { status: 'processing_tts', error: null } });

    try {
      const voiceId = resolveTtsVoiceId({
        detectedLanguage: job.detectedLanguage,
        triggerVoiceId: trigger.ttsVoiceId,
      });
      const ttsResult = await this.ttsService.synthesize({
        text: normalizedText,
        voiceId,
        format: trigger.ttsFormat || DEFAULT_TTS_FORMAT,
      });
      const outputAudioId = `${jobId}-output-${randomUUID()}`;
      await this.jobModel.updateOne(
        { _id: jobId },
        {
          $set: {
            status: 'completed',
            error: null,
            ttsId: outputAudioId,
            outputAudio: {
              id: outputAudioId,
              fileName: ttsResult.fileName,
              filePath: path.join(MP3_DIR, ttsResult.fileName),
              mimeType: ttsResult.contentType || `audio/${ttsResult.format || 'wav'}`,
              voiceId: ttsResult.voiceId || voiceId,
              format: ttsResult.format || trigger.ttsFormat || DEFAULT_TTS_FORMAT,
              sizeBytes: ttsResult.size || 0,
            },
            completedAt: new Date(),
          },
        },
      );
      logger.notice('Audio workflow TTS completed', {
        category: 'audio_workflow',
        metadata: {
          jobId,
          outputAudioId,
          fileName: ttsResult.fileName,
          detectedLanguage: job.detectedLanguage,
          voiceId: ttsResult.voiceId || voiceId,
        },
      });
      this.kickQueue();
    } catch (error) {
      await this.failJob(jobId, error);
    }
  }

  async completeJobWithoutOutput(jobId) {
    await this.jobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'completed',
          error: null,
          completedAt: new Date(),
        },
      },
    );
    this.kickQueue();
  }

  async failJob(jobId, error) {
    const message = error?.message || String(error || 'Audio workflow failed.');
    await this.jobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          error: message,
          completedAt: new Date(),
          'llm.error': message,
        },
      },
    );
    logger.error('Audio workflow job failed', {
      category: 'audio_workflow',
      metadata: { jobId, message },
    });
    this.kickQueue();
  }

  async getJobStatus(jobId) {
    const query = this.jobModel.findById(jobId);
    const job = typeof query?.lean === 'function' ? await query.lean() : await query;
    return job ? sanitizeJob(job) : sanitizeMissingCompletedJob(jobId);
  }

  async getOutputAudio(outputAudioId) {
    const job = await this.jobModel.findOne({ 'outputAudio.id': outputAudioId }).lean();
    if (!job || !job.outputAudio?.filePath) return null;
    return {
      job: sanitizeJob(job),
      outputAudioId,
      fileName: job.outputAudio.fileName || `${outputAudioId}.wav`,
      filePath: job.outputAudio.filePath,
      mimeType: job.outputAudio.mimeType || 'audio/wav',
    };
  }

  async listJobs({ limit = 50 } = {}) {
    const resolvedLimit = Math.max(1, Math.min(parseInteger(limit, 50), 200));
    const jobs = await this.jobModel.find().sort({ createdAt: -1 }).limit(resolvedLimit).lean();
    return jobs.map(sanitizeJob);
  }

  async listTriggers() {
    const triggers = await this.triggerModel.find().sort({ sortOrder: 1, name: 1 }).lean();
    return triggers.map(sanitizeTrigger);
  }

  async getTrigger(id) {
    if (!id) return null;
    const trigger = await this.triggerModel.findById(id).lean();
    return sanitizeTrigger(trigger);
  }

  async saveTrigger(input = {}, actor = 'system') {
    const normalized = normalizeTriggerInput(input);
    const update = {
      ...normalized,
      updatedBy: actor,
    };
    if (input.id) {
      const updated = await this.triggerModel.findByIdAndUpdate(
        input.id,
        { $set: update },
        { new: true, runValidators: true },
      ).lean();
      if (!updated) throw new Error('Trigger not found.');
      return sanitizeTrigger(updated);
    }
    const created = await this.triggerModel.create(update);
    return sanitizeTrigger(created);
  }

  async toggleTrigger(id, enabled) {
    const updated = await this.triggerModel.findByIdAndUpdate(
      id,
      { $set: { enabled: parseBoolean(enabled, false) } },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) throw new Error('Trigger not found.');
    return sanitizeTrigger(updated);
  }

  async deleteTrigger(id) {
    const result = await this.triggerModel.deleteOne({ _id: id });
    return result.deletedCount || 0;
  }

  getDefaultTtsVoicesByLanguage() {
    return {
      en: DEFAULT_TTS_VOICE_EN,
      jp: DEFAULT_TTS_VOICE_JP,
      sv: DEFAULT_TTS_VOICE_SV,
    };
  }
}

AudioWorkflowService.sanitizeJob = sanitizeJob;
AudioWorkflowService.sanitizeTrigger = sanitizeTrigger;
AudioWorkflowService.normalizeTriggerInput = normalizeTriggerInput;
AudioWorkflowService.normalizePhraseList = normalizePhraseList;
AudioWorkflowService.renderTemplate = renderTemplate;
AudioWorkflowService.normalizeDetectedLanguage = normalizeDetectedLanguage;
AudioWorkflowService.isSupportedTranscriptionLanguage = isSupportedTranscriptionLanguage;
AudioWorkflowService.supportedTranscriptionLanguages = [...SUPPORTED_TRANSCRIPTION_LANGUAGES];
AudioWorkflowService.getDefaultTtsVoiceForLanguage = getDefaultTtsVoiceForLanguage;
AudioWorkflowService.resolveTtsVoiceId = resolveTtsVoiceId;
AudioWorkflowService.defaultTtsVoicesByLanguage = {
  en: DEFAULT_TTS_VOICE_EN,
  jp: DEFAULT_TTS_VOICE_JP,
  sv: DEFAULT_TTS_VOICE_SV,
};

module.exports = AudioWorkflowService;
