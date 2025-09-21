const mongoose = require('mongoose');

const Chat4_knowledge = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  createdDate: { type: Date, required: true },
  updatedDate: { type: Date, required: true },
  originConversationId: { type: String, required: true, max: 100 },
  // Indicates whether originConversationId references a chat4 or chat5 conversation
  originType: { type: String, enum: ['chat4', 'chat5'], default: 'chat4' },
  contentMarkdown: { type: String, required: true },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  images: [{ type: String, max: 100 }],
  user_id: { type: String, required: true, max: 100 },
});

module.exports = mongoose.model('chat4_knowledge', Chat4_knowledge);
