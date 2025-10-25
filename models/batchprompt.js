const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  title: { type: String, required: true },
  custom_id: { type: String, required: true },
  conversation_id: { type: String, required: true, max: 100 },
  request_id: { type: String, required: true, max: 100 },
  user_id: { type: String, required: true, max: 100 },
  message_id: { type: String, max: 100 },
  model: {
    type: String,
    default: 'gpt-4.1-2025-04-14'
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
