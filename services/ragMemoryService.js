const logger = require('../utils/logger');
const EmbeddingApiService = require('./embeddingApiService');
const {
  OcrJob,
  Chat4KnowledgeModel,
  Chat5Model,
  AsrJob,
  GoodImage,
  MessageInboxEntry,
} = require('../database');

const COLLECTIONS = {
  OCR_FILES: 'ocr_job_files',
  KNOWLEDGE: 'knowledge',
  CHAT: 'chat_message',
  ASR: 'asr_jobs',
  GOOD_IMAGES: 'good_images',
  MESSAGE_INBOX: 'message_inbox',
};

const RAG_MEMORY_TIERS = Object.freeze({
  none: { topK: 0, perEntryChars: 0, totalChars: 0 },
  minimal: { topK: 3, perEntryChars: 8000, totalChars: 12000 },
  medium: { topK: 7, perEntryChars: 12000, totalChars: 30000 },
});

class RagMemoryService {
  constructor({
    embeddingService = null,
    ocrModel = OcrJob,
    knowledgeModel = Chat4KnowledgeModel,
    chatModel = Chat5Model,
    asrModel = AsrJob,
    goodImageModel = GoodImage,
    messageModel = MessageInboxEntry,
  } = {}) {
    this.embeddingService = embeddingService || new EmbeddingApiService();
    this.ocrModel = ocrModel;
    this.knowledgeModel = knowledgeModel;
    this.chatModel = chatModel;
    this.asrModel = asrModel;
    this.goodImageModel = goodImageModel;
    this.messageModel = messageModel;

    this.handlers = {
      [COLLECTIONS.OCR_FILES]: this.fetchOcrFileEntry.bind(this),
      [COLLECTIONS.KNOWLEDGE]: this.fetchKnowledgeEntry.bind(this),
      [COLLECTIONS.CHAT]: this.fetchChatMessage.bind(this),
      [COLLECTIONS.ASR]: this.fetchAsrJob.bind(this),
      [COLLECTIONS.GOOD_IMAGES]: this.fetchImagePrompt.bind(this),
      [COLLECTIONS.MESSAGE_INBOX]: this.fetchInboxMessage.bind(this),
    };
  }

  normalizePrompt(prompt) {
    if (prompt === undefined || prompt === null) {
      return '';
    }
    if (typeof prompt === 'string') {
      return prompt.trim();
    }
    return String(prompt).trim();
  }

  normalizeTier(tier) {
    const key = typeof tier === 'string' ? tier.toLowerCase() : '';
    if (RAG_MEMORY_TIERS[key]) {
      return key;
    }
    return 'minimal';
  }

  normalizeSource(source = {}) {
    const collectionName = (source.collectionName || source.collection_name || '').trim();
    if (!collectionName) {
      return null;
    }
    const documentIdRaw = source.documentId ?? source.document_id;
    const documentId = documentIdRaw || documentIdRaw === 0 ? String(documentIdRaw).trim() : '';
    const contentType = (source.contentType || source.content_type || '').trim();
    const parentCollection = (source.parentCollection || source.parent_collection || '').trim();
    const parentIdRaw = source.parentId || source.parent_id;
    const parentId = parentIdRaw || parentIdRaw === 0 ? String(parentIdRaw).trim() : '';

    return {
      collectionName,
      documentId,
      contentType,
      parentCollection: parentCollection || null,
      parentId: parentId || null,
    };
  }

  mapSourceType(collectionName) {
    const name = (collectionName || '').toLowerCase();
    if (name === COLLECTIONS.OCR_FILES) return 'ocr';
    if (name === COLLECTIONS.KNOWLEDGE) return 'knowledge';
    if (name === COLLECTIONS.CHAT) return 'chat';
    if (name === COLLECTIONS.ASR) return 'asr';
    if (name === COLLECTIONS.GOOD_IMAGES) return 'image';
    if (name === COLLECTIONS.MESSAGE_INBOX) return 'message';
    return 'unknown';
  }

  buildSourceUrl(source) {
    const collection = source?.collectionName?.toLowerCase?.() || '';
    const docId = source?.documentId;
    const parentId = source?.parentId;

    switch (collection) {
      case COLLECTIONS.OCR_FILES:
        if (parentId) {
          const fileSuffix = docId ? `/${encodeURIComponent(docId)}` : '';
          return `/ocr/jobs/${encodeURIComponent(parentId)}/view${fileSuffix}`;
        }
        return null;
      case COLLECTIONS.KNOWLEDGE:
        return docId ? `/chat4/viewknowledge/${encodeURIComponent(docId)}` : null;
      case COLLECTIONS.CHAT:
        return parentId ? `/chat5/chat/${encodeURIComponent(parentId)}` : null;
      case COLLECTIONS.ASR:
        return (parentId || docId) ? `/asr/job/${encodeURIComponent(parentId || docId)}` : null;
      case COLLECTIONS.GOOD_IMAGES:
        return docId ? `/image_gen/good?image=${encodeURIComponent(docId)}` : null;
      case COLLECTIONS.MESSAGE_INBOX:
        return docId ? `/admin/message-inbox/${encodeURIComponent(docId)}` : null;
      default:
        return null;
    }
  }

  buildSecondaryUrl(source) {
    const collection = source?.collectionName?.toLowerCase?.() || '';
    if (collection === COLLECTIONS.MESSAGE_INBOX && source?.parentId) {
      return `/admin/message-thread/${encodeURIComponent(source.parentId)}`;
    }
    return null;
  }

  async recall(prompt, tierInput = 'minimal') {
    const query = this.normalizePrompt(prompt);
    const tier = this.normalizeTier(tierInput);
    const config = RAG_MEMORY_TIERS[tier];

    if (!query) {
      throw new Error('Prompt is required for recall.');
    }

    if (!config.topK) {
      return {
        prompt: query,
        tier,
        limits: config,
        results: [],
        totalCharacters: 0,
        searchMeta: null,
      };
    }

    const search = await this.embeddingService.similaritySearchHighQuality(query, { topK: config.topK });
    const rawResults = Array.isArray(search?.results) ? search.results : [];
    const { entries, totalCharacters } = await this.hydrateResults(rawResults, config);

    return {
      prompt: query,
      tier,
      limits: config,
      results: entries,
      totalCharacters,
      searchMeta: {
        topK: search?.topK || config.topK,
        dim: search?.dim || null,
        model: search?.model || null,
        mode: search?.mode || 'high_quality',
        apiBase: search?.apiBase || null,
      },
    };
  }

  async hydrateResults(rawResults, config) {
    const entries = [];
    let usedChars = 0;

    for (const row of rawResults) {
      // eslint-disable-next-line no-await-in-loop
      const entry = await this.buildEntry(row);
      if (!entry) {
        continue;
      }

      const limited = this.applyLimits(entry, config, usedChars);
      usedChars += limited.text.length;
      entries.push(limited);
    }

    return { entries, totalCharacters: usedChars };
  }

  async buildEntry(row) {
    const source = this.normalizeSource(row?.source || {});
    if (!source) {
      logger.warning('RagMemoryService received a result without source metadata', {
        category: 'rag_memory',
        metadata: { row },
      });
      return null;
    }

    const handler = this.handlers[source.collectionName?.toLowerCase?.()] || null;
    let payload = {};
    if (handler) {
      try {
        payload = await handler(source);
      } catch (error) {
        logger.error('Failed to hydrate memory entry', {
          category: 'rag_memory',
          metadata: {
            collectionName: source.collectionName,
            documentId: source.documentId,
            error: error?.message,
          },
        });
        payload = { text: '', error: error?.message || 'Unable to load source data.' };
      }
    } else {
      logger.warning('No handler configured for memory source', {
        category: 'rag_memory',
        metadata: { collectionName: source.collectionName },
      });
    }

    const baseText = typeof payload.text === 'string' ? payload.text : '';
    const originalLength = Number.isFinite(payload.originalLength) ? payload.originalLength : baseText.length;

    return {
      type: payload.type || this.mapSourceType(source.collectionName),
      source,
      similarity: Number.isFinite(row?.similarity) ? row.similarity : null,
      preview: row?.previewText || '',
      text: baseText,
      originalLength,
      truncated: Boolean(payload.truncated),
      sourceUrl: payload.sourceUrl || this.buildSourceUrl(source),
      secondaryUrl: payload.secondaryUrl || this.buildSecondaryUrl(source),
      createdAt: payload.createdAt || null,
      updatedAt: payload.updatedAt || null,
      title: payload.title || null,
      missing: Boolean(payload.missing),
      error: payload.error || null,
    };
  }

  applyLimits(entry, config, usedChars) {
    const limited = { ...entry };
    const perEntryLimit = Number.isFinite(config?.perEntryChars) ? config.perEntryChars : 0;
    const totalLimit = Number.isFinite(config?.totalChars) ? config.totalChars : 0;
    let text = typeof entry.text === 'string' ? entry.text : '';
    let truncated = Boolean(entry.truncated);

    if (perEntryLimit > 0 && text.length > perEntryLimit) {
      text = text.slice(0, perEntryLimit);
      truncated = true;
    }

    if (totalLimit > 0) {
      const remaining = totalLimit - usedChars;
      if (remaining <= 0) {
        text = '';
        truncated = true;
      } else if (text.length > remaining) {
        text = text.slice(0, remaining);
        truncated = true;
      }
    }

    limited.text = text;
    limited.truncated = truncated;
    limited.textLength = text.length;
    limited.originalLength = Number.isFinite(entry.originalLength) ? entry.originalLength : text.length;

    return limited;
  }

  async fetchOcrFileEntry(source) {
    if (!this.ocrModel || typeof this.ocrModel.findById !== 'function') {
      return { text: '', missing: true, error: 'OCR model unavailable.' };
    }
    const jobId = source.parentId;
    const fileId = source.documentId;
    if (!jobId || !fileId) {
      return { text: '', missing: true, error: 'Missing OCR identifiers.' };
    }

    const job = await this.ocrModel.findById(jobId).lean();
    if (!job) {
      return { text: '', missing: true, error: 'OCR job not found.' };
    }

    const files = Array.isArray(job.files) ? job.files : [];
    const file = files.find((entry) => entry && (entry.id === fileId || String(entry.id) === fileId));
    const text = (file?.result?.layoutText || '').trim();
    return {
      type: 'ocr',
      text,
      sourceUrl: this.buildSourceUrl(source),
      createdAt: file?.createdAt || job.createdAt || null,
      updatedAt: file?.updatedAt || job.updatedAt || job.createdAt || null,
      missing: !text,
    };
  }

  async fetchKnowledgeEntry(source) {
    if (!this.knowledgeModel || typeof this.knowledgeModel.findById !== 'function') {
      return { text: '', missing: true, error: 'Knowledge model unavailable.' };
    }
    if (!source.documentId) {
      return { text: '', missing: true, error: 'Missing knowledge id.' };
    }

    const knowledge = await this.knowledgeModel.findById(source.documentId).lean();
    if (!knowledge) {
      return { text: '', missing: true, error: 'Knowledge entry not found.' };
    }

    const title = knowledge.title || '';
    const content = knowledge.contentMarkdown || '';
    const text = [title, content].filter(Boolean).join('\n\n').trim();
    return {
      type: 'knowledge',
      text,
      title: title || null,
      sourceUrl: this.buildSourceUrl(source),
      createdAt: knowledge.createdDate || null,
      updatedAt: knowledge.updatedDate || knowledge.createdDate || null,
      missing: !text,
    };
  }

  async fetchChatMessage(source) {
    if (!this.chatModel || typeof this.chatModel.findById !== 'function') {
      return { text: '', missing: true, error: 'Chat model unavailable.' };
    }
    if (!source.documentId) {
      return { text: '', missing: true, error: 'Missing chat message id.' };
    }

    const message = await this.chatModel.findById(source.documentId).lean();
    if (!message) {
      return { text: '', missing: true, error: 'Chat message not found.' };
    }

    const text = (message.content && typeof message.content.text === 'string')
      ? message.content.text
      : '';
    return {
      type: 'chat',
      text: text.trim(),
      sourceUrl: this.buildSourceUrl(source),
      createdAt: message.timestamp || null,
      updatedAt: message.timestamp || null,
      missing: !text,
    };
  }

  async fetchAsrJob(source) {
    if (!this.asrModel || typeof this.asrModel.findById !== 'function') {
      return { text: '', missing: true, error: 'ASR model unavailable.' };
    }
    if (!source.documentId) {
      return { text: '', missing: true, error: 'Missing ASR job id.' };
    }

    const job = await this.asrModel.findById(source.documentId).lean();
    if (!job) {
      return { text: '', missing: true, error: 'ASR job not found.' };
    }

    const text = (job.transcriptText || '').trim();
    return {
      type: 'asr',
      text,
      sourceUrl: this.buildSourceUrl(source),
      createdAt: job.createdAt || null,
      updatedAt: job.updatedAt || job.createdAt || null,
      missing: !text,
    };
  }

  async fetchImagePrompt(source) {
    if (!this.goodImageModel || typeof this.goodImageModel.findById !== 'function') {
      return { text: '', missing: true, error: 'Image model unavailable.' };
    }
    if (!source.documentId) {
      return { text: '', missing: true, error: 'Missing image id.' };
    }

    const image = await this.goodImageModel.findById(source.documentId).lean();
    if (!image) {
      return { text: '', missing: true, error: 'Image not found.' };
    }

    const text = (image.prompt || '').trim();
    const createdAt = image.created_at || image.createdAt || null;
    const updatedAt = image.updated_at || image.updatedAt || createdAt || null;
    return {
      type: 'image',
      text,
      sourceUrl: this.buildSourceUrl(source),
      createdAt,
      updatedAt,
      missing: !text,
    };
  }

  async fetchInboxMessage(source) {
    if (!this.messageModel || typeof this.messageModel.findById !== 'function') {
      return { text: '', missing: true, error: 'Message model unavailable.' };
    }
    if (!source.documentId) {
      return { text: '', missing: true, error: 'Missing message id.' };
    }

    const message = await this.messageModel.findById(source.documentId).lean();
    if (!message) {
      return { text: '', missing: true, error: 'Message not found.' };
    }

    const bodyCandidates = [
      typeof message.text === 'string' ? message.text : '',
      typeof message.textAsHtml === 'string' ? message.textAsHtml : '',
      typeof message.html === 'string' ? message.html : '',
    ];
    const body = bodyCandidates.find((value) => value && value.trim()) || '';
    const subject = typeof message.subject === 'string' ? message.subject.trim() : '';
    const text = [subject, body].filter(Boolean).join('\n\n').trim();
    const createdAt = message.updatedAt || message.date || message.createdAt || null;
    return {
      type: 'message',
      text,
      sourceUrl: this.buildSourceUrl(source),
      secondaryUrl: this.buildSecondaryUrl(source) || (message.threadId ? `/admin/message-thread/${encodeURIComponent(message.threadId)}` : null),
      createdAt,
      updatedAt: message.updatedAt || message.date || message.createdAt || null,
      missing: !text,
    };
  }
}

RagMemoryService.TIERS = RAG_MEMORY_TIERS;
RagMemoryService.COLLECTIONS = COLLECTIONS;

module.exports = RagMemoryService;
