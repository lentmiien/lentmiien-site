const mongoose = require('mongoose');

const Chat5TemplateSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, unique: true, index: true },
  source: { type: String, enum: ['chat5', 'chat4', 'unknown'], default: 'unknown' },
  label: { type: String, default: '' },
  lastCachedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('chat5_template', Chat5TemplateSchema);
