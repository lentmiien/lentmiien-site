const mongoose = require('mongoose');

const PendingRequests = new mongoose.Schema({
  response_id: { type: String, required: true },
  conversation_id: { type: String, required: true },
  placeholder_id: { type: String, required: true },
});

module.exports = mongoose.model('pending_requests', PendingRequests);
