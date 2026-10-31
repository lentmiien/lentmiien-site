const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  title: { type: String, required: true },
  custom_id: { type: String, required: true },
  conversation_id: { type: String, required: true, max: 100 },
  request_id: { type: String, required: true, max: 100 },
  user_id: { type: String, required: true, max: 100 },
  message_id: { type: String, max: 100 },
  state: { type: String, enum: ['queued', 'failed', 'succeeded', 'retrying'], default: 'queued' },
  failure: {
    reason: String,
    providerCode: String,
    status: Number,
    at: Date,
    requestId: String,
  },
  retry_count: { type: Number, default: 0 },
  retry_principal_id: { type: mongoose.Schema.Types.ObjectId },
  model: {
    type: String,
    default: 'gpt-5.5'
  },
  task_type: {
    type: String,
    enum: ['response', 'summary'],
    default: 'response',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('batchprompt', BatchPrompt);
