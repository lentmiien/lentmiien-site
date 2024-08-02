const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  title: { type: String, required: true },
  custom_id: { type: String, required: true },
  conversation_id: { type: String, required: true, max: 100 },
  request_id: { type: String, required: true, max: 100 },
  user_id: { type: String, required: true, max: 100 },
  prompt: { type: String, required: true },
  model: {
    type: String,
    default: "gpt-4o"
  },
  images: [
    {
      filename: { type: String, required: true },
      use_flag: { type: String, required: true, enum: ['high quality', 'low quality', 'do not use'] },
    }
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('batchprompt', BatchPrompt);
