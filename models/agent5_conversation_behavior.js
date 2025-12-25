const mongoose = require('mongoose');
const Agent5BehaviorSchema = require('./agent5_behavior_schema');

const Agent5ConversationBehaviorSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'agent5', required: true, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'conversation5', required: true, index: true },
  behavior: { type: Agent5BehaviorSchema, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

Agent5ConversationBehaviorSchema.index({ agentId: 1, conversationId: 1 }, { unique: true });

module.exports = mongoose.model('agent5_conversation_behavior', Agent5ConversationBehaviorSchema);
