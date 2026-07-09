const mongoose = require('mongoose');

const { Schema } = mongoose;

const REASONING_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexRequestProfileSchema = new Schema({
  _id: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 80,
    match: /^[a-z0-9_-]+$/,
  },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  model: { type: String, default: '', trim: true, maxlength: 120 },
  codexProfile: { type: String, default: '', trim: true, maxlength: 120 },
  reasoningEffort: {
    type: String,
    enum: REASONING_EFFORTS,
    default: '',
  },
  enabled: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 100, min: 0 },
  updatedBy: { type: UserRefSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

CodexRequestProfileSchema.index({ enabled: 1, sortOrder: 1, name: 1 });

module.exports = mongoose.model('codex_request_profile', CodexRequestProfileSchema);
