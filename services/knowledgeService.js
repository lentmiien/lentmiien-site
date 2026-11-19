const { randomUUID } = require('node:crypto');
const logger = require('../utils/logger');
const { renderMarkdownSafe } = require('../utils/chat5Markdown');
const { errorDiagnostics } = require('../utils/errorDiagnostics');

class KnowledgeService {
  constructor(knowledgeModel, queue = null) {
    this.knowledgeModel = knowledgeModel;
    this.queue = queue;
  }

  getQueue() {
    if (!this.queue) this.queue = require('./embeddingQueueService');
    return this.queue;
  }

  async queueSavedEntry(entry) {
    try {
      await this.getQueue().enqueueKnowledge(entry);
    } catch (error) {
      logger.warning('Knowledge indexing request remains pending for reconciliation', {
        category: 'knowledge', metadata: { knowledgeId: String(entry._id), ...errorDiagnostics(error) },
      });
    }
  }

  async getKnowledgesById(k_id) {
    const knowledge = await this.knowledgeModel.findById(k_id);
    if (!knowledge) {
      return null;
    }
    // Backward compatibility: default to chat4 if not set
    if (!knowledge.originType) knowledge.originType = 'chat4';
    knowledge.contentHTML = renderMarkdownSafe(knowledge.contentMarkdown);
    return knowledge;
  }

  async getKnowledgesByUser(user_id) {
    const list = await this.knowledgeModel.find({ user_id }).sort({ updatedDate: -1 }).exec();
    // Ensure originType is present for legacy entries
    list.forEach(k => { if (!k.originType) k.originType = 'chat4'; });
    return list;
  }

  async getKnowledgesByIdArray(k_ids) {
    return await this.knowledgeModel.find({ _id: k_ids });
  }

  async getKnowledgesByCategory(category) {
    return await this.knowledgeModel.find({ category });
  }

  async createKnowledge(title, originConversationId, contentMarkdown, category, tags, images, user_id, originType = 'chat4') {
    const date = new Date();
    const knowledge_entry = {
      title,
      pendingEmbeddingRevision: randomUUID(),
      pendingEmbeddingModes: ['default', 'high_quality'],
      createdDate: date,
      updatedDate: date,
      originConversationId,
      originType,
      contentMarkdown,
      category,
      tags,
      images,
      user_id,
    };
    const entry = await new this.knowledgeModel(knowledge_entry).save();
    await this.queueSavedEntry(entry);
    return entry._id.toString();
  }

  async updateKnowledge(k_id, title, contentMarkdown, category, tags, images) {
    const date = new Date();
    const entry = await this.knowledgeModel.findById(k_id);

    entry.title = title;
    entry.updatedDate = date;
    entry.contentMarkdown = contentMarkdown;
    entry.category = category;
    entry.tags = tags;
    entry.images = images;
    entry.pendingEmbeddingRevision = randomUUID();
    entry.pendingEmbeddingModes = ['default', 'high_quality'];
    entry.markModified('pendingEmbeddingModes');

    await entry.save();
    await this.queueSavedEntry(entry);
    return k_id;
  }

  async deleteKnovledgeById(id) {
    const entry = await this.knowledgeModel.findById(id);
    if (entry) await this.getQueue().enqueueKnowledgeDeletion(entry);
    return this.knowledgeModel.deleteOne({ _id: id });
  }

  async embedAllKnowledges(user_id) {
    const knowledges = await this.getKnowledgesByUser(user_id);
    const summary = {
      totalCount: knowledges.length,
      queuedCount: 0,
      failed: [],
    };

    for (const knowledge of knowledges) {
      try {
        await this.getQueue().enqueueKnowledge(knowledge, { force: true });
        summary.queuedCount += 1;
      } catch (error) {
        const knowledgeId = knowledge?._id?.toString?.() || knowledge?._id || '';
        summary.failed.push({
          knowledgeId,
          title: knowledge?.title || '',
          message: 'Could not queue this entry.',
        });
        logger.error('Failed to queue knowledge entry for indexing', {
          category: 'knowledge',
          metadata: {
            knowledgeId,
            ...errorDiagnostics(error),
          },
        });
      }
    }

    return summary;
  }
}

module.exports = KnowledgeService;
