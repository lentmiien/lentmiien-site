const mongoose = require('mongoose');

const ChatResponseTypeSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  instructions: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('chat_response_type', ChatResponseTypeSchema);
