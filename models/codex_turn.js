const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexTurnSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  sessionId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  targetId: { type: String, required: true, index: true },
  sequence: { type: Number, required: true, min: 1 },
  kind: {
    type: String,
    enum: ['question', 'action', 'followup_question', 'followup_action'],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'blocked'],
    default: 'queued',
    index: true,
  },
  prompt: { type: String, required: true },
  finalResponse: { type: String, default: '' },
  responsePreview: { type: String, default: '', trim: true, maxlength: 500 },
  permissionMode: {
    type: String,
    enum: ['read-only', 'workspace-write', 'yolo'],
    default: 'read-only',
    index: true,
  },
  yolo: { type: Boolean, default: false, index: true },
  requestProfileId: { type: String, default: '', trim: true, maxlength: 80, index: true },
  requestProfileName: { type: String, default: '', trim: true, maxlength: 80 },
  model: { type: String, default: '', trim: true, maxlength: 120 },
  profile: { type: String, default: '', trim: true, maxlength: 120 },
  reasoningEffort: {
    type: String,
    enum: ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    default: '',
  },
  codexThreadIdSeen: { type: String, default: null, index: true },
  commandSummary: { type: Schema.Types.Mixed, default: {} },
  exitCode: { type: Number, default: null },
  exitSignal: { type: String, default: null },
  errorMessage: { type: String, default: '', trim: true, maxlength: 2000 },
  usage: { type: Schema.Types.Mixed, default: {} },
  eventCount: { type: Number, default: 0, min: 0 },
  artifactRefs: { type: [Schema.Types.Mixed], default: [] },
  createdBy: { type: UserRefSchema, default: () => ({}) },
  queuedAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  cancelRequestedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

CodexTurnSchema.index({ status: 1, queuedAt: 1 });
CodexTurnSchema.index({ workspaceId: 1, status: 1, queuedAt: 1 });
CodexTurnSchema.index({ sessionId: 1, sequence: 1 }, { unique: true });
CodexTurnSchema.index({ 'createdBy.id': 1, createdAt: -1 });
CodexTurnSchema.index({ workspaceId: 1, startedAt: -1 });
CodexTurnSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model('codex_turn', CodexTurnSchema);
