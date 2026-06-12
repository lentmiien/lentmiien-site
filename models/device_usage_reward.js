const mongoose = require('mongoose');

const { Schema } = mongoose;

const DeviceUsageRewardSchema = new Schema({
  awardedAt: { type: Date, default: Date.now, index: true },
  localDateKey: { type: String, required: true, index: true },
  points: { type: Number, required: true, min: 0, max: 100000, default: 1 },
  titleEn: { type: String, required: true, trim: true },
  titleJa: { type: String, default: '', trim: true },
  comment: { type: String, default: '', trim: true },
  suggestionId: { type: Schema.Types.ObjectId, ref: 'device_usage_reward_suggestion', default: null, index: true },
  source: { type: String, enum: ['manual', 'learning', 'system'], default: 'manual', index: true },
  awardedBy: { type: String, default: null },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, {
  minimize: false,
  timestamps: true,
});

DeviceUsageRewardSchema.index({ localDateKey: 1, awardedAt: -1 });

module.exports = mongoose.model('device_usage_reward', DeviceUsageRewardSchema);
