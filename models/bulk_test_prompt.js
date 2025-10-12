// models/bulk_test_prompt.js
const mongoose = require('mongoose');

const BulkTestPromptSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'bulk_job',
    required: true,
    index: true
  },
  template_index: { type: Number, default: 0 },
  template_label: { type: String, required: true, trim: true },
  prompt_text: { type: String, required: true, trim: true },
  placeholder_values: { type: mongoose.Schema.Types.Mixed, default: {} },
  input_values: { type: mongoose.Schema.Types.Mixed, default: {} },
  negative_used: { type: Boolean, default: false },
  variables: { type: Map, of: String, default: {} },
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Paused', 'Completed', 'Canceled'],
    default: 'Pending',
    index: true
  },
  comfy_job_id: { type: String, default: null },
  comfy_error: { type: String, default: null },
  filename: { type: String, default: null },
  file_url: { type: String, default: null },
  score_total: { type: Number, default: 0 },
  score_count: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  started_at: { type: Date },
  completed_at: { type: Date }
}, { versionKey: false });

BulkTestPromptSchema.pre('save', function saveHook(next) {
  this.updated_at = new Date();
  next();
});

BulkTestPromptSchema.index({ job: 1, status: 1, created_at: 1 });

module.exports = mongoose.model('bulk_test_prompt', BulkTestPromptSchema);
