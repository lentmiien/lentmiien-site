const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.EMBED_API_BASE || 'http://192.168.0.20:8001';
const DEFAULT_TIMEOUT_MS = 15000;
const JS_FILE_NAME = 'services/embeddingApiService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

class EmbeddingApiService {
  constructor({ apiBase = DEFAULT_API_BASE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetch !== 'function') {
      throw new Error('Global fetch API is unavailable. Upgrade to Node 18+ or polyfill fetch.');
    }

    this.apiBase = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : DEFAULT_API_BASE;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  get baseUrl() {
    return this.apiBase;
  }

  buildUrl(pathname = '') {
    if (!pathname) return this.apiBase;
    if (pathname.startsWith('http')) return pathname;
    return `${this.apiBase}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  }

  normalizeTexts(input) {
    const toString = (value) => (typeof value === 'string' ? value : String(value ?? ''));
    const texts = Array.isArray(input) ? input : [input];
    const normalized = texts
      .map(toString)
      .map((t) => t.replace(/\r\n/g, '\n').trim())
      .filter((t) => t.length > 0);

    if (normalized.length === 0) {
      throw new Error('At least one non-empty text is required for embedding.');
    }

    return normalized;
  }

  normalizeOptions(options = {}) {
    const normalized = {
      autoChunk: options.autoChunk !== undefined ? Boolean(options.autoChunk) : true,
    };

    if (options.maxTokensPerChunk !== undefined) {
      if (options.maxTokensPerChunk === null || options.maxTokensPerChunk === 'null') {
        normalized.maxTokensPerChunk = null;
      } else if (options.maxTokensPerChunk === '' || options.maxTokensPerChunk === false) {
        // Leave undefined to use the API default
      } else {
        const parsed = Number.parseInt(options.maxTokensPerChunk, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('maxTokensPerChunk must be a positive number, null, or left blank.');
        }
        normalized.maxTokensPerChunk = parsed;
      }
    }

    if (options.overlapTokens !== undefined && options.overlapTokens !== '') {
      const parsed = Number.parseInt(options.overlapTokens, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('overlapTokens must be a number greater than or equal to 0.');
      }
      normalized.overlapTokens = parsed;
    }

    return normalized;
  }

  async health() {
    const requestUrl = this.buildUrl('/health');

    try {
      const { data, responseHeaders, status } = await this.fetchJson(requestUrl, { method: 'GET' });
      await recordApiDebugLog({
        functionName: 'health',
        requestUrl,
        responseHeaders,
        responseBody: data,
      });

      logger.notice('Embedding API health check succeeded', {
        category: 'embedding_api',
        metadata: {
          apiBase: this.apiBase,
          status,
          model: data?.model,
          cuda: data?.cuda,
          useOnDemandGpu: data?.use_on_demand_gpu,
        },
      });

      return data;
    } catch (error) {
      await recordApiDebugLog({
        functionName: 'health',
        requestUrl,
        responseHeaders: error?.responseHeaders || null,
        responseBody: error?.responseBody || error?.message || 'Unknown error',
      });

      logger.error('Embedding API health check failed', {
        category: 'embedding_api',
        metadata: {
          apiBase: this.apiBase,
          message: error?.message,
          status: error?.status,
        },
      });
      throw error;
    }
  }

  async embed(textsInput, options = {}) {
    const texts = this.normalizeTexts(textsInput);
    const normalizedOptions = this.normalizeOptions(options);
    const payload = {
      texts,
      auto_chunk: normalizedOptions.autoChunk,
    };

    if (normalizedOptions.maxTokensPerChunk !== undefined) {
      payload.max_tokens_per_chunk = normalizedOptions.maxTokensPerChunk;
    }
    if (normalizedOptions.overlapTokens !== undefined) {
      payload.overlap_tokens = normalizedOptions.overlapTokens;
    }

    const requestHeaders = { 'Content-Type': 'application/json' };
    const requestUrl = this.buildUrl('/embed');

    try {
      const { data, responseHeaders, status } = await this.fetchJson(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });

      await recordApiDebugLog({
        functionName: 'embed',
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: data,
      });

      logger.notice('Embedding API request completed', {
        category: 'embedding_api',
        metadata: {
          apiBase: this.apiBase,
          textCount: texts.length,
          vectorCount: data?.vectors?.length,
          chunkCount: data?.chunks?.length,
          dim: data?.dim,
          model: data?.model,
          status,
        },
      });

      return data;
    } catch (error) {
      await recordApiDebugLog({
        functionName: 'embed',
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders: error?.responseHeaders || null,
        responseBody: error?.responseBody || error?.message || 'Unknown error',
      });

      logger.error('Embedding API request failed', {
        category: 'embedding_api',
        metadata: {
          apiBase: this.apiBase,
          textCount: texts.length,
          message: error?.message,
          status: error?.status,
        },
      });
      throw error;
    }
  }

  async fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const fetchOptions = { ...options, signal: controller.signal };

    try {
      const response = await fetch(url, fetchOptions);
      const rawBody = await response.text().catch(() => '');
      const responseHeaders = response.headers ? Object.fromEntries(response.headers.entries()) : null;
      const parsed = rawBody ? safeJsonParse(rawBody) : null;

      if (!response.ok) {
        const error = new Error(`Embedding API error: ${response.status} ${response.statusText}${rawBody ? ` - ${rawBody.slice(0, 200)}` : ''}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.responseBody = parsed || rawBody;
        error.responseHeaders = responseHeaders;
        throw error;
      }

      return {
        data: parsed ?? rawBody,
        status: response.status,
        statusText: response.statusText,
        responseHeaders,
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        const abortError = new Error(`Embedding API request timed out after ${this.timeoutMs}ms`);
        abortError.code = 'ETIMEOUT';
        abortError.responseHeaders = null;
        abortError.responseBody = null;
        throw abortError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

module.exports = EmbeddingApiService;
