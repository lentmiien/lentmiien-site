// Template service operations: managing templates

/* templateModel
{
  Title: { type: String, required: true, max: 100 },
  Type: { type: String, required: true, max: 100 },
  Category: { type: String, required: true, max: 100 },
  TemplateText: { type: String, required: true },
}
*/

class TemplateService {
  constructor(templateModel) {
    this.templateModel = templateModel;
  }

  async getTemplates() {
    return await this.templateModel.find();
  }

  async createTemplate(title, type, category, text) {
    // const message = await this.messageModel.create({
    //   conversationId,
    //   text,
    //   sender,
    //   createdAt: new Date(),
    // });
    // return message;
  }

  async updateTemplate(templateId, newTitle, newType, newCategory, newText) {
    // const message = await this.messageModel.findByIdAndUpdate(
    //   messageId,
    //   { text: newText },
    //   { new: true }
    // );
    // return message;
  }
}

module.exports = TemplateService;