const mongoose = require('mongoose');

const Chat3_knowledge_t = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  version: { type: Number, required: true },
  createdDate: { type: Date, required: true },
  description: { type: String, required: true },
  dataFormat: { type: String, required: true },
});

module.exports = mongoose.model('chat3_knowledge_t', Chat3_knowledge_t);
