const mongoose = require('mongoose');

const DeviceUsageRewardSuggestionSchema = new mongoose.Schema({
  titleEn: { type: String, required: true, trim: true },
  titleJa: { type: String, default: '', trim: true },
  defaultPoints: { type: Number, required: true, min: 0, max: 100000, default: 1 },
  notes: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true, index: true },
  usageCount: { type: Number, default: 0, min: 0 },
  lastUsedAt: { type: Date, default: null },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

DeviceUsageRewardSuggestionSchema.index({ active: 1, titleEn: 1 });

module.exports = mongoose.model('device_usage_reward_suggestion', DeviceUsageRewardSuggestionSchema);
