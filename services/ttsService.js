const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.TTS_API_BASE || 'http://192.168.0.20:8080';
const TTS_GENERATE_PATH = '/tts/openaudio';
const TTS_REFERENCE_LIST_PATH = '/tts/openaudio/references/list';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'mp3');
const MAX_NEW_TOKENS_MAX = 8192;
const TOKENS_PER_500_CHARS = 1024;
const LONG_PROMPT_TOKEN_THRESHOLD = 3000;
const LONG_PROMPT_BOOST = 1.2;
const JS_FILE_NAME = 'services/ttsService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

function isJapaneseReference(referenceId) {
  if (!referenceId) return false;
  const normalized = referenceId.toLowerCase().trim();
  return normalized.endsWith('_jp');
}

class TtsService {
  constructor({ apiBase = DEFAULT_API_BASE, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.apiBase = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.outputDir = outputDir;
    this.referenceVoiceCache = {
      referenceIds: [],
      lastUpdated: null,
      lastError: null,
    };

    this.updateVoiceCache().catch((error) => {
      logger.warning('Failed to warm TTS voice cache (service)', {
        category: 'tts_service',
        metadata: {
          apiBase: this.apiBase,
          message: error?.message,
        },
      });
    });
  }

  async ensureOutputDir() {
    await fs.promises.mkdir(this.outputDir, { recursive: true });
  }

  normalizeFormat(raw) {
    const allowed = new Set(['wav', 'pcm', 'mp3', 'opus']);
    if (allowed.has(raw)) {
      return raw;
    }
    return 'mp3';
  }

  estimateMaxTokens(text, referenceId = '') {
    const length = typeof text === 'string' ? text.length : 0;
    const per500 = isJapaneseReference(referenceId) ? TOKENS_PER_500_CHARS * 2 : TOKENS_PER_500_CHARS;
    if (length <= 0) return Math.min(MAX_NEW_TOKENS_MAX, per500);
    let estimated = Math.round((length / 500) * per500) || per500;
    if (!Number.isFinite(estimated) || estimated <= 0) return Math.min(MAX_NEW_TOKENS_MAX, per500);
    if (estimated > LONG_PROMPT_TOKEN_THRESHOLD) {
      estimated = Math.round(estimated * LONG_PROMPT_BOOST);
    }
    return Math.max(1, Math.min(MAX_NEW_TOKENS_MAX, estimated));
  }

  clampMaxTokens(value, fallback) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.min(MAX_NEW_TOKENS_MAX, numeric));
  }

  async updateVoiceCache() {
    const requestUrl = `${this.apiBase}${TTS_REFERENCE_LIST_PATH}`;
    try {
      const response = await axios.get(requestUrl, { timeout: 15_000 });
      const ids = Array.isArray(response?.data?.reference_ids)
        ? response.data.reference_ids
          .filter((id) => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
        : [];

      this.referenceVoiceCache.referenceIds = ids;
      this.referenceVoiceCache.lastUpdated = new Date();
      this.referenceVoiceCache.lastError = null;

      await recordApiDebugLog({
        functionName: 'updateVoiceCache',
        requestUrl,
        requestBody: null,
        responseHeaders: response.headers || null,
        responseBody: response.data || null,
      });

      logger.notice('TTS voice cache updated (service)', {
        category: 'tts_service',
        metadata: {
          count: ids.length,
          apiBase: this.apiBase,
        },
      });

      return ids;
    } catch (error) {
      this.referenceVoiceCache.lastError = error?.message || 'Unknown error';
      await recordApiDebugLog({
        functionName: 'updateVoiceCache',
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

      return this.referenceVoiceCache.referenceIds;
    }
  }

  getCachedVoiceIds() {
    return {
      referenceIds: [...this.referenceVoiceCache.referenceIds],
      lastUpdated: this.referenceVoiceCache.lastUpdated,
      lastError: this.referenceVoiceCache.lastError,
    };
  }

  async synthesize({ text, referenceId = '', maxNewTokens, format = 'mp3' }) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text is required to synthesize TTS audio.');
    }

    const resolvedFormat = this.normalizeFormat(format || 'mp3');
    const resolvedTokens = this.clampMaxTokens(maxNewTokens, this.estimateMaxTokens(text, referenceId));
    const payload = {
      text,
      format: resolvedFormat,
      normalize: true,
      streaming: false,
      chunk_length: 200,
      max_new_tokens: resolvedTokens,
    };

    if (referenceId) {
      payload.reference_id = referenceId;
    }

    const requestUrl = `${this.apiBase}${TTS_GENERATE_PATH}`;
    const textPreview = text.replace(/\s+/g, ' ').slice(0, 120);

    logger.notice('Submitting TTS request (service)', {
      category: 'tts_service',
      metadata: {
        apiBase: this.apiBase,
        referenceId: referenceId || null,
        textLength: text.length,
        textPreview,
        maxNewTokens: resolvedTokens,
        format: resolvedFormat,
      },
    });

    try {
      const response = await axios.post(requestUrl, payload, {
        responseType: 'arraybuffer',
        timeout: 5 * 60 * 1000,
      });
      const buffer = Buffer.from(response.data);

      await this.ensureOutputDir();
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
        },
      });

      logger.notice('TTS audio generated (service)', {
        category: 'tts_service',
        metadata: {
          fileName,
          size: buffer.length,
          status: response.status,
          referenceId: referenceId || null,
          maxNewTokens: resolvedTokens,
          format: resolvedFormat,
        },
      });

      return {
        fileName,
        format: resolvedFormat,
        size: buffer.length,
        maxNewTokens: resolvedTokens,
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
          referenceId: referenceId || null,
          status: error?.response?.status,
          message: error?.message,
          format: resolvedFormat,
        },
      });
      throw error;
    }
  }
}

module.exports = TtsService;
