const mongoose = require('mongoose');

const { Schema } = mongoose;

const DEVICE_USAGE_REQUEST_RETENTION_SECONDS = 90 * 24 * 60 * 60;

const DeviceUsageRequestSchema = new Schema({
  endpointPath: { type: String, required: true, index: true },
  requestPath: { type: String, required: true },
  method: { type: String, required: true, default: 'GET' },
  ip: { type: String, default: null },
  ips: { type: [String], default: [] },
  userAgent: { type: String, default: null },
  referer: { type: String, default: null },
  packageName: { type: String, required: true, default: 'unknown', index: true },
  packageCategory: {
    type: String,
    required: true,
    enum: ['learning', 'management', 'entertainment'],
    default: 'entertainment',
    index: true,
  },
  packageKnown: { type: Boolean, default: false, index: true },
  packageLabelEn: { type: String, default: '' },
  packageLabelJa: { type: String, default: '' },
  query: { type: Schema.Types.Mixed, default: () => ({}) },
  receivedAt: { type: Date, default: Date.now },
  localDateKey: { type: String, required: true, index: true },
  minuteBucket: { type: Date, default: undefined },
  learningMinutesTodayBefore: { type: Number, required: true, default: 0 },
  learningMinutesTodayAfter: { type: Number, required: true, default: 0 },
  learningRequiredMinutes: { type: Number, required: true, default: 30 },
  learningFreeMinutes: { type: Number, required: true, default: 30 },
  freeLearningMinute: { type: Boolean, default: false, index: true },
  rollingWindowStart: { type: Date, required: true },
  countedMinutesInWindowBefore: { type: Number, required: true, default: 0 },
  countedMinutesInWindowAfter: { type: Number, required: true, default: 0 },
  rollingLimitMinutes: { type: Number, required: true, default: 60 },
  rollingWindowMinutes: { type: Number, required: true, default: 90 },
  maxVolume: { type: Number, required: true, default: 100 },
  countsTowardLimit: { type: Boolean, required: true, default: false, index: true },
  allowed: { type: Boolean, required: true, index: true },
  action: { type: String, required: true, default: 'allow', index: true },
  reasonCode: { type: String, required: true, default: 'allowed', index: true },
  responseStatusCode: { type: Number, required: true, default: 200 },
  statusText: { type: String, required: true, default: 'OK' },
  responsePayload: { type: Schema.Types.Mixed, default: () => ({}) },
}, {
  minimize: false,
  timestamps: false,
});

DeviceUsageRequestSchema.index({ receivedAt: 1 }, { expireAfterSeconds: DEVICE_USAGE_REQUEST_RETENTION_SECONDS });
DeviceUsageRequestSchema.index({ endpointPath: 1, receivedAt: -1 });
DeviceUsageRequestSchema.index({ endpointPath: 1, localDateKey: 1, receivedAt: -1 });
DeviceUsageRequestSchema.index({ endpointPath: 1, packageCategory: 1, receivedAt: -1 });
DeviceUsageRequestSchema.index({ endpointPath: 1, packageName: 1, receivedAt: -1 });
DeviceUsageRequestSchema.index({ endpointPath: 1, countsTowardLimit: 1, allowed: 1, receivedAt: -1 });
DeviceUsageRequestSchema.index(
  { endpointPath: 1, minuteBucket: 1 },
  { unique: true, partialFilterExpression: { minuteBucket: { $exists: true } } }
);

module.exports = mongoose.model('device_usage_request', DeviceUsageRequestSchema);
