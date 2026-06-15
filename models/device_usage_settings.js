const mongoose = require('mongoose');

const DeviceUsageSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  rollingLimitMinutes: { type: Number, required: true, min: 1, max: 100000, default: 60 },
  rollingWindowMinutes: { type: Number, required: true, min: 1, max: 10080, default: 90 },
  learningRequiredMinutes: { type: Number, required: true, min: 0, max: 1440, default: 30 },
  learningFreeMinutes: { type: Number, required: true, min: 0, max: 1440, default: 30 },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('device_usage_settings', DeviceUsageSettingsSchema);
