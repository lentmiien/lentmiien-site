const logger = require('../utils/logger');

let EmbeddingApiService = null;
let embeddingQueueService = null;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const MESSAGE_COLLECTION = 'message_inbox';
const MESSAGE_CONTENT_TYPE = 'message';
const THREAD_COLLECTION = 'message_thread';

class MessageInboxService {
  constructor(MessageModel, FilterModel, embeddingApiService = null, embeddingQueue = null) {
    this.MessageModel = MessageModel;
    this.FilterModel = FilterModel;
    this.embeddingApiService = embeddingApiService || this.getEmbeddingApiService();
    this.embeddingQueueService = embeddingQueue;
  }

  getEmbeddingApiService() {
    if (!this.embeddingApiService) {
      if (!EmbeddingApiService) {
        EmbeddingApiService = require('./embeddingApiService');
      }
      this.embeddingApiService = new EmbeddingApiService();
    }
    return this.embeddingApiService;
  }

  getEmbeddingQueueService() {
    if (!this.embeddingQueueService) {
      if (!embeddingQueueService) {
        embeddingQueueService = require('./embeddingQueueService');
      }
      this.embeddingQueueService = embeddingQueueService;
    }
    return this.embeddingQueueService;
  }

  isEmbeddingRequested(message, mode = 'default') {
    const requestedField = mode === 'high_quality'
      ? 'highQualityEmbeddingRequested'
      : 'embeddingRequested';
    const actualField = mode === 'high_quality'
      ? 'hasHighQualityEmbedding'
      : 'hasEmbedding';
    return typeof message?.[requestedField] === 'boolean'
      ? message[requestedField]
      : Boolean(message?.[actualField]);
  }

  normalizeEmail(value) {
    if (!value && value !== 0) {
      return '';
    }
    return String(value).trim().toLowerCase();
  }

  emailDomain(value) {
    const normalized = this.normalizeEmail(value);
    const separator = normalized.lastIndexOf('@');
    return separator >= 0 && separator < normalized.length - 1
      ? normalized.slice(separator + 1)
      : 'unknown';
  }

  normalizeLabels(labels) {
    const stored = [];
    const normalized = [];
    const seen = new Set();

    if (!Array.isArray(labels)) {
      return { stored, normalized };
    }

    labels.forEach((raw) => {
      const value = String(raw || '').trim();
      if (!value) {
        return;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      stored.push(value);
      normalized.push(key);
    });

    return { stored, normalized };
  }

  parseDateInput(value, fallback = new Date()) {
    if (!value && value !== 0) {
      return fallback;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return fallback;
    }
    return parsed;
  }

  parseRetentionDays(value, fallback = DEFAULT_RETENTION_DAYS) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
  }

  computeRetentionDate(baseDate, retentionDays) {
    return new Date(baseDate.getTime() + retentionDays * MS_PER_DAY);
  }

  buildSourceMetadata(message) {
    return {
      collectionName: MESSAGE_COLLECTION,
      documentId: String(message._id),
      contentType: MESSAGE_CONTENT_TYPE,
      parentCollection: message.threadId ? THREAD_COLLECTION : null,
      parentId: message.threadId || null,
    };
  }

  getMessageText(message) {
    const candidates = [
      typeof message.text === 'string' ? message.text : '',
      typeof message.textAsHtml === 'string' ? message.textAsHtml : '',
      typeof message.html === 'string' ? message.html : '',
      typeof message.subject === 'string' ? message.subject : '',
    ];
    return candidates.find((v) => v && v.trim().length > 0) || '';
  }

  async resolvePolicy(from, normalizedLabels = []) {
    const normalizedFrom = this.normalizeEmail(from);
    const filter = normalizedFrom
      ? await this.FilterModel.findOne({ sender: normalizedFrom }).lean().exec()
      : null;

    let retentionDays = this.parseRetentionDays(filter?.retentionDays, DEFAULT_RETENTION_DAYS);
    let hasEmbedding = !!filter?.generateEmbedding;
    let hasHighQualityEmbedding = !!filter?.generateHighQualityEmbedding;
    const matchedLabelRules = [];

    if (filter && Array.isArray(filter.labelRules) && filter.labelRules.length && normalizedLabels.length) {
      // Reset values to only apply label rules when existing
      retentionDays = 0;
      hasEmbedding = false;
      hasHighQualityEmbedding = false;

      const labelSet = new Set(normalizedLabels);
      filter.labelRules.forEach((rule) => {
        const labelValue = typeof rule.label === 'string' ? rule.label.toLowerCase() : '';
        if (!labelValue || !labelSet.has(labelValue)) {
          return;
        }
        matchedLabelRules.push(labelValue);
        if (rule.retentionDays) {
          retentionDays = Math.max(retentionDays, this.parseRetentionDays(rule.retentionDays, retentionDays));
        }
        hasEmbedding = hasEmbedding || !!rule.generateEmbedding;
        hasHighQualityEmbedding = hasHighQualityEmbedding || !!rule.generateHighQualityEmbedding;
      });
    }

    return {
      retentionDays,
      hasEmbedding,
      hasHighQualityEmbedding,
      matchedLabelRules,
      filterId: filter?._id || null,
    };
  }

  async saveIncomingMessage(payload = {}) {
    const messageIdRaw = payload.id ?? payload.messageId;
    const messageId = messageIdRaw || messageIdRaw === 0 ? String(messageIdRaw).trim() : '';
    if (!messageId) {
      throw new Error('Message id is required.');
    }

    const existing = await this.MessageModel.findOne({ messageId }).exec();
    if (existing) {
      await this.ensureDuplicateEmbeddingIntent(existing);
      return { status: 'ignored', reason: 'duplicate', message: existing };
    }

    const normalizedFrom = this.normalizeEmail(payload.from);
    if (!normalizedFrom) {
      throw new Error('Sender email address is required.');
    }

    const { stored: labels, normalized: normalizedLabels } = this.normalizeLabels(payload.labels || []);
    const messageDate = this.parseDateInput(payload.date, new Date());

    const policy = await this.resolvePolicy(normalizedFrom, normalizedLabels);
    const retentionDeadlineDate = this.computeRetentionDate(messageDate, policy.retentionDays);

    const doc = new this.MessageModel({
      messageId,
      threadId: payload.threadId || null,
      labels,
      sizeEstimate: Number.isFinite(Number.parseInt(payload.sizeEstimate, 10))
        ? Number.parseInt(payload.sizeEstimate, 10)
        : null,
      html: payload.html || '',
      text: payload.text || '',
      textAsHtml: payload.textAsHtml || '',
      subject: payload.subject || '',
      date: messageDate,
      from: normalizedFrom,
      retentionDeadlineDate,
      hasEmbedding: false,
      hasHighQualityEmbedding: false,
      embeddingRequested: !!policy.hasEmbedding,
      highQualityEmbeddingRequested: !!policy.hasHighQualityEmbedding,
      embeddingStatus: policy.hasEmbedding ? 'pending' : 'disabled',
      highQualityEmbeddingStatus: policy.hasHighQualityEmbedding ? 'pending' : 'disabled',
      appliedRetentionDays: policy.retentionDays,
      appliedFilterId: policy.filterId,
      appliedLabelRules: policy.matchedLabelRules,
    });
    try {
      await doc.save();
    } catch (error) {
      if (error?.code === 11000) {
        const existingDoc = await this.MessageModel.findOne({ messageId }).exec();
        if (existingDoc) await this.ensureDuplicateEmbeddingIntent(existingDoc);
        return { status: 'ignored', reason: 'duplicate', message: existingDoc };
      }
      throw error;
    }

    await this.generateEmbeddingsForMessage(doc, {
      generateDefault: !!policy.hasEmbedding,
      generateHighQuality: !!policy.hasHighQualityEmbedding,
    });

    logger.debug('Inbox message saved', {
      category: 'message_inbox',
      metadata: {
        senderDomain: this.emailDomain(normalizedFrom),
        retentionDays: policy.retentionDays,
        hasEmbedding: !!doc.hasEmbedding,
        hasHighQualityEmbedding: !!doc.hasHighQualityEmbedding,
      },
    });

    return { status: 'saved', message: doc, policy };
  }

  async ensureDuplicateEmbeddingIntent(message) {
    let generateDefault = this.isEmbeddingRequested(message, 'default');
    let generateHighQuality = this.isEmbeddingRequested(message, 'high_quality');
    let changed = false;

    if (typeof message.embeddingRequested !== 'boolean'
      || typeof message.highQualityEmbeddingRequested !== 'boolean') {
      const { normalized: normalizedLabels } = this.normalizeLabels(message.labels || []);
      const policy = await this.resolvePolicy(message.from, normalizedLabels);
      if (typeof message.embeddingRequested !== 'boolean') {
        generateDefault = Boolean(message.hasEmbedding || policy.hasEmbedding);
        message.embeddingRequested = generateDefault;
        message.embeddingStatus = message.hasEmbedding
          ? 'completed'
          : (generateDefault ? 'pending' : 'disabled');
        changed = true;
      }
      if (typeof message.highQualityEmbeddingRequested !== 'boolean') {
        generateHighQuality = Boolean(
          message.hasHighQualityEmbedding || policy.hasHighQualityEmbedding,
        );
        message.highQualityEmbeddingRequested = generateHighQuality;
        message.highQualityEmbeddingStatus = message.hasHighQualityEmbedding
          ? 'completed'
          : (generateHighQuality ? 'pending' : 'disabled');
        changed = true;
      }
    }

    if (changed) await message.save();
    if (generateDefault || generateHighQuality) {
      await this.generateEmbeddingsForMessage(message, {
        generateDefault,
        generateHighQuality,
      });
    }
  }

  async listMessages({ page = 1, pageSize = 25 } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safePageSize = Math.max(1, Number.parseInt(pageSize, 10) || 25);
    const total = await this.MessageModel.countDocuments().exec();
    const messages = await this.MessageModel.find()
      .sort({ date: -1, createdAt: -1 })
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .lean()
      .exec();

    return { messages, total, page: safePage, pageSize: safePageSize };
  }

  async updateMessageSettings(id, { retentionDeadlineDate, hasEmbedding, hasHighQualityEmbedding }) {
    if (!id) {
      throw new Error('Message id is required.');
    }
    const message = await this.MessageModel.findById(id).exec();
    if (!message) {
      throw new Error('Message not found.');
    }

    const previous = {
      hasEmbedding: message.hasEmbedding,
      hasHighQualityEmbedding: message.hasHighQualityEmbedding,
      embeddingRequested: this.isEmbeddingRequested(message, 'default'),
      highQualityEmbeddingRequested: this.isEmbeddingRequested(message, 'high_quality'),
    };

    if (retentionDeadlineDate instanceof Date && !Number.isNaN(retentionDeadlineDate.getTime())) {
      message.retentionDeadlineDate = retentionDeadlineDate;
    }
    if (hasEmbedding !== undefined) {
      message.embeddingRequested = !!hasEmbedding;
      message.embeddingStatus = hasEmbedding
        ? 'pending'
        : (previous.embeddingRequested || message.hasEmbedding ? 'delete_pending' : 'disabled');
    }
    if (hasHighQualityEmbedding !== undefined) {
      message.highQualityEmbeddingRequested = !!hasHighQualityEmbedding;
      message.highQualityEmbeddingStatus = hasHighQualityEmbedding
        ? 'pending'
        : (previous.highQualityEmbeddingRequested || message.hasHighQualityEmbedding
          ? 'delete_pending'
          : 'disabled');
    }

    await message.save();

    if (previous.embeddingRequested && message.embeddingRequested === false) {
      await this.deleteEmbeddingsForMessage(message, { deleteDefault: true, deleteHighQuality: false });
    }
    if (previous.highQualityEmbeddingRequested && message.highQualityEmbeddingRequested === false) {
      await this.deleteEmbeddingsForMessage(message, { deleteDefault: false, deleteHighQuality: true });
    }

    const needsDefault = message.embeddingRequested
      && (!previous.embeddingRequested || hasEmbedding !== undefined);
    const needsHighQuality = message.highQualityEmbeddingRequested
      && (!previous.highQualityEmbeddingRequested || hasHighQualityEmbedding !== undefined);

    if (needsDefault || needsHighQuality) {
      await this.generateEmbeddingsForMessage(message, {
        generateDefault: needsDefault,
        generateHighQuality: needsHighQuality,
        force: true,
      });
    }

    return message;
  }

  async deleteMessage(id) {
    if (!id) {
      throw new Error('Message id is required.');
    }
    const message = await this.MessageModel.findById(id).exec();
    if (!message) {
      return;
    }
    await this.deleteEmbeddingsForMessage(message, {
      deleteDefault: true,
      deleteHighQuality: true,
      verifySourceState: false,
    });
    await this.MessageModel.deleteOne({ _id: id }).exec();
  }

  async listFilters() {
    return this.FilterModel.find().sort({ sender: 1 }).lean().exec();
  }

  async upsertFilter({ sender, retentionDays, generateEmbedding, generateHighQualityEmbedding }) {
    const normalizedSender = this.normalizeEmail(sender);
    if (!normalizedSender) {
      throw new Error('Sender email is required.');
    }
    const retention = this.parseRetentionDays(retentionDays, DEFAULT_RETENTION_DAYS);

    return this.FilterModel.findOneAndUpdate(
      { sender: normalizedSender },
      {
        sender: normalizedSender,
        retentionDays: retention,
        generateEmbedding: !!generateEmbedding,
        generateHighQualityEmbedding: !!generateHighQualityEmbedding,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
  }

  async deleteFilter(id) {
    if (!id) {
      throw new Error('Filter id is required.');
    }
    await this.FilterModel.deleteOne({ _id: id }).exec();
  }

  async addOrUpdateLabelRule(filterId, { label, retentionDays, generateEmbedding, generateHighQualityEmbedding }) {
    if (!filterId) {
      throw new Error('Filter id is required.');
    }
    const normalizedLabel = typeof label === 'string' ? label.trim().toLowerCase() : '';
    if (!normalizedLabel) {
      throw new Error('Label is required.');
    }
    const filter = await this.FilterModel.findById(filterId).exec();
    if (!filter) {
      throw new Error('Filter not found.');
    }

    const existingIndex = filter.labelRules.findIndex((rule) => rule.label === normalizedLabel);
    const normalizedRetention = retentionDays ? this.parseRetentionDays(retentionDays, filter.retentionDays) : null;
    const rulePayload = {
      label: normalizedLabel,
      retentionDays: normalizedRetention,
      generateEmbedding: !!generateEmbedding,
      generateHighQualityEmbedding: !!generateHighQualityEmbedding,
    };

    if (existingIndex >= 0) {
      filter.labelRules[existingIndex] = rulePayload;
    } else {
      filter.labelRules.push(rulePayload);
    }

    await filter.save();
    return filter;
  }

  async removeLabelRule(filterId, label) {
    if (!filterId) {
      throw new Error('Filter id is required.');
    }
    const normalizedLabel = typeof label === 'string' ? label.trim().toLowerCase() : '';
    if (!normalizedLabel) {
      throw new Error('Label is required.');
    }
    const filter = await this.FilterModel.findById(filterId).exec();
    if (!filter) {
      throw new Error('Filter not found.');
    }
    filter.labelRules = filter.labelRules.filter((rule) => rule.label !== normalizedLabel);
    await filter.save();
    return filter;
  }

  async generateEmbeddingsForMessage(message, { generateDefault = false, generateHighQuality = false, force = false } = {}) {
    const text = this.getMessageText(message);
    if (!text) {
      return;
    }
    const metadata = [this.buildSourceMetadata(message)];
    let changed = false;
    const queue = this.getEmbeddingQueueService();

    if (generateDefault) {
      try {
        const queuedJob = await queue.enqueue(text, { autoChunk: true }, metadata, {
          mode: 'default',
          force,
        });
        const nextStatus = queuedJob?.status === 'completed'
          ? 'completed'
          : (queuedJob?.status === 'failed' ? 'failed' : 'pending');
        if (message.embeddingStatus !== nextStatus) {
          message.embeddingStatus = nextStatus;
          changed = true;
        }
      } catch (error) {
        logger.error('Failed to queue default embedding for message', {
          category: 'message_inbox',
          metadata: { id: String(message._id), error: error.message },
        });
        if (message.embeddingStatus !== 'pending') {
          message.embeddingStatus = 'pending';
          changed = true;
        }
      }
    }

    if (generateHighQuality) {
      try {
        const queuedJob = await queue.enqueue(text, { autoChunk: true, task: 'document' }, metadata, {
          mode: 'high_quality',
          force,
        });
        const nextStatus = queuedJob?.status === 'completed'
          ? 'completed'
          : (queuedJob?.status === 'failed' ? 'failed' : 'pending');
        if (message.highQualityEmbeddingStatus !== nextStatus) {
          message.highQualityEmbeddingStatus = nextStatus;
          changed = true;
        }
      } catch (error) {
        logger.error('Failed to queue high-quality embedding for message', {
          category: 'message_inbox',
          metadata: { id: String(message._id), error: error.message },
        });
        if (message.highQualityEmbeddingStatus !== 'pending') {
          message.highQualityEmbeddingStatus = 'pending';
          changed = true;
        }
      }
    }

    if (changed) {
      await message.save();
    }
  }

  async deleteEmbeddingsForMessage(message, {
    deleteDefault = true,
    deleteHighQuality = true,
    verifySourceState = true,
  } = {}) {
    const metadata = this.buildSourceMetadata(message);
    const queue = this.getEmbeddingQueueService();
    if (deleteDefault) {
      await queue.enqueueDelete(metadata, {
        mode: 'default',
        force: true,
        verifySourceState,
      });
    }
    if (deleteHighQuality) {
      await queue.enqueueDelete(metadata, {
        mode: 'high_quality',
        force: true,
        verifySourceState,
      });
    }
  }
}

module.exports = {
  MessageInboxService,
  DEFAULT_RETENTION_DAYS,
};
