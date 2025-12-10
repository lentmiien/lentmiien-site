const marked = require('marked');
const logger = require('../utils/logger');

const KNOWLEDGE_COLLECTION = 'knowledge';
const KNOWLEDGE_CONTENT_TYPE = 'knowledge_entry';
const KNOWLEDGE_PARENT_COLLECTION = 'conversation';
let EmbeddingApiService;

// Knowledge service operations: managing knowledge (text pieces) entries

/* knowledgeModel
{
  title: { type: String, required: true, max: 100 },
  createdDate: { type: Date, required: true },
  updatedDate: { type: Date, required: true },
  originConversationId: { type: String, required: true, max: 100 },
  contentMarkdown: { type: String, required: true },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  images: [{ type: String, max: 100 }],
  user_id: { type: String, required: true, max: 100 },
}
*/

class KnowledgeService {
  constructor(knowledgeModel, embeddingApiService = null) {
    this.knowledgeModel = knowledgeModel;
    this.embeddingApiService = embeddingApiService;
  }

  getEmbeddingService() {
    if (!this.embeddingApiService) {
      if (!EmbeddingApiService) {
        EmbeddingApiService = require('./embeddingApiService');
      }
      this.embeddingApiService = new EmbeddingApiService();
    }
    return this.embeddingApiService;
  }

  buildEmbeddingText(knowledge) {
    const tags = Array.isArray(knowledge.tags) ? knowledge.tags.join(', ') : '';
    const parts = [
      knowledge.title,
      knowledge.contentMarkdown,
      knowledge.category,
      tags || '',
    ];
    return parts.filter(Boolean).join('\n\n').trim();
  }

  buildEmbeddingMetadata(knowledge) {
    const documentId = knowledge?._id?.toString?.() || knowledge?._id || '';
    return {
      collectionName: KNOWLEDGE_COLLECTION,
      documentId,
      contentType: KNOWLEDGE_CONTENT_TYPE,
      parentCollection: KNOWLEDGE_PARENT_COLLECTION,
      parentId: knowledge?.originConversationId || null,
    };
  }

  async syncKnowledgeEmbeddings(knowledge) {
    if (!knowledge) return;

    const text = this.buildEmbeddingText(knowledge);
    if (!text) {
      throw new Error('Knowledge entry is missing text to embed.');
    }

    const metadata = this.buildEmbeddingMetadata(knowledge);
    const embeddingService = this.getEmbeddingService();
    await embeddingService.embed([text], {}, [metadata]);
    await embeddingService.embedHighQuality([text], {}, [metadata]);
  }

  async getKnowledgesById(k_id) {
    const knowledge = await this.knowledgeModel.findById(k_id);
    // Backward compatibility: default to chat4 if not set
    if (!knowledge.originType) knowledge.originType = 'chat4';
    knowledge.contentHTML = marked.parse(knowledge.contentMarkdown);
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
    await this.syncKnowledgeEmbeddings(entry).catch((error) => {
      logger.error('Failed to embed knowledge entry after creation', {
        category: 'knowledge',
        metadata: {
          knowledgeId: entry._id?.toString(),
          title,
          user_id,
          message: error?.message || error,
        },
      });
    });
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

    await entry.save();
    await this.syncKnowledgeEmbeddings(entry).catch((error) => {
      logger.error('Failed to embed knowledge entry after update', {
        category: 'knowledge',
        metadata: {
          knowledgeId: k_id,
          title,
          message: error?.message || error,
        },
      });
    });
    return k_id;
  }

  async deleteKnovledgeById(id) {
    return await this.knowledgeModel.deleteOne({_id: id});
  }

  async embedAllKnowledges(user_id) {
    const knowledges = await this.getKnowledgesByUser(user_id);
    const summary = {
      totalCount: knowledges.length,
      embeddedCount: 0,
      failed: [],
    };

    for (let i = 0; i < knowledges.length; i++) {
      const knowledge = knowledges[i];
      try {
        await this.syncKnowledgeEmbeddings(knowledge);
        summary.embeddedCount += 1;
      } catch (error) {
        const knowledgeId = knowledge?._id?.toString?.() || knowledge?._id || '';
        summary.failed.push({
          knowledgeId,
          title: knowledge?.title || '',
          message: error?.message || 'Embedding failed.',
        });
        logger.error('Failed to embed knowledge entry', {
          category: 'knowledge',
          metadata: {
            knowledgeId,
            title: knowledge?.title,
            user_id: knowledge?.user_id,
            message: error?.message || error,
          },
        });
      }
    }

    return summary;
  }
}

module.exports = KnowledgeService;
