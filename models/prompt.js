// models/prompt.js
const mongoose = require('mongoose');

const PromptSchema = new mongoose.Schema({
  type: { type: String, enum: ['positive', 'negative'], required: true },
  workflow: { type: String, required: true }, // store workflow key (e.g., 'txt2img_qwen_image')
  prompt: { type: String, required: true, trim: true },

  total_score: { type: Number, default: 0 },  // sum of all ratings (0/0.5/0.8/1)
  rating_count: { type: Number, default: 0 }, // number of ratings
  unrated_uses: { type: Number, default: 0 }, // times used but not yet rated

  created_at: { type: Date, default: Date.now },
  last_used_at: { type: Date, default: Date.now }
}, { versionKey: false });

PromptSchema.index({ type: 1, workflow: 1, prompt: 1 }, { unique: true });

// Convenience virtual
PromptSchema.virtual('average').get(function () {
  return this.rating_count > 0 ? this.total_score / this.rating_count : 0;
});

module.exports = mongoose.model('prompt', PromptSchema);