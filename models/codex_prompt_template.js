const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexPromptTemplateSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  prompt: { type: String, required: true, trim: true, maxlength: 500000 },
  updatedBy: { type: UserRefSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

CodexPromptTemplateSchema.index({ ownerId: 1, name: 1 });

module.exports = mongoose.model('codex_prompt_template', CodexPromptTemplateSchema);
