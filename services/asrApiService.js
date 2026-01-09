const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.ASR_API_BASE || 'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const JS_FILE_NAME = 'services/asrApiService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const ASR_DEFAULT_OPTIONS = Object.freeze({
  language: 'auto',
  task: 'transcribe',
  vadFilter: true,
  beamSize: 5,
  temperature: 1.0,
  wordTimestamps: false,
});

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
  const language = typeof body.language === 'string' && body.language.trim()
    ? body.language.trim()
    : defaults.language;
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

class AsrApiService {
  constructor({ apiBase = DEFAULT_API_BASE, requestTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.apiBase = apiBase;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  defaultForm() {
    return { ...ASR_DEFAULT_OPTIONS };
  }

  normalizeOptions(body = {}) {
    return normalizeOptions(body);
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
    formData.append('language', normalized.language);
    formData.append('task', normalized.task);
    formData.append('vad_filter', String(normalized.vadFilter));
    formData.append('beam_size', String(normalized.beamSize));
    formData.append('temperature', String(normalized.temperature));
    formData.append('word_timestamps', String(normalized.wordTimestamps));

    logger.notice('Submitting ASR transcription (service)', {
      category: 'asr_service',
      metadata: {
        apiBase: this.apiBase,
        fileName: requestMetadata.fileName,
        fileSize: requestMetadata.fileSize,
        mimeType: requestMetadata.mimeType,
        task: normalized.task,
        language: normalized.language,
      },
    });

    try {
      const response = await axios.post(requestUrl, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: this.requestTimeoutMs,
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
      throw error;
    }
  }
}

module.exports = AsrApiService;
module.exports.DEFAULT_ASR_OPTIONS = ASR_DEFAULT_OPTIONS;
