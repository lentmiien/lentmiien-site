const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.ASR_API_BASE || 'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CRISPERWHISPER_TIMEOUT_MS = readPositiveInteger(
  process.env.ASR_CRISPERWHISPER_TIMEOUT_MS,
  2_800_000,
);
const JS_FILE_NAME = 'services/asrApiService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const CRISPERWHISPER_MODEL = 'crisperwhisper-2.0';
const SUPPORTED_MODELS = Object.freeze([
  'whisper-api',
  'vibevoice-asr',
  CRISPERWHISPER_MODEL,
]);

const ASR_DEFAULT_OPTIONS = Object.freeze({
  model: 'whisper-api',
  language: 'auto',
  task: 'transcribe',
  vadFilter: true,
  beamSize: 5,
  temperature: 1.0,
  wordTimestamps: false,
});

const CRISPERWHISPER_DEFAULT_OPTIONS = Object.freeze({
  modelSize: 'large',
  language: 'en',
  mode: 'verbatim',
  maxNewTokens: 256,
  hallucinationMitigation: true,
});

function readPositiveInteger(raw, fallback) {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

function normalizeOptions(body = {}) {
  const defaults = { ...ASR_DEFAULT_OPTIONS };
  const modelRaw = typeof body.model === 'string' ? body.model.trim() : '';
  const model = SUPPORTED_MODELS.includes(modelRaw) ? modelRaw : defaults.model;
  const languageRaw = typeof body.language === 'string' ? body.language.trim() : '';
  const wordTimestamps = parseBooleanOption(
    body.word_timestamps ?? body.wordTimestamps,
    defaults.wordTimestamps,
  );

  if (model === CRISPERWHISPER_MODEL) {
    const crisperDefaults = CRISPERWHISPER_DEFAULT_OPTIONS;
    const language = !languageRaw || languageRaw.toLowerCase() === 'auto'
      ? crisperDefaults.language
      : languageRaw;
    const modelSizeRaw = typeof (body.model_size ?? body.modelSize) === 'string'
      ? (body.model_size ?? body.modelSize).trim().toLowerCase()
      : '';
    const modelSize = ['small', 'medium', 'large'].includes(modelSizeRaw)
      ? modelSizeRaw
      : crisperDefaults.modelSize;
    const modeRaw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
    const mode = ['verbatim', 'intended'].includes(modeRaw)
      ? modeRaw
      : crisperDefaults.mode;
    const maxNewTokensRaw = Number.parseInt(body.max_new_tokens ?? body.maxNewTokens, 10);
    const maxNewTokens = Number.isFinite(maxNewTokensRaw) && maxNewTokensRaw >= 1 && maxNewTokensRaw <= 1024
      ? maxNewTokensRaw
      : crisperDefaults.maxNewTokens;
    const hallucinationMitigation = parseBooleanOption(
      body.hallucination_mitigation ?? body.hallucinationMitigation,
      crisperDefaults.hallucinationMitigation,
    );

    return {
      model,
      modelSize,
      language,
      mode,
      task: 'transcribe',
      wordTimestamps,
      maxNewTokens,
      hallucinationMitigation,
    };
  }

  const language = languageRaw || defaults.language;
  const task = body.task === 'translate' ? 'translate' : defaults.task;
  const beamSizeRaw = Number.parseInt(body.beam_size ?? body.beamSize, 10);
  const beamSize = Number.isFinite(beamSizeRaw) && beamSizeRaw > 0 ? beamSizeRaw : defaults.beamSize;
  const temperatureRaw = Number.parseFloat(body.temperature ?? body.temp);
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : defaults.temperature;
  const vadFilter = parseBooleanOption(body.vad_filter ?? body.vadFilter, defaults.vadFilter);
  const samplingRateRaw = Number.parseInt(body.sampling_rate ?? body.samplingRate, 10);
  const samplingRate = Number.isFinite(samplingRateRaw) && samplingRateRaw > 0 ? samplingRateRaw : null;
  const maxNewTokensRaw = Number.parseInt(body.max_new_tokens ?? body.maxNewTokens, 10);
  const maxNewTokens = Number.isFinite(maxNewTokensRaw) && maxNewTokensRaw > 0 ? maxNewTokensRaw : null;
  const hotwords = typeof body.hotwords === 'string' ? body.hotwords.trim() : '';
  const context = typeof body.context === 'string' ? body.context.trim() : '';

  const options = {
    model,
    language,
    task,
    vadFilter,
    beamSize,
    temperature,
    wordTimestamps,
  };

  if (samplingRate !== null) {
    options.samplingRate = samplingRate;
  }
  if (maxNewTokens !== null) {
    options.maxNewTokens = maxNewTokens;
  }
  if (hotwords) {
    options.hotwords = hotwords;
  }
  if (context) {
    options.context = context;
  }

  return options;
}

function buildTranscriptionFormFields(body = {}) {
  const normalized = normalizeOptions(body);
  const fields = {
    model: normalized.model,
    language: normalized.language,
    task: normalized.task,
    word_timestamps: normalized.wordTimestamps,
  };

  if (normalized.model === CRISPERWHISPER_MODEL) {
    return {
      ...fields,
      model_size: normalized.modelSize,
      mode: normalized.mode,
      max_new_tokens: normalized.maxNewTokens,
      hallucination_mitigation: normalized.hallucinationMitigation,
    };
  }

  fields.vad_filter = normalized.vadFilter;
  fields.beam_size = normalized.beamSize;
  fields.temperature = normalized.temperature;
  if (normalized.samplingRate !== undefined) fields.sampling_rate = normalized.samplingRate;
  if (normalized.maxNewTokens !== undefined) fields.max_new_tokens = normalized.maxNewTokens;
  if (normalized.hotwords) fields.hotwords = normalized.hotwords;
  if (normalized.context) fields.context = normalized.context;
  return fields;
}

class AsrApiService {
  constructor({
    apiBase = DEFAULT_API_BASE,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    crisperWhisperTimeoutMs = DEFAULT_CRISPERWHISPER_TIMEOUT_MS,
  } = {}) {
    this.apiBase = apiBase;
    this.requestTimeoutMs = readPositiveInteger(requestTimeoutMs, DEFAULT_TIMEOUT_MS);
    this.crisperWhisperTimeoutMs = readPositiveInteger(
      crisperWhisperTimeoutMs,
      DEFAULT_CRISPERWHISPER_TIMEOUT_MS,
    );
  }

  defaultForm() {
    return { ...ASR_DEFAULT_OPTIONS };
  }

  normalizeOptions(body = {}) {
    return normalizeOptions(body);
  }

  requestTimeoutForModel(model) {
    if (model === CRISPERWHISPER_MODEL) {
      return Math.max(this.requestTimeoutMs, this.crisperWhisperTimeoutMs);
    }
    return this.requestTimeoutMs;
  }

  buildRequestInfo({ buffer, originalName, mimetype }, form) {
    return {
      fileName: originalName || 'audio.webm',
      fileSize: Buffer.isBuffer(buffer) ? buffer.length : 0,
      mimeType: mimetype || null,
      options: this.normalizeOptions(form),
    };
  }

  async transcribeBuffer({ buffer, originalName = 'audio.webm', mimetype, options = {} }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Audio buffer is required for transcription.');
    }

    const normalized = this.normalizeOptions(options);
    const requestUrl = `${this.apiBase}/transcribe`;
    const requestTimeoutMs = this.requestTimeoutForModel(normalized.model);
    const requestMetadata = {
      fileName: originalName || 'audio.webm',
      fileSize: buffer.length,
      mimeType: mimetype || null,
      options: normalized,
    };

    const formData = new FormData();
    formData.append('file', buffer, {
      filename: requestMetadata.fileName,
      contentType: requestMetadata.mimeType || 'application/octet-stream',
    });
    const appendIfPresent = (key, value) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      formData.append(key, String(value));
    };
    Object.entries(buildTranscriptionFormFields(normalized)).forEach(([key, value]) => {
      appendIfPresent(key, value);
    });

    logger.notice('Submitting ASR transcription (service)', {
      category: 'asr_service',
      metadata: {
        apiBase: this.apiBase,
        fileName: requestMetadata.fileName,
        fileSize: requestMetadata.fileSize,
        mimeType: requestMetadata.mimeType,
        task: normalized.task,
        language: normalized.language,
        model: normalized.model,
      },
    });

    try {
      const response = await axios.post(requestUrl, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: requestTimeoutMs,
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
      logger.error('ASR transcription failed (service)', {
        category: 'asr_service',
        metadata: {
          apiBase: this.apiBase,
          status: error?.response?.status,
          message: error?.message,
        },
      });
      if (error && typeof error === 'object' && error.asrRequestTimeoutMs === undefined) {
        error.asrRequestTimeoutMs = requestTimeoutMs;
      }
      throw error;
    }
  }
}

module.exports = AsrApiService;
module.exports.DEFAULT_ASR_OPTIONS = ASR_DEFAULT_OPTIONS;
module.exports.CRISPERWHISPER_DEFAULT_OPTIONS = CRISPERWHISPER_DEFAULT_OPTIONS;
module.exports.CRISPERWHISPER_MODEL = CRISPERWHISPER_MODEL;
module.exports.buildTranscriptionFormFields = buildTranscriptionFormFields;
module.exports.normalizeOptions = normalizeOptions;
