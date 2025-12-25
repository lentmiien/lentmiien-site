const mongoose = require('mongoose');

const Agent5BehaviorSchema = new mongoose.Schema({
  maxMessagesPerDay: { type: Number, default: 3, min: 0 },
  minCooldownMinutes: { type: Number, default: 60, min: 0 },
  triggers: {
    always: { type: Boolean, default: false },
    manual: { type: Boolean, default: true },
    minUserMessages: { type: Number, default: 0, min: 0 },
    minAssistantMessages: { type: Number, default: 0, min: 0 },
  },
  postApproach: { type: String, enum: ['append', 'append_and_request'], default: 'append' },
  personalityId: { type: mongoose.Schema.Types.ObjectId, ref: 'chat_personality', required: true },
  responseTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'chat_response_type', required: true },
}, { _id: false });

module.exports = Agent5BehaviorSchema;
