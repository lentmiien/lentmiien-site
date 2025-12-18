const logger = require('../utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;

class MessageInboxService {
  constructor(MessageModel, FilterModel) {
    this.MessageModel = MessageModel;
    this.FilterModel = FilterModel;
  }

  normalizeEmail(value) {
    if (!value && value !== 0) {
      return '';
    }
    return String(value).trim().toLowerCase();
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
      hasEmbedding: !!policy.hasEmbedding,
      hasHighQualityEmbedding: !!policy.hasHighQualityEmbedding,
      appliedRetentionDays: policy.retentionDays,
      appliedFilterId: policy.filterId,
      appliedLabelRules: policy.matchedLabelRules,
    });
    try {
      await doc.save();
    } catch (error) {
      if (error?.code === 11000) {
        const existingDoc = await this.MessageModel.findOne({ messageId }).lean().exec();
        return { status: 'ignored', reason: 'duplicate', message: existingDoc };
      }
      throw error;
    }

    logger.notice('Message saved', {
      category: 'message_inbox',
      metadata: {
        messageId,
        from: normalizedFrom,
        retentionDays: policy.retentionDays,
        hasEmbedding: !!policy.hasEmbedding,
        hasHighQualityEmbedding: !!policy.hasHighQualityEmbedding,
      },
    });

    return { status: 'saved', message: doc, policy };
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
    const updatePayload = {};
    if (retentionDeadlineDate instanceof Date && !Number.isNaN(retentionDeadlineDate.getTime())) {
      updatePayload.retentionDeadlineDate = retentionDeadlineDate;
    }
    if (hasEmbedding !== undefined) {
      updatePayload.hasEmbedding = !!hasEmbedding;
    }
    if (hasHighQualityEmbedding !== undefined) {
      updatePayload.hasHighQualityEmbedding = !!hasHighQualityEmbedding;
    }

    return this.MessageModel.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true },
    ).exec();
  }

  async deleteMessage(id) {
    if (!id) {
      throw new Error('Message id is required.');
    }
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
}

module.exports = {
  MessageInboxService,
  DEFAULT_RETENTION_DAYS,
};
