const mongoose = require('mongoose');
const { getInitialRecoveryCheckAt } = require('../services/openaiResponseRecoveryPolicy');

const PendingRequests = new mongoose.Schema({
  response_id: { type: String, required: true, index: true },
  provider: {
    type: String,
    enum: ['OpenAI', 'Ollama'],
    default: 'OpenAI',
    index: true,
  },
  conversation_id: { type: String, required: true },
  placeholder_id: { type: String, required: true },
  sourceType: { type: String, default: null, index: true },
  sourceId: { type: String, default: null, index: true },
  toolRound: { type: Number, default: 1, min: 1, max: 20 },
  processingStartedAt: { type: Date, default: null },
  recoveryState: {
    type: String,
    enum: ['pending', 'abandoned'],
    default: 'pending',
  },
  recoveryAttemptCount: { type: Number, default: 0, min: 0 },
  lastCheckedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, default: () => getInitialRecoveryCheckAt() },
  lastResponseStatus: { type: String, default: null },
  lastRetrievalError: { type: String, default: null },
  abandonedAt: { type: Date, default: null },
  abandonReason: { type: String, default: null },
}, { timestamps: true });

PendingRequests.index({
  recoveryState: 1,
  nextCheckAt: 1,
  lastCheckedAt: 1,
  createdAt: -1,
});

module.exports = mongoose.model('pending_requests', PendingRequests);
