const mongoose = require('mongoose');

const TrainingGroup = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true, trim: true, max: 100, index: true },
  description: { type: String, default: '', max: 2000 },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: String, default: '', max: 100 },
  updatedBy: { type: String, default: '', max: 100 },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('training_group', TrainingGroup);
