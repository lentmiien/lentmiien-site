const logger = require('../utils/logger');
const { VectorEmbedding } = require('../database');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.EMBED_API_BASE || 'http://192.168.0.20:8001';
const DEFAULT_TIMEOUT_MS = 15000;
const JS_FILE_NAME = 'services/embeddingApiService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;

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

  normalizeMetadataList(metadataInput, expectedLength) {
    if (metadataInput === undefined || metadataInput === null) {
      return null;
    }

    if (!Array.isArray(metadataInput)) {
      throw new Error('metadata must be an array matching the texts input.');
    }

    if (metadataInput.length !== expectedLength) {
      throw new Error(`metadata must have the same length as texts (${expectedLength}).`);
    }

    return metadataInput.map((entry, index) => this.normalizeMetadataEntry(entry, index));
  }

  normalizeMetadataEntry(entry, index) {
    const toString = (value) => {
      if (value === undefined || value === null) return '';
      if (typeof value === 'string') return value.trim();
      return String(value).trim();
    };

    const collectionName = toString(entry?.collectionName ?? entry?.collection ?? entry?.collection_name);
    const documentId = toString(entry?.documentId ?? entry?.id ?? entry?.document_id);
    const contentType = toString(entry?.contentType ?? entry?.content_type);
    const parentCollection = toString(entry?.parentCollection ?? entry?.parent_collection ?? entry?.parentCollectionName);
    const parentId = toString(entry?.parentId ?? entry?.parent_id);

    if (!collectionName || !documentId || !contentType) {
      throw new Error(`metadata entry #${index + 1} is missing collectionName, documentId, or contentType.`);
    }

    return {
      collectionName,
      documentId,
      contentType,
      parentCollection: parentCollection || null,
      parentId: parentId || null,
    };
  }

  normalizeChunkEntry(chunk, fallbackChunkIndex = 0) {
    const toNumber = (value, defaultValue = 0) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    };
    const toText = (value) => {
      if (value === undefined || value === null) return '';
      return typeof value === 'string' ? value : String(value);
    };

    const normalized = {
      textIndex: toNumber(chunk?.text_index ?? chunk?.textIndex, 0),
      chunkIndex: toNumber(chunk?.chunk_index ?? chunk?.chunkIndex ?? fallbackChunkIndex, fallbackChunkIndex),
      startToken: toNumber(chunk?.start_token ?? chunk?.startToken, 0),
      endToken: toNumber(chunk?.end_token ?? chunk?.endToken, 0),
      text: toText(chunk?.text),
    };

    if (normalized.textIndex < 0) normalized.textIndex = 0;
    if (normalized.chunkIndex < 0) normalized.chunkIndex = 0;
    if (normalized.startToken < 0) normalized.startToken = 0;
    if (normalized.endToken < 0) normalized.endToken = 0;

    return normalized;
  }

  normalizeTopK(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_TOP_K);
    }
    return DEFAULT_TOP_K;
  }

  buildSourceFilter(source) {
    return {
      'source.collectionName': source.collectionName,
      'source.documentId': source.documentId,
      'source.contentType': source.contentType,
      'source.parentCollection': source.parentCollection ?? null,
      'source.parentId': source.parentId ?? null,
    };
  }

  async deleteEmbeddings(metadataInput) {
    if (!metadataInput) {
      return 0;
    }

    const metadataArray = Array.isArray(metadataInput) ? metadataInput : [metadataInput];
    const normalized = metadataArray.map((entry, index) => this.normalizeMetadataEntry(entry, index));
    let deletedCount = 0;

    for (const meta of normalized) {
      const filter = this.buildSourceFilter(meta);
      const result = await VectorEmbedding.deleteMany(filter);
      deletedCount += result?.deletedCount || 0;
    }

    logger.notice('Removed stored embeddings for source metadata', {
      category: 'embedding_api',
      metadata: {
        sources: normalized.length,
        deletedCount,
      },
    });

    return deletedCount;
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

  async embed(textsInput, options = {}, metadataInput = null) {
    const texts = this.normalizeTexts(textsInput);
    const normalizedOptions = this.normalizeOptions(options);
    const metadataList = this.normalizeMetadataList(metadataInput, texts.length);
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

      if (metadataList) {
        await this.persistEmbeddings(texts, metadataList, data);
      }

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

  async persistEmbeddings(texts, metadataList, response) {
    const vectors = Array.isArray(response?.vectors) ? response.vectors : [];
    const chunks = Array.isArray(response?.chunks) ? response.chunks : [];
    const dim = Number.isFinite(response?.dim) ? response.dim : null;
    const model = response?.model || null;

    if (!vectors.length) {
      throw new Error('Embedding API did not return vectors to store.');
    }

    const now = new Date();
    const documents = vectors.map((vector, index) => {
      const numericVector = Array.isArray(vector) ? vector.map((value) => Number(value)) : [];
      if (!numericVector.length || numericVector.some((value) => !Number.isFinite(value))) {
        throw new Error(`Embedding vector at index ${index} is invalid or empty.`);
      }

      const chunk = this.normalizeChunkEntry(chunks[index] || { chunk_index: index }, index);
      const textIndex = clampNumber(chunk.textIndex, 0, metadataList.length - 1);
      const text = texts[textIndex] || '';
      const previewText = chunk.text || '';

      return {
        source: metadataList[textIndex],
        chunk: {
          textIndex,
          chunkIndex: chunk.chunkIndex,
          startToken: chunk.startToken,
          endToken: chunk.endToken,
        },
        previewText,
        embedding: numericVector,
        dim: Number.isFinite(dim) ? dim : numericVector.length,
        model,
        textLength: text.length,
        createdAt: now,
        updatedAt: now,
      };
    });

    const grouped = documents.reduce((acc, doc) => {
      const key = buildSourceKey(doc.source);
      if (!acc.has(key)) {
        acc.set(key, []);
      }
      acc.get(key).push(doc);
      return acc;
    }, new Map());

    for (const docs of grouped.values()) {
      const filter = this.buildSourceFilter(docs[0].source);
      await VectorEmbedding.deleteMany(filter);
      await VectorEmbedding.insertMany(docs, { ordered: true });
    }

    logger.notice('Persisted embedding vectors to database', {
      category: 'embedding_api',
      metadata: {
        sourceCount: grouped.size,
        vectorCount: documents.length,
        model: model || 'unknown',
      },
    });

    return documents;
  }

  async similaritySearch(queryText, options = {}) {
    const texts = this.normalizeTexts(queryText);
    if (texts.length !== 1) {
      throw new Error('similaritySearch expects a single query string.');
    }

    const normalizedOptions = this.normalizeOptions(options);
    const topK = this.normalizeTopK(options.topK);
    const result = await this.embed(texts, normalizedOptions);
    const vectors = Array.isArray(result?.vectors) ? result.vectors : [];

    if (!vectors.length) {
      throw new Error('Embedding API did not return a vector for the search query.');
    }

    const queryVector = averageVectors(vectors);
    if (!queryVector.length || queryVector.some((value) => !Number.isFinite(value))) {
      throw new Error('Search query embedding is invalid.');
    }

    const dim = Number.isFinite(result?.dim) ? result.dim : queryVector.length;
    const candidates = await VectorEmbedding.find({ dim }, {
      embedding: 1,
      source: 1,
      chunk: 1,
      previewText: 1,
      model: 1,
      textLength: 1,
      createdAt: 1,
      updatedAt: 1,
    }).lean();

    const scored = candidates
      .filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length === queryVector.length)
      .map((doc) => ({
        id: doc._id?.toString?.() || String(doc._id),
        similarity: cosineSimilarity(queryVector, doc.embedding),
        source: doc.source,
        chunk: doc.chunk,
        previewText: doc.previewText || '',
        dim: doc.dim,
        model: doc.model || null,
        textLength: doc.textLength || 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    logger.notice('Embedding similarity search completed', {
      category: 'embedding_api',
      metadata: {
        candidates: candidates.length,
        returned: scored.length,
        dim,
        topK,
      },
    });

    return {
      dim,
      model: result?.model || null,
      topK,
      results: scored,
    };
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

function clampNumber(value, min, max) {
  const numeric = Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  if (!magnitudeA || !magnitudeB) {
    return 0;
  }
  return dotProduct / (magnitudeA * magnitudeB);
}

function averageVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    return [];
  }
  const first = vectors[0];
  if (!Array.isArray(first) || !first.length) {
    return [];
  }
  if (vectors.length === 1) {
    return first;
  }
  const length = first.length;
  const sums = new Array(length).fill(0);
  let count = 0;

  vectors.forEach((vec) => {
    if (!Array.isArray(vec) || vec.length !== length) {
      return;
    }
    vec.forEach((val, idx) => {
      sums[idx] += Number(val) || 0;
    });
    count += 1;
  });

  if (!count) {
    return [];
  }

  return sums.map((value) => value / count);
}

function buildSourceKey(source) {
  return [
    source.collectionName || '',
    source.documentId || '',
    source.contentType || '',
    source.parentCollection || '',
    source.parentId || '',
  ].join('::');
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

module.exports = EmbeddingApiService;
