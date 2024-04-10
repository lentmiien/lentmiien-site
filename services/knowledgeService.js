const marked = require('marked');

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
  constructor(knowledgeModel) {
    this.knowledgeModel = knowledgeModel;
  }

  async getKnowledgesById(k_id) {
    const knowledge = await this.knowledgeModel.findById(k_id);
    knowledge.contentHTML = marked.parse(knowledge.contentMarkdown);
    return knowledge;
  }

  async getKnowledgesByUser(user_id) {
    return await this.knowledgeModel.find({ user_id });
  }

  async getKnowledgesByIdArray(k_ids) {
    return await this.knowledgeModel.find({ _id: k_ids });
  }

  async getKnowledgesByCategory(category) {
    return await this.knowledgeModel.find({ category });
  }

  async createKnowledge(title, originConversationId, contentMarkdown, category, tags, images, user_id) {
    const date = new Date();
    const knowledge_entry = {
      title,
      createdDate: date,
      updatedDate: date,
      originConversationId,
      contentMarkdown,
      category,
      tags,
      images,
      user_id,
    };
    const entry = await new this.knowledgeModel(knowledge_entry).save();
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
    return k_id;
  }
}

module.exports = KnowledgeService;