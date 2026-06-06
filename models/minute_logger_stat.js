const mongoose = require('mongoose');

const { Schema } = mongoose;

const MinuteLoggerStatSchema = new Schema({
  endpointPath: { type: String, required: true, index: true },
  periodType: { type: String, required: true, enum: ['day', 'month'], index: true },
  periodKey: { type: String, required: true, index: true },
  periodStart: { type: Date, required: true, index: true },
  deviceId: { type: String, required: true, default: 'unknown', index: true },
  package: { type: String, required: true, default: 'unknown', index: true },
  minutes: { type: Number, required: true, default: 0, min: 0 },
  firstRequestAt: { type: Date },
  lastRequestAt: { type: Date },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: false,
});

MinuteLoggerStatSchema.index(
  { endpointPath: 1, periodType: 1, periodKey: 1, deviceId: 1, package: 1 },
  { unique: true }
);
MinuteLoggerStatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
MinuteLoggerStatSchema.index({ endpointPath: 1, periodType: 1, periodStart: -1 });
MinuteLoggerStatSchema.index({ endpointPath: 1, periodType: 1, package: 1, periodStart: -1 });
MinuteLoggerStatSchema.index({ endpointPath: 1, periodType: 1, deviceId: 1, periodStart: -1 });

module.exports = mongoose.model('minute_logger_stat', MinuteLoggerStatSchema);
