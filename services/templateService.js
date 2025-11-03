const logger = require('../utils/logger');

function cloneDeep(value) {
  if (value === null || value === undefined) return value;
  if (typeof global.structuredClone === 'function') {
    return global.structuredClone(value);
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(cloneDeep);
  }
  if (typeof value === 'object') {
    const output = {};
    for (const [k, v] of Object.entries(value)) {
      output[k] = cloneDeep(v);
    }
    return output;
  }
  return value;
}

function toPlainObject(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true, versionKey: false });
  }
  if (doc instanceof Map) {
    return Object.fromEntries(doc);
  }
  if (Array.isArray(doc)) {
    return doc.map(toPlainObject);
  }
  if (typeof doc === 'object') {
    return { ...doc };
  }
  return doc;
}

// Template service operations: managing templates (legacy + chat5_template system)
class TemplateService {
  constructor(templateModel, options = {}) {
    this.templateModel = templateModel;

    const {
      chat5TemplateModel = null,
      conversationService = null
    } = options || {};

    this.chat5TemplateModel = chat5TemplateModel;
    this.conversationService = conversationService;

    this.chat5TemplateCache = new Map(); // conversationId -> { conversation, messages, source, fetchedAt }
  }

  // Legacy template helpers -------------------------------------------------

  async getTemplates() {
    return await this.templateModel.find();
  }

  async getTemplatesByIdArray(ids) {
    return await this.templateModel.find({ _id: ids });
  }

  async createTemplate(title, type, category, text) {
    const entry = {
      Title: title,
      Type: type,
      Category: category,
      TemplateText: text,
    };
    const dbEntry = await new this.templateModel(entry).save();
    return dbEntry;
  }

  async updateTemplate(templateId, newTitle, newType, newCategory, newText) {
    const entry = await this.templateModel.find({ _id: templateId });
    entry[0].Title = newTitle;
    entry[0].Type = newType;
    entry[0].Category = newCategory;
    entry[0].TemplateText = newText;
    await entry[0].save();
    return entry[0];
  }

  async deleteTemplateById(id) {
    await this.templateModel.deleteOne({ _id: id });
  }

  // Chat5 template system ---------------------------------------------------

  _ensureChat5Support() {
    if (!this.chat5TemplateModel || !this.conversationService) {
      throw new Error('Chat5 template support is not configured for this TemplateService instance.');
    }
  }

  _normalizeId(conversationId) {
    if (conversationId === undefined || conversationId === null) return null;
    const trimmed = String(conversationId).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async _fetchConversationSnapshot(conversationId) {
    try {
      const { conv, msg, source } = await this.conversationService.loadConversation(conversationId);
      const conversation = toPlainObject(conv);
      const messages = Array.isArray(msg) ? msg.map(toPlainObject) : [];
      const mappedSource = source === 'conversation4' ? 'chat4' : 'chat5';
      return { conversation, messages, source: mappedSource };
    } catch (error) {
      logger.warning('Failed to fetch conversation snapshot for template', { conversationId, error: error.message });
      throw error;
    }
  }

  async _loadChat5Template(conversationId, { forceRefresh = false } = {}) {
    this._ensureChat5Support();
    const normalizedId = this._normalizeId(conversationId);
    if (!normalizedId) {
      throw new Error('A valid conversationId is required.');
    }

    if (!forceRefresh && this.chat5TemplateCache.has(normalizedId)) {
      return this.chat5TemplateCache.get(normalizedId);
    }

    const record = await this.chat5TemplateModel.findOne({ conversationId: normalizedId });
    if (!record) {
      this.chat5TemplateCache.delete(normalizedId);
      return null;
    }

    const snapshot = await this._fetchConversationSnapshot(normalizedId);
    const now = new Date();
    this.chat5TemplateCache.set(normalizedId, { ...snapshot, fetchedAt: now });

    record.source = snapshot.source;
    record.lastCachedAt = now;
    await record.save();

    return this.chat5TemplateCache.get(normalizedId);
  }

  _cloneCachedTemplate(entry) {
    if (!entry) return null;
    return cloneDeep(entry);
  }

  async listChat5TemplateIds() {
    this._ensureChat5Support();
    const entries = await this.chat5TemplateModel.find({}, { conversationId: 1, _id: 0 }).sort({ updatedAt: -1 }).lean();
    return entries.map(entry => entry.conversationId);
  }

  async isChat5Template(conversationId) {
    this._ensureChat5Support();
    const normalizedId = this._normalizeId(conversationId);
    if (!normalizedId) return false;
    const cached = this.chat5TemplateCache.has(normalizedId);
    if (cached) return true;
    const exists = await this.chat5TemplateModel.exists({ conversationId: normalizedId });
    return !!exists;
  }

  async addChat5Template(conversationId, { refresh = true } = {}) {
    this._ensureChat5Support();
    const normalizedId = this._normalizeId(conversationId);
    if (!normalizedId) {
      throw new Error('conversationId is required to add a chat5 template.');
    }

    const snapshot = await this._fetchConversationSnapshot(normalizedId);
    let record = await this.chat5TemplateModel.findOne({ conversationId: normalizedId });
    if (!record) {
      record = new this.chat5TemplateModel({ conversationId: normalizedId });
    }
    record.source = snapshot.source;
    if (refresh) {
      record.lastCachedAt = new Date();
    }
    await record.save();

    if (refresh) {
      const cacheEntry = { ...snapshot, fetchedAt: record.lastCachedAt };
      this.chat5TemplateCache.set(normalizedId, cacheEntry);
      return { record: toPlainObject(record), template: this._cloneCachedTemplate(cacheEntry) };
    }

    this.chat5TemplateCache.delete(normalizedId);
    return { record: toPlainObject(record), template: null };
  }

  async removeChat5Template(conversationId) {
    this._ensureChat5Support();
    const normalizedId = this._normalizeId(conversationId);
    if (!normalizedId) return { deletedCount: 0 };
    this.chat5TemplateCache.delete(normalizedId);
    const result = await this.chat5TemplateModel.deleteOne({ conversationId: normalizedId });
    return { deletedCount: result.deletedCount || 0 };
  }

  async getChat5Template(conversationId, { refresh = false } = {}) {
    const entry = await this._loadChat5Template(conversationId, { forceRefresh: refresh });
    return this._cloneCachedTemplate(entry);
  }

  async fetchChat5Templates({ refresh = false } = {}) {
    this._ensureChat5Support();
    const ids = await this.listChat5TemplateIds();
    const results = [];
    for (const id of ids) {
      const data = await this._loadChat5Template(id, { forceRefresh: refresh });
      if (data) {
        results.push({ conversationId: id, ...this._cloneCachedTemplate(data) });
      }
    }
    return results;
  }

  async refreshChat5Template(conversationId) {
    const entry = await this._loadChat5Template(conversationId, { forceRefresh: true });
    return this._cloneCachedTemplate(entry);
  }

  async refreshAllChat5Templates() {
    const ids = await this.listChat5TemplateIds();
    const refreshed = [];
    for (const id of ids) {
      const data = await this._loadChat5Template(id, { forceRefresh: true });
      if (data) {
        refreshed.push({ conversationId: id, ...this._cloneCachedTemplate(data) });
      }
    }
    return refreshed;
  }
}

module.exports = TemplateService;
