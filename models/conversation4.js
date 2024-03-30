const mongoose = require('mongoose');

const Conversation4 = new mongoose.Schema({
  user_id: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 255 },
  description: { type: String },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  context_prompt: { type: String },
  messages: [{ type: String, required: true, max: 100 }],
});

module.exports = mongoose.model('conversation4', Conversation4);
