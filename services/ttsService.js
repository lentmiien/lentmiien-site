const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.TTS_API_BASE || 'http://192.168.0.20:8080';
const TTS_GENERATE_PATH = '/tts';
const TTS_VOICE_LIST_PATH = '/tts/voices';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'mp3');
const JS_FILE_NAME = 'services/ttsService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const CONTENT_TYPE_EXTENSION_MAP = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

class TtsService {
  constructor({ apiBase = DEFAULT_API_BASE, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.apiBase = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.outputDir = outputDir;
    this.voiceCache = {
      voices: [],
      defaultVoiceId: null,
      lastUpdated: null,
      lastError: null,
    };

    this.refreshVoiceCache().catch((error) => {
      logger.warning('Failed to warm TTS voice cache (service)', {
        category: 'tts_service',
        metadata: { apiBase: this.apiBase, message: error?.message },
      });
    });
  }

  async ensureOutputDir() {
    await fs.promises.mkdir(this.outputDir, { recursive: true });
  }

  sanitizeVoiceList(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList
      .filter((entry) => entry && typeof entry.voice_id === 'string')
      .map((entry) => ({
        voiceId: entry.voice_id.trim(),
        backend: typeof entry.backend === 'string' ? entry.backend.trim() : null,
        displayName: typeof entry.display_name === 'string'
          ? entry.display_name.trim()
          : (typeof entry.displayName === 'string' ? entry.displayName.trim() : entry.voice_id.trim()),
        language: typeof entry.language === 'string' ? entry.language.trim() : null,
      }))
      .filter((entry) => entry.voiceId.length > 0);
  }

  resolveFileExtension(preferredFormat, headers) {
    const normalizedPreferred = typeof preferredFormat === 'string'
      ? preferredFormat.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
      : '';
    if (normalizedPreferred) {
      return normalizedPreferred;
    }
    const contentType = headers?.['content-type'] || headers?.['Content-Type'] || '';
    const baseType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
    if (baseType && CONTENT_TYPE_EXTENSION_MAP[baseType]) {
      return CONTENT_TYPE_EXTENSION_MAP[baseType];
    }
    return 'wav';
  }

  async refreshVoiceCache() {
    const requestUrl = `${this.apiBase}${TTS_VOICE_LIST_PATH}`;
    try {
      const response = await axios.get(requestUrl, { timeout: 15_000 });
      const voices = this.sanitizeVoiceList(response?.data?.voices);
      const defaultVoiceId = typeof response?.data?.default_voice === 'string'
        ? response.data.default_voice.trim()
        : null;

      this.voiceCache.voices = voices;
      this.voiceCache.defaultVoiceId = defaultVoiceId || null;
      this.voiceCache.lastUpdated = new Date();
      this.voiceCache.lastError = null;

      await recordApiDebugLog({
        functionName: 'refreshVoiceCache',
        requestUrl,
        requestBody: null,
        responseHeaders: response.headers || null,
        responseBody: response.data || null,
      });

      logger.notice('TTS voice cache updated (service)', {
        category: 'tts_service',
        metadata: { count: voices.length, apiBase: this.apiBase, defaultVoiceId },
      });

      return this.getCachedVoices();
    } catch (error) {
      this.voiceCache.lastError = error?.message || 'Unknown error';
      await recordApiDebugLog({
        functionName: 'refreshVoiceCache',
        requestUrl,
        requestBody: null,
        responseHeaders: error?.response?.headers || null,
        responseBody: error?.response?.data || error?.message || 'Unknown error',
      });

      logger.error('Failed to update TTS voice cache (service)', {
        category: 'tts_service',
        metadata: {
          apiBase: this.apiBase,
          message: error?.message,
          status: error?.response?.status,
        },
      });

      return this.getCachedVoices();
    }
  }

  getCachedVoices() {
    return {
      voices: [...this.voiceCache.voices],
      defaultVoiceId: this.voiceCache.defaultVoiceId || null,
      lastUpdated: this.voiceCache.lastUpdated,
      lastError: this.voiceCache.lastError,
    };
  }

  async getVoices({ forceRefresh = false } = {}) {
    if (forceRefresh || this.voiceCache.voices.length === 0) {
      await this.refreshVoiceCache();
    }
    return this.getCachedVoices();
  }

  getDefaultVoiceId() {
    return this.voiceCache.defaultVoiceId || null;
  }

  async resolveVoiceId(requestedVoiceId = '') {
    const normalized = typeof requestedVoiceId === 'string' ? requestedVoiceId.trim() : '';
    const hasVoice = (id) => !!id && this.voiceCache.voices.some((entry) => entry.voiceId === id);

    const primaryChoice = normalized || this.voiceCache.defaultVoiceId || null;
    if (hasVoice(primaryChoice)) {
      return { voiceId: primaryChoice, refreshed: false };
    }

    const refreshed = await this.refreshVoiceCache();
    const secondaryChoice = normalized || refreshed.defaultVoiceId || null;
    if (hasVoice(secondaryChoice)) {
      return { voiceId: secondaryChoice, refreshed: true };
    }

    const error = new Error(normalized
      ? `Unknown voice id "${normalized}". Refresh the voice list and try again.`
      : 'No voice id available from the TTS service.');
    error.code = 'VOICE_NOT_FOUND';
    throw error;
  }

  async synthesize({ text, voiceId, format } = {}) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText) {
      throw new Error('Text is required to synthesize TTS audio.');
    }

    const { voiceId: resolvedVoiceId } = await this.resolveVoiceId(voiceId);
    const payload = {
      text: normalizedText,
      voice_id: resolvedVoiceId,
    };

    const requestUrl = `${this.apiBase}${TTS_GENERATE_PATH}`;
    const textPreview = normalizedText.replace(/\s+/g, ' ').slice(0, 120);

    logger.notice('Submitting TTS request (service)', {
      category: 'tts_service',
      metadata: {
        apiBase: this.apiBase,
        voiceId: resolvedVoiceId,
        textLength: normalizedText.length,
        textPreview,
      },
    });

    try {
      const response = await axios.post(requestUrl, payload, {
        responseType: 'arraybuffer',
        timeout: 6 * 60 * 60 * 1000,
      });
      const buffer = Buffer.from(response.data);

      await this.ensureOutputDir();
      const resolvedFormat = this.resolveFileExtension(format, response.headers);
      const fileName = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${resolvedFormat}`;
      const filePath = path.join(this.outputDir, fileName);
      await fs.promises.writeFile(filePath, buffer);

      await recordApiDebugLog({
        functionName: 'synthesize',
        requestUrl,
        requestBody: payload,
        responseHeaders: response.headers || null,
        responseBody: {
          status: response.status,
          statusText: response.statusText,
          size: buffer.length,
          format: resolvedFormat,
          voiceId: resolvedVoiceId,
        },
      });

      logger.notice('TTS audio generated (service)', {
        category: 'tts_service',
        metadata: {
          fileName,
          size: buffer.length,
          status: response.status,
          voiceId: resolvedVoiceId,
          contentType: response?.headers?.['content-type'] || null,
          format: resolvedFormat,
        },
      });

      return {
        fileName,
        format: resolvedFormat,
        size: buffer.length,
        voiceId: resolvedVoiceId,
        contentType: response?.headers?.['content-type'] || null,
      };
    } catch (error) {
      await recordApiDebugLog({
        functionName: 'synthesize',
        requestUrl,
        requestBody: payload,
        responseHeaders: error?.response?.headers || null,
        responseBody: error?.response?.data || error?.message || 'Unknown error',
      });

      logger.error('TTS request failed (service)', {
        category: 'tts_service',
        metadata: {
          apiBase: this.apiBase,
          voiceId: voiceId || null,
          status: error?.response?.status,
          message: error?.message,
          format: format || null,
        },
      });
      throw error;
    }
  }
}

module.exports = TtsService;
