const mongoose = require('mongoose');

const Conversation5 = new mongoose.Schema({
  title: { type: String, required: true, max: 255 },
  summary: { type: String },
  category: { type: String, required: true, max: 100, index: true },
  tags: [{ type: String, max: 100 }],

  messages: [{ type: String, required: true, max: 100 }],

  metadata: {
    contextPrompt: { type: String, default: "" },
    model: { type: String, default: "gpt-4.1-2025-04-14" },
    maxMessages: { type: Number, default: 999 },
    maxAudioMessages: { type: Number, default: 3 },
    tools: [{ type: String, max: 100 }],
    reasoning: { type: String, enum: ["minimal", "low", "medium", "high", "xhigh"], default: "medium" },
    verbosity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    outputFormat: { type: String, enum: ["text", "json"], default: "text" },
  },

  members: [{ type: String, required: true, max: 100 }],
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('conversation5', Conversation5);
