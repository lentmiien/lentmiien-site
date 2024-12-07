const mongoose = require('mongoose');

const OpenAIUsage = new mongoose.Schema({
  entry_date: { type: String, required: true, max: 11 },
  completions: [{ type: Object }],
  embeddings: [{ type: Object }],
  images: [{ type: Object }],
  speeches: [{ type: Object }],
  transcriptions: [{ type: Object }],
  cost: { type: Number, required: true },
});

module.exports = mongoose.model('openai_usage', OpenAIUsage);
