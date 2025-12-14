const mongoose = require('mongoose');

const goodImageSchema = new mongoose.Schema({
  filename: { type: String, required: true, unique: true },
  original_filename: { type: String },
  job_id: { type: String, index: true },
  instance_id: { type: String, index: true },
  workflow: { type: String },
  prompt: { type: String },
  negative_prompt: { type: String },
  rating_value: { type: Number, min: 1, max: 5, required: true },
  rating_label: { type: String },
  bucket: { type: String },
  file_index: { type: Number },
  media_type: { type: String },
  model: { type: String },
  model_metadata: mongoose.Schema.Types.Mixed,
  cached_url: { type: String },
  download_url: { type: String },
  variables: mongoose.Schema.Types.Mixed,
  embedding_status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  embedding_error: { type: String },
  high_quality_embedding: { type: Boolean, default: false }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

goodImageSchema.index({ created_at: -1 });

module.exports = mongoose.model('GoodImage', goodImageSchema, 'good_images');
