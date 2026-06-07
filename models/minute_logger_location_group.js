const mongoose = require('mongoose');

const MinuteLoggerLocationGroupSchema = new mongoose.Schema({
  endpointPath: { type: String, required: true, index: true },
  groupKey: { type: String, required: true },
  name: { type: String, default: '' },
  hideCoordinates: { type: Boolean, default: false },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

MinuteLoggerLocationGroupSchema.index({ endpointPath: 1, groupKey: 1 }, { unique: true });

module.exports = mongoose.model('minute_logger_location_group', MinuteLoggerLocationGroupSchema);
