const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.TTS_API_BASE || 'http://192.168.0.20:8080';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'mp3');
const MAX_NEW_TOKENS_MAX = 8192;
const TOKENS_PER_500_CHARS = 1024;
const JS_FILE_NAME = 'services/ttsService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

class TtsService {
  constructor({ apiBase = DEFAULT_API_BASE, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.apiBase = apiBase;
    this.outputDir = outputDir;
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

  estimateMaxTokens(text) {
    const length = typeof text === 'string' ? text.length : 0;
    if (length <= 0) return TOKENS_PER_500_CHARS;
    const estimated = Math.round((length / 500) * TOKENS_PER_500_CHARS);
    if (!Number.isFinite(estimated) || estimated <= 0) return TOKENS_PER_500_CHARS;
    return Math.max(1, Math.min(MAX_NEW_TOKENS_MAX, estimated));
  }

  clampMaxTokens(value, fallback) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.min(MAX_NEW_TOKENS_MAX, numeric));
  }

  async synthesize({ text, referenceId = '', maxNewTokens, format = 'mp3' }) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text is required to synthesize TTS audio.');
    }

    const resolvedFormat = this.normalizeFormat(format || 'mp3');
    const resolvedTokens = this.clampMaxTokens(maxNewTokens, this.estimateMaxTokens(text));
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

    const requestUrl = `${this.apiBase}/v1/tts`;
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
