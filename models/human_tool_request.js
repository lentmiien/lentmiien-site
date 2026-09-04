const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const PrincipalRefSchema = new Schema({
  id: { type: String, required: true, trim: true, maxlength: 160 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
}, { _id: false });

const HumanToolRequestSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  originKey: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
  },
  requestHash: {
    type: String,
    required: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
  },
  toolName: { type: String, required: true, trim: true, maxlength: 64 },
  variant: {
    type: String,
    enum: ['codex', 'general'],
    required: true,
    index: true,
  },
  prompt: { type: String, required: true, maxlength: 20000 },
  response: { type: String, default: '', maxlength: 20000 },
  status: {
    type: String,
    enum: ['pending', 'responded', 'timed_out'],
    default: 'pending',
    index: true,
  },
  conversationId: { type: String, default: '', trim: true, maxlength: 160, index: true },
  responseId: { type: String, default: '', trim: true, maxlength: 240, index: true },
  toolCallId: { type: String, default: '', trim: true, maxlength: 240 },
  createdBy: { type: PrincipalRefSchema, required: true },
  respondedBy: { type: PrincipalRefSchema, default: undefined },
  respondedAt: { type: Date, default: null },
  timedOutAt: { type: Date, default: null },
  lastWaitHeartbeatAt: { type: Date, default: null },
  deleteAfter: { type: Date, required: true },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'human_tool_requests',
});

HumanToolRequestSchema.index({ status: 1, createdAt: -1 });
HumanToolRequestSchema.index({ 'createdBy.id': 1, status: 1, createdAt: -1 });
HumanToolRequestSchema.index({ deleteAfter: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('human_tool_request', HumanToolRequestSchema);
