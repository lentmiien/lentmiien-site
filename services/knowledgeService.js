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
  author: { type: String, required: true, max: 100 },
}
*/

class KnowledgeService {
  constructor(knowledgeModel) {
    this.knowledgeModel = knowledgeModel;
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

  async createKnowledge(user_id, input_values) {}

  async updateKnowledge(k_id, update_values) {}
}

module.exports = KnowledgeService;