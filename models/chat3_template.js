const mongoose = require('mongoose');

const Chat3_template = new mongoose.Schema({
  Title: { type: String, required: true, max: 100 },
  Type: { type: String, required: true, max: 100 },
  Category: { type: String, required: true, max: 100 },
  TemplateText: { type: String, required: true },
});

module.exports = mongoose.model('chat3_template', Chat3_template);
