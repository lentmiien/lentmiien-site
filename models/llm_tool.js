const mongoose = require('mongoose');

const llmToolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 64,
    match: /^[a-zA-Z0-9_-]+$/,
  },
  displayName: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', maxlength: 4000 },
  enabled: { type: Boolean, default: true, index: true },
  handlerKey: { type: String, required: true, trim: true, maxlength: 160, index: true },
  sourcePath: { type: String, default: '', trim: true, maxlength: 300 },
  tags: { type: [String], default: [] },
  toolDefinition: { type: mongoose.Schema.Types.Mixed, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: String, default: 'system', maxlength: 100 },
  updatedBy: { type: String, default: 'system', maxlength: 100 },
  lastSeededAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'llm_tools',
});

llmToolSchema.index({ name: 1, enabled: 1 });
llmToolSchema.index({ tags: 1 });

module.exports = mongoose.model('LlmTool', llmToolSchema);
