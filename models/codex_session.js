const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexSessionSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  workspaceId: { type: String, required: true, index: true },
  targetId: { type: String, required: true, index: true },
  codexThreadId: { type: String, default: null, unique: true, sparse: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  summary: { type: String, default: '', trim: true, maxlength: 2000 },
  status: {
    type: String,
    enum: ['pending', 'active', 'failed', 'archived'],
    default: 'pending',
    index: true,
  },
  createdBy: { type: UserRefSchema, default: () => ({}) },
  firstTurnId: { type: String, default: null },
  lastTurnId: { type: String, default: null, index: true },
  lastResponsePreview: { type: String, default: '', trim: true, maxlength: 500 },
  turnCount: { type: Number, default: 0, min: 0 },
  archivedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

CodexSessionSchema.index({ workspaceId: 1, updatedAt: -1 });
CodexSessionSchema.index({ 'createdBy.id': 1, updatedAt: -1 });
CodexSessionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('codex_session', CodexSessionSchema);
