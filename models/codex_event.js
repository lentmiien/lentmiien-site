const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodexEventSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  turnId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  seq: { type: Number, required: true, min: 1 },
  eventType: { type: String, required: true, trim: true, maxlength: 160, index: true },
  stream: {
    type: String,
    enum: ['stdout-json', 'stdout', 'stderr', 'system'],
    default: 'system',
  },
  payload: { type: Schema.Types.Mixed, default: {} },
  text: { type: String, default: '' },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error'],
    default: 'info',
  },
  hiddenByDefault: { type: Boolean, default: true },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false },
  versionKey: false,
});

CodexEventSchema.index({ turnId: 1, seq: 1 }, { unique: true });
CodexEventSchema.index({ sessionId: 1, createdAt: 1 });
CodexEventSchema.index({ workspaceId: 1, createdAt: -1 });
CodexEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('codex_event', CodexEventSchema);
