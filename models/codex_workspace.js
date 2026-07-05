const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodexWorkspaceSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  targetId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 140, index: true },
  rootPath: { type: String, required: true, trim: true, maxlength: 1200 },
  pathStyle: {
    type: String,
    enum: ['windows', 'posix'],
    default: 'posix',
  },
  enabled: { type: Boolean, default: true, index: true },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  defaultModel: { type: String, default: '', trim: true, maxlength: 120 },
  defaultProfile: { type: String, default: '', trim: true, maxlength: 120 },
  defaultQuestionPermission: {
    type: String,
    enum: ['read-only', 'workspace-write'],
    default: 'read-only',
  },
  defaultActionPermission: {
    type: String,
    enum: ['read-only', 'workspace-write'],
    default: 'workspace-write',
  },
  allowYolo: { type: Boolean, default: false, index: true },
  maxConcurrentTurns: { type: Number, default: 1, min: 1, max: 1 },
}, {
  timestamps: true,
  versionKey: false,
});

CodexWorkspaceSchema.index({ targetId: 1, rootPath: 1 }, { unique: true });
CodexWorkspaceSchema.index({ enabled: 1, name: 1 });

module.exports = mongoose.model('codex_workspace', CodexWorkspaceSchema);
