const mongoose = require('mongoose');

const TrainingEntry = new mongoose.Schema({
  groupId: { type: String, required: true, trim: true, max: 100, index: true },
  conversationId: { type: String, required: true, trim: true, max: 100, index: true },
  messageIds: [{ type: String, required: true, trim: true, max: 100 }],
  promptMessageIds: [{ type: String, required: true, trim: true, max: 100 }],
  outputMessageId: { type: String, required: true, trim: true, max: 100 },
  selectionKey: { type: String, required: true, trim: true, max: 1000 },
  notes: { type: String, default: '', max: 2000 },
  source: { type: String, default: 'chat5', enum: ['chat5'] },
  createdBy: { type: String, default: '', max: 100 },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

TrainingEntry.index({ groupId: 1, selectionKey: 1 }, { unique: true });
TrainingEntry.index({ conversationId: 1, groupId: 1, createdAt: -1 });

module.exports = mongoose.model('training_entry', TrainingEntry);
