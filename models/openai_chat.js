const mongoose = require('mongoose');

const Openai_chat = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  role: { type: String, required: true, max: 100 },
  model: { type: String, required: true, max: 100 },
  content: { type: String, required: true },
  created: { type: Date, required: true },
  thread_id: { type: String, required: true },
});

module.exports = mongoose.model('openai_chat', Openai_chat);
