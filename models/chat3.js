const mongoose = require('mongoose');

const Chat3 = new mongoose.Schema({
  ConversationID: { type: Number, required: true },
  StartMessageID: { type: String, required: true, max: 100 },
  PreviousMessageID: { type: String, required: true, max: 100 },
  ContentText: { type: String, required: true },
  ContentTokenCount: { type: Number, required: true },
  SystemPromptText: { type: String, required: true },
  UserOrAssistantFlag: { type: Boolean, required: true },
  UserID: { type: String, required: true, max: 100 },
  Title: { type: String, required: true, max: 255 },
  Images: { type: String, required: false, max: 255 },
  Sounds: { type: String, required: false, max: 255 },
  Timestamp: { type: Date, required: true },
});

module.exports = mongoose.model('chat3', Chat3);
