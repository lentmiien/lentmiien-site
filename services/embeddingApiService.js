const logger = require('../utils/logger');
const { VectorEmbedding, VectorEmbeddingHighQuality } = require('../database');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.EMBED_API_BASE || 'http://192.168.0.20:8001';
const DEFAULT_HQ_API_BASE = process.env.EMBED_API_BASE_HQ || process.env.EMBED_HQ_API_BASE || 'http://192.168.0.20:8002';
const DEFAULT_TIMEOUT_MS = 15000;
const JS_FILE_NAME = 'services/embeddingApiService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;
const CHAT_MESSAGE_COLLECTION = 'chat_message';
const SEARCH_MODES = {
  DEFAULT: 'default',
  HIGH_QUALITY: 'high_quality',
  COMBINED: 'combined',
};
const DEFAULT_COMBINED_CANDIDATE_MULTIPLIER = 3;
const MAX_COMBINED_CANDIDATES = 50;
const EMBEDDING_SUMMARY_PROJECTION = {
  source: 1,
  chunk: 1,
  previewText: 1,
  model: 1,
  dim: 1,
  textLength: 1,
  createdAt: 1,
  updatedAt: 1,
};

class EmbeddingApiService {
  constructor({ apiBase = DEFAULT_API_BASE, highQualityApiBase = DEFAULT_HQ_API_BASE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetch !== 'function') {
      throw new Error('Global fetch API is unavailable. Upgrade to Node 18+ or polyfill fetch.');
    }

    this.apiBase = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : DEFAULT_API_BASE;
    this.highQualityApiBase = typeof highQualityApiBase === 'string' ? highQualityApiBase.replace(/\/+$/, '') : DEFAULT_HQ_API_BASE;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  get baseUrl() {
    return this.apiBase;
  }

  get highQualityBaseUrl() {
    return this.highQualityApiBase;
  }

  buildUrl(pathname = '', apiBase = this.apiBase) {
    const base = typeof apiBase === 'string' ? apiBase : this.apiBase;
    if (!pathname) return base;
    if (pathname.startsWith('http')) return pathname;
    return `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  }

  getApiBaseForMode(mode = SEARCH_MODES.DEFAULT) {
    if (mode === SEARCH_MODES.HIGH_QUALITY) {
      return this.highQualityApiBase;
    }
    return this.apiBase;
  }

  getModelForMode(mode = SEARCH_MODES.DEFAULT) {
    if (mode === SEARCH_MODES.HIGH_QUALITY) {
      return VectorEmbeddingHighQuality;
    }
    return VectorEmbedding;
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

  async deleteEmbeddings(metadataInput, { mode = SEARCH_MODES.DEFAULT } = {}) {
    if (!metadataInput) {
      return 0;
    }

    const targetMode = normalizeSearchMode(mode);
    const Model = this.getModelForMode(targetMode);
    const metadataArray = Array.isArray(metadataInput) ? metadataInput : [metadataInput];
    const normalized = metadataArray.map((entry, index) => this.normalizeMetadataEntry(entry, index));
    let deletedCount = 0;

    for (const meta of normalized) {
      const filter = this.buildSourceFilter(meta);
      const result = await Model.deleteMany(filter);
      deletedCount += result?.deletedCount || 0;
    }

    logger.notice('Removed stored embeddings for source metadata', {
      category: 'embedding_api',
      metadata: {
        sources: normalized.length,
        deletedCount,
        mode: targetMode,
      },
    });

    return deletedCount;
  }

  async deleteHighQualityEmbeddings(metadataInput) {
    return this.deleteEmbeddings(metadataInput, { mode: SEARCH_MODES.HIGH_QUALITY });
  }

  async health({ mode = SEARCH_MODES.DEFAULT } = {}) {
    const targetMode = normalizeSearchMode(mode);
    const apiBase = this.getApiBaseForMode(targetMode);
    const requestUrl = this.buildUrl('/health', apiBase);

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
          apiBase,
          mode: targetMode,
          status,
          model: data?.model,
          cuda: data?.cuda,
          useOnDemandGpu: data?.use_on_demand_gpu,
        },
      });

      return { ...data, apiBase, mode: targetMode };
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
          apiBase,
          mode: targetMode,
          message: error?.message,
          status: error?.status,
        },
      });
      throw error;
    }
  }

  async embedWithApi(textsInput, options = {}, metadataInput = null, {
    apiBase = this.apiBase,
    model = VectorEmbedding,
    operationName = 'embed',
    task = null,
  } = {}) {
    const texts = this.normalizeTexts(textsInput);
    const normalizedOptions = this.normalizeOptions(options);
    const metadataList = this.normalizeMetadataList(metadataInput, texts.length);
    const normalizedTask = normalizeTask(task);
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
    if (normalizedTask) {
      payload.task = normalizedTask;
    }

    const requestHeaders = { 'Content-Type': 'application/json' };
    const requestUrl = this.buildUrl('/embed', apiBase);
    const mode = model === VectorEmbeddingHighQuality ? SEARCH_MODES.HIGH_QUALITY : SEARCH_MODES.DEFAULT;

    try {
      const { data, responseHeaders, status } = await this.fetchJson(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });

      await recordApiDebugLog({
        functionName: operationName,
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: data,
      });

      logger.notice('Embedding API request completed', {
        category: 'embedding_api',
        metadata: {
          apiBase,
          mode,
          textCount: texts.length,
          vectorCount: data?.vectors?.length,
          chunkCount: data?.chunks?.length,
          dim: data?.dim,
          model: data?.model,
          status,
          task: normalizedTask || null,
        },
      });

      if (metadataList) {
        await this.persistEmbeddings(texts, metadataList, data, model);
      }

      return { ...data, apiBase, mode };
    } catch (error) {
      await recordApiDebugLog({
        functionName: operationName,
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders: error?.responseHeaders || null,
        responseBody: error?.responseBody || error?.message || 'Unknown error',
      });

      logger.error('Embedding API request failed', {
        category: 'embedding_api',
        metadata: {
          apiBase,
          mode,
          textCount: texts.length,
          message: error?.message,
          status: error?.status,
          task: normalizedTask || null,
        },
      });
      throw error;
    }
  }

  async embed(textsInput, options = {}, metadataInput = null) {
    const { task, ...rest } = options || {};
    return this.embedWithApi(textsInput, rest, metadataInput, {
      apiBase: this.apiBase,
      model: VectorEmbedding,
      operationName: 'embed',
      task,
    });
  }

  async embedHighQuality(textsInput, options = {}, metadataInput = null) {
    const { task, ...rest } = options || {};
    const resolvedTask = task || 'document';
    return this.embedWithApi(textsInput, rest, metadataInput, {
      apiBase: this.highQualityApiBase,
      model: VectorEmbeddingHighQuality,
      operationName: 'embedHighQuality',
      task: resolvedTask,
    });
  }

  async reembedHighQuality(textsInput, options = {}, metadataInput = null) {
    return this.embedHighQuality(textsInput, options, metadataInput);
  }

  async persistEmbeddings(texts, metadataList, response, targetModel = VectorEmbedding) {
    const vectors = Array.isArray(response?.vectors) ? response.vectors : [];
    const chunks = Array.isArray(response?.chunks) ? response.chunks : [];
    const dim = Number.isFinite(response?.dim) ? response.dim : null;
    const model = response?.model || null;
    const Model = targetModel || VectorEmbedding;

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
      await Model.deleteMany(filter);
      await Model.insertMany(docs, { ordered: true });
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

  async similaritySearch(queryText, options = {}, searchOptions = {}) {
    const texts = this.normalizeTexts(queryText);
    if (texts.length !== 1) {
      throw new Error('similaritySearch expects a single query string.');
    }

    const normalizedOptions = this.normalizeOptions(options);
    const targetMode = normalizeSearchMode(searchOptions.mode || searchOptions.target);
    const topK = this.normalizeTopK(options.topK ?? searchOptions.topK);
    const dateRange = normalizeDateRangeOption(options.dateRange || searchOptions.dateRange || {
      start: options.startDate ?? searchOptions.startDate,
      end: options.endDate ?? searchOptions.endDate,
    });
    const apiBase = this.getApiBaseForMode(targetMode);
    const Model = this.getModelForMode(targetMode);
    const task = searchOptions.task || (targetMode === SEARCH_MODES.HIGH_QUALITY ? 'query' : null);
    const result = await this.embedWithApi(texts, normalizedOptions, null, {
      apiBase,
      model: Model,
      operationName: targetMode === SEARCH_MODES.HIGH_QUALITY ? 'similaritySearchHighQuality' : 'similaritySearch',
      task,
    });
    const queryVector = extractQueryVector(result);

    if (!isValidVector(queryVector)) {
      throw new Error('Search query embedding is invalid.');
    }

    const dim = Number.isFinite(result?.dim) ? result.dim : queryVector.length;
    const filter = { dim };
    const updatedAtFilter = buildUpdatedAtFilter(dateRange);
    if (updatedAtFilter) {
      filter.updatedAt = updatedAtFilter;
    }
    const candidates = await Model.find(filter, {
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
      .filter((doc) => isValidVector(doc.embedding, queryVector.length))
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
      .sort((a, b) => b.similarity - a.similarity);
    const deduped = dedupeResultsByEntry(scored);
    const {
      results: combinedResults,
      groupedConversations,
      alternativeCount,
    } = combineChatResultsByConversation(deduped, topK);

    logger.notice('Embedding similarity search completed', {
      category: 'embedding_api',
      metadata: {
        candidates: candidates.length,
        scored: scored.length,
        returned: combinedResults.length,
        uniqueEntries: deduped.length,
        chatConversations: groupedConversations,
        alternativeSources: alternativeCount,
        dim,
        topK,
        mode: targetMode,
        apiBase,
        updatedAfter: dateRange.start ? dateRange.start.toISOString() : null,
        updatedBefore: dateRange.end ? dateRange.end.toISOString() : null,
      },
    });

    return {
      dim,
      model: result?.model || null,
      topK,
      results: combinedResults,
      mode: targetMode,
      apiBase,
    };
  }

  async similaritySearchHighQuality(queryText, options = {}) {
    return this.similaritySearch(queryText, options, { mode: SEARCH_MODES.HIGH_QUALITY, task: 'query' });
  }

  async combinedSimilaritySearch(queryText, options = {}) {
    const texts = this.normalizeTexts(queryText);
    if (texts.length !== 1) {
      throw new Error('combinedSimilaritySearch expects a single query string.');
    }

    const topK = this.normalizeTopK(options.topK);
    const candidateMultiplier = normalizeCandidateMultiplier(options.candidateMultiplier);
    const candidateLimit = normalizeCandidateLimit(options.candidateLimit);
    const candidateCount = Math.min(
      candidateLimit,
      Math.max(topK, Math.round(topK * candidateMultiplier)),
      MAX_COMBINED_CANDIDATES,
    );

    const baseSearch = await this.similaritySearch(texts[0], { ...options, topK: candidateCount });
    const baseResults = Array.isArray(baseSearch?.results) ? baseSearch.results : [];
    if (!baseResults.length) {
      return {
        dim: baseSearch?.dim || null,
        model: baseSearch?.model || null,
        topK,
        results: [],
        mode: SEARCH_MODES.COMBINED,
        apiBase: this.highQualityApiBase,
        rerankedFrom: baseSearch?.mode || SEARCH_MODES.DEFAULT,
        baseCandidates: 0,
      };
    }

    const candidatePayload = baseResults
      .map((row, idx) => ({
        text: ((row?.previewText || '').replace(/\r\n/g, '\n')).trim(),
        index: idx,
      }))
      .filter((entry) => entry.text.length > 0);

    if (!candidatePayload.length) {
      return {
        ...baseSearch,
        mode: SEARCH_MODES.COMBINED,
        apiBase: this.highQualityApiBase,
        results: baseResults.slice(0, topK),
        rerankedFrom: baseSearch?.mode || SEARCH_MODES.DEFAULT,
        baseCandidates: baseResults.length,
        reranked: false,
      };
    }

    const candidateTexts = candidatePayload.map((entry) => entry.text);

    const queryEmbed = await this.embedWithApi([texts[0]], { autoChunk: false }, null, {
      apiBase: this.highQualityApiBase,
      model: VectorEmbeddingHighQuality,
      operationName: 'combinedSearchQuery',
      task: 'query',
    });
    const queryVector = extractQueryVector(queryEmbed);
    if (!isValidVector(queryVector)) {
      throw new Error('High-quality embedding API did not return a valid vector for the query.');
    }

    const candidateEmbed = await this.embedWithApi(candidateTexts, { autoChunk: false }, null, {
      apiBase: this.highQualityApiBase,
      model: VectorEmbeddingHighQuality,
      operationName: 'combinedSearchCandidates',
      task: 'document',
    });
    const candidateVectors = mapVectorsToTextIndex(candidateEmbed, candidateTexts.length);

    const reranked = candidatePayload
      .map((entry, idx) => {
        const vector = candidateVectors[idx];
        if (!isValidVector(vector, queryVector.length)) {
          return null;
        }
        const row = baseResults[entry.index];
        return {
          row,
          hqSimilarity: cosineSimilarity(queryVector, vector),
          baseSimilarity: Number.isFinite(row.similarity) ? row.similarity : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.hqSimilarity - a.hqSimilarity);

    const hasReranked = reranked.length > 0;
    const finalResults = hasReranked
      ? reranked.slice(0, topK).map((entry) => ({
        ...entry.row,
        similarity: entry.hqSimilarity,
        rerank: {
          baseSimilarity: entry.baseSimilarity,
          from: baseSearch?.mode || SEARCH_MODES.DEFAULT,
        },
      }))
      : baseResults.slice(0, topK);

    logger.notice('Combined embedding search completed', {
      category: 'embedding_api',
      metadata: {
        baseCandidates: baseResults.length,
        rerankedCount: reranked.length,
        returned: finalResults.length,
        topK,
        baseMode: baseSearch?.mode || SEARCH_MODES.DEFAULT,
        rerankApiBase: this.highQualityApiBase,
      },
    });

    return {
      dim: queryVector.length,
      model: queryEmbed?.model || candidateEmbed?.model || baseSearch?.model || null,
      topK,
      results: finalResults,
      mode: SEARCH_MODES.COMBINED,
      apiBase: this.highQualityApiBase,
      rerankedFrom: baseSearch?.mode || SEARCH_MODES.DEFAULT,
      baseModel: baseSearch?.model || null,
      baseCandidates: baseResults.length,
      reranked: hasReranked,
    };
  }

  async fetchEmbeddingsBySources(sourceList, { mode = SEARCH_MODES.DEFAULT, limit = null } = {}) {
    if (!Array.isArray(sourceList) || !sourceList.length) {
      return [];
    }

    const targetMode = normalizeSearchMode(mode);
    const Model = this.getModelForMode(targetMode);
    const normalizedSources = sourceList.map((entry, index) => this.normalizeMetadataEntry(entry, index));
    const filter = { $or: normalizedSources.map((source) => this.buildSourceFilter(source)) };
    const query = Model.find(filter, EMBEDDING_SUMMARY_PROJECTION).sort({
      'chunk.textIndex': 1,
      'chunk.chunkIndex': 1,
      createdAt: -1,
    });

    if (Number.isFinite(limit) && limit > 0) {
      query.limit(limit);
    }

    return query.lean();
  }

  async fetchRecentEmbeddings({ mode = SEARCH_MODES.DEFAULT, since = null, until = null, limit = null } = {}) {
    const targetMode = normalizeSearchMode(mode);
    const Model = this.getModelForMode(targetMode);
    const createdAtFilter = {};

    if (since instanceof Date && !Number.isNaN(since.getTime())) {
      createdAtFilter.$gte = since;
    }
    if (until instanceof Date && !Number.isNaN(until.getTime())) {
      createdAtFilter.$lte = until;
    }

    const filter = Object.keys(createdAtFilter).length ? { createdAt: createdAtFilter } : {};
    const totalCount = await Model.countDocuments(filter);
    const query = Model.find(filter, EMBEDDING_SUMMARY_PROJECTION).sort({ createdAt: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      query.limit(limit);
    }

    const docs = await query.lean();
    const truncated = Number.isFinite(limit) && limit > 0 && totalCount > docs.length;

    logger.debug('Fetched recent embeddings', {
      category: 'embedding_api',
      metadata: {
        mode: targetMode,
        returned: docs.length,
        totalCount,
        truncated,
        since: createdAtFilter.$gte ? createdAtFilter.$gte.toISOString() : null,
        until: createdAtFilter.$lte ? createdAtFilter.$lte.toISOString() : null,
        limit: Number.isFinite(limit) && limit > 0 ? limit : null,
      },
    });

    return {
      mode: targetMode,
      docs,
      totalCount,
      truncated,
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

function normalizeSearchMode(mode) {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value === SEARCH_MODES.HIGH_QUALITY) {
    return SEARCH_MODES.HIGH_QUALITY;
  }
  if (value === SEARCH_MODES.COMBINED) {
    return SEARCH_MODES.COMBINED;
  }
  return SEARCH_MODES.DEFAULT;
}

function normalizeTask(task) {
  if (task === undefined || task === null) {
    return null;
  }
  const value = String(task).toLowerCase();
  if (value === 'document' || value === 'doc') {
    return 'document';
  }
  if (value === 'query' || value === 'search') {
    return 'query';
  }
  return null;
}

function normalizeCandidateMultiplier(value) {
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, 5);
  }
  return DEFAULT_COMBINED_CANDIDATE_MULTIPLIER;
}

function normalizeCandidateLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, MAX_COMBINED_CANDIDATES);
  }
  return MAX_COMBINED_CANDIDATES;
}

function extractQueryVector(response) {
  const grouped = mapVectorsToTextIndex(response, 1);
  if (grouped[0] && isValidVector(grouped[0])) {
    return grouped[0];
  }
  const vectors = Array.isArray(response?.vectors) ? response.vectors : [];
  const averaged = averageVectors(vectors);
  return isValidVector(averaged) ? averaged : [];
}

function mapVectorsToTextIndex(response, expectedCount) {
  const vectors = Array.isArray(response?.vectors) ? response.vectors : [];
  const chunks = Array.isArray(response?.chunks) ? response.chunks : [];
  const grouped = new Map();

  vectors.forEach((vec, idx) => {
    const chunk = chunks[idx] || {};
    const textIndex = normalizeTextIndex(chunk.text_index ?? chunk.textIndex, idx);
    if (!grouped.has(textIndex)) {
      grouped.set(textIndex, []);
    }
    grouped.get(textIndex).push(vec);
  });

  const results = [];
  for (let i = 0; i < expectedCount; i += 1) {
    const entries = grouped.get(i);
    if (!entries || !entries.length) {
      results.push(null);
      continue;
    }
    const averaged = averageVectors(entries);
    results.push(isValidVector(averaged) ? averaged : null);
  }

  return results;
}

function normalizeTextIndex(raw, fallback = 0) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return Math.max(0, fallback);
}

function isValidVector(vector, expectedLength = null) {
  if (!Array.isArray(vector) || !vector.length) {
    return false;
  }
  if (Number.isFinite(expectedLength) && expectedLength > 0 && vector.length !== expectedLength) {
    return false;
  }
  return vector.every((value) => Number.isFinite(value));
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

function normalizeDateRangeOption(range) {
  const normalizeSide = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value.trim());
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const start = normalizeSide(range?.start ?? range?.startDate);
  const end = normalizeSide(range?.end ?? range?.endDate);

  if (start && end && start > end) {
    return { start, end: null };
  }

  return { start, end };
}

function buildUpdatedAtFilter(dateRange) {
  if (!dateRange || (!dateRange.start && !dateRange.end)) {
    return null;
  }
  const filter = {};
  if (dateRange.start instanceof Date && !Number.isNaN(dateRange.start.getTime())) {
    filter.$gte = dateRange.start;
  }
  if (dateRange.end instanceof Date && !Number.isNaN(dateRange.end.getTime())) {
    filter.$lte = dateRange.end;
  }
  return Object.keys(filter).length ? filter : null;
}

function dedupeResultsByEntry(rows, limit) {
  if (!Array.isArray(rows)) {
    return [];
  }
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = buildSourceKey(row?.source || {});
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(row);
    if (limit && unique.length >= limit) {
      break;
    }
  }

  return limit ? unique.slice(0, limit) : unique;
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

function extractConversationId(source) {
  if (!source || source.collectionName !== CHAT_MESSAGE_COLLECTION) {
    return null;
  }
  const conversationId = source.parentId ?? source.parent_id;
  if (conversationId === undefined || conversationId === null) {
    return null;
  }
  const normalized = String(conversationId).trim();
  return normalized.length > 0 ? normalized : null;
}

function attachAlternativeSource(primary, alternativeRow) {
  if (!primary) return;
  if (!Array.isArray(primary.alternative_sources)) {
    primary.alternative_sources = [];
  }
  primary.alternative_sources.push({
    id: alternativeRow.id,
    similarity: alternativeRow.similarity,
    previewText: alternativeRow.previewText,
    source: alternativeRow.source,
    chunk: alternativeRow.chunk,
    dim: alternativeRow.dim,
    model: alternativeRow.model || null,
    textLength: alternativeRow.textLength || 0,
    createdAt: alternativeRow.createdAt,
    updatedAt: alternativeRow.updatedAt,
    rerank: alternativeRow.rerank || null,
  });
}

function combineChatResultsByConversation(rows, topK) {
  if (!Array.isArray(rows)) {
    return { results: [], groupedConversations: 0, alternativeCount: 0 };
  }
  const maxResults = Number.isFinite(topK) && topK > 0 ? topK : DEFAULT_TOP_K;
  const results = [];
  const conversationLookup = new Map();
  let alternativeCount = 0;

  for (const row of rows) {
    const conversationId = extractConversationId(row?.source);
    if (conversationId && conversationLookup.has(conversationId)) {
      attachAlternativeSource(conversationLookup.get(conversationId), row);
      alternativeCount += 1;
      continue;
    }

    if (results.length < maxResults) {
      const entry = conversationId ? { ...row } : row;
      results.push(entry);
      if (conversationId) {
        conversationLookup.set(conversationId, entry);
      }
    }
  }

  return {
    results,
    groupedConversations: conversationLookup.size,
    alternativeCount,
  };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

module.exports = EmbeddingApiService;
