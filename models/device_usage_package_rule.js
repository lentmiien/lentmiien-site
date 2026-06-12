const mongoose = require('mongoose');

const { Schema } = mongoose;

const DEVICE_USAGE_CATEGORIES = ['learning', 'management', 'entertainment'];

const DeviceUsagePackageRuleSchema = new Schema({
  packageName: { type: String, required: true, unique: true, trim: true, index: true },
  category: {
    type: String,
    required: true,
    enum: DEVICE_USAGE_CATEGORIES,
    default: 'entertainment',
    index: true,
  },
  labelEn: { type: String, default: '', trim: true },
  labelJa: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true, index: true },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('device_usage_package_rule', DeviceUsagePackageRuleSchema);
module.exports.DEVICE_USAGE_CATEGORIES = DEVICE_USAGE_CATEGORIES;
