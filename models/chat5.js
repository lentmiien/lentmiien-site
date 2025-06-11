const mongoose = require('mongoose');

const Chat5 = new mongoose.Schema({
  user_id: { type: String, required: true, max: 100 },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  contentType: { type: String, enum: ["text", "image", "audio", "video", "file", "tool", "reasoning"], required: true },

  content: {
    text: String,
    image: String,
    audio: String,
    tts: String,
    transcript: String,
    revisedPrompt: String,
    imageQuality: String,
    toolOutput: String,
  },

  timestamp: { type: Date, default: Date.now },
  hideFromBot: { type: Boolean, default: false },
}, { timestamps: false });

module.exports = mongoose.model('chat5', Chat5);
