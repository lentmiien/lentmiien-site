const mongoose = require('mongoose');

const Chat5 = new mongoose.Schema({
  user_id: { type: String, required: true, max: 100 },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  contentType: { type: String, enum: ["text", "image", "audio", "video", "file", "tool", "reasoning", "function_call", "function_call_output"], required: true },

  content: {
    text: String,
    image: String,
    audio: String,
    tts: String,
    transcript: String,
    revisedPrompt: String,
    imageQuality: String,
    toolOutput: String,
    outputId: String,
    responseId: String,
    outputIndex: Number,
    toolCallId: String,
    callId: String,
    toolName: String,
    summary: mongoose.Schema.Types.Mixed,
    encryptedContent: String,
    arguments: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    raw: mongoose.Schema.Types.Mixed,
    status: String,
    error: String,
  },

  timestamp: { type: Date, default: Date.now },
  hideFromBot: { type: Boolean, default: false },
  embeddingStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'delete_pending', 'disabled'],
    default: undefined,
  },
  embeddingContentHash: { type: String, default: null },
}, { timestamps: false });

Chat5.pre('validate', function markTextEmbeddingPending() {
  const text = this.contentType === 'text' && typeof this.content?.text === 'string'
    ? this.content.text.trim()
    : '';
  if (!text) {
    if (this.isNew || this.isModified('contentType') || this.isModified('content.text')) {
      this.embeddingStatus = this.isNew ? 'disabled' : 'delete_pending';
      this.embeddingContentHash = null;
    }
    return;
  }
  if (this.isNew || this.isModified('contentType') || this.isModified('content.text')) {
    this.embeddingStatus = 'pending';
    this.embeddingContentHash = null;
  }
});

module.exports = mongoose.model('chat5', Chat5);
