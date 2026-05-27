const mongoose = require('mongoose');

const RequestCounterSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  maxRequests: { type: Number, required: true, min: 1, max: 100000, default: 60 },
  windowMinutes: { type: Number, required: true, min: 1, max: 10080, default: 90 },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('request_counter_settings', RequestCounterSettingsSchema);
