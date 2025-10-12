// models/bulk_job.js
const mongoose = require('mongoose');

const BulkJobSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  workflow: { type: String, required: true, trim: true },
  prompt_templates: [{
    label: { type: String, required: true, trim: true },
    template: { type: String, required: true, trim: true }
  }],
  placeholder_keys: { type: [String], default: [] },
  placeholder_values: [{
    key: { type: String, required: true, trim: true },
    values: { type: [String], default: [] }
  }],
  image_inputs: [{
    key: { type: String, required: true, trim: true },
    values: { type: [String], default: [] }
  }],
  negative_prompt: { type: String, default: null },
  status: {
    type: String,
    enum: ['Created', 'Paused', 'Processing', 'Completed', 'Canceled'],
    default: 'Created'
  },
  base_inputs: { type: mongoose.Schema.Types.Mixed, default: {} },
  counters: {
    total: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    processing: { type: Number, default: 0 },
    paused: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    canceled: { type: Number, default: 0 }
  },
  progress: { type: Number, default: 0 }, // 0-1 range
  variables_available: { type: [String], default: [] },
  last_prompt_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'bulk_test_prompt',
    default: null
  },
  started_at: { type: Date },
  completed_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { versionKey: false });

BulkJobSchema.pre('save', function saveHook(next) {
  this.updated_at = new Date();
  next();
});

BulkJobSchema.index({ status: 1, updated_at: -1 });

module.exports = mongoose.model('bulk_job', BulkJobSchema);
