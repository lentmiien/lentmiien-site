const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexTurnMessageSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  turnId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  message: { type: String, required: true, maxlength: 500000 },
  status: {
    type: String,
    enum: ['queued', 'delivering', 'delivered', 'failed'],
    default: 'queued',
    index: true,
  },
  createdBy: { type: UserRefSchema, default: () => ({}) },
  workerId: { type: String, default: '', trim: true, maxlength: 200 },
  queuedAt: { type: Date, default: Date.now, index: true },
  deliveryStartedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  errorMessage: { type: String, default: '', trim: true, maxlength: 500 },
}, {
  timestamps: true,
  versionKey: false,
});

CodexTurnMessageSchema.index({ status: 1, queuedAt: 1 });
CodexTurnMessageSchema.index({ turnId: 1, queuedAt: 1 });

module.exports = mongoose.model('codex_turn_message', CodexTurnMessageSchema);
