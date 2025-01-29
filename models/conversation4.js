const mongoose = require('mongoose');

const Conversation4 = new mongoose.Schema({
  user_id: { type: String, required: true, max: 100 },
  group_id: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 255 },
  description: { type: String },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  context_prompt: { type: String },
  knowledge_injects: [
    {
      knowledge_id: { type: String, required: true },
      use_type: { type: String, required: true, enum: ['context', 'reference', 'example'] },
    }
  ],
  messages: [{ type: String, required: true, max: 100 }],
  updated_date: {
    type: Date,
    default: Date.now,
  },
  default_model: { type: String, max: 100 },
  max_messages: { type: Number },
});

module.exports = mongoose.model('conversation4', Conversation4);
