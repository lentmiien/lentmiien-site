const mongoose = require('mongoose');

const PendingRequests = new mongoose.Schema({
  response_id: { type: String, required: true, index: true },
  conversation_id: { type: String, required: true },
  placeholder_id: { type: String, required: true },
  sourceType: { type: String, default: null, index: true },
  sourceId: { type: String, default: null, index: true },
  processingStartedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('pending_requests', PendingRequests);
