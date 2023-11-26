const mongoose = require('mongoose');

const Chat3_knowledge = new mongoose.Schema({
  templateId: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 100 },
  createdDate: { type: Date, required: true },
  originId: { type: String, required: true, max: 100 },
  data: { type: String, required: true },
  category: { type: String, required: true, max: 100 },
  author: { type: String, required: true, max: 100 },
});

module.exports = mongoose.model('chat3_knowledge', Chat3_knowledge);
