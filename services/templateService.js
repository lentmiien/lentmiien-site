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
    const entry = {
      Title: title,
      Type: type,
      Category: category,
      TemplateText: text,
    };
    const db_entry = await new this.templateModel(entry).save();
    return db_entry;
  }

  async updateTemplate(templateId, newTitle, newType, newCategory, newText) {
    const entry = await this.templateModel.find({_id: templateId});
    entry[0].Title = newTitle;
    entry[0].Type = newType;
    entry[0].Category = newCategory;
    entry[0].TemplateText = newText;
    await entry[0].save();
    return entry[0];
  }
}

module.exports = TemplateService;