const mongoose = require('mongoose');

const { Schema } = mongoose;

const MINUTE_LOGGER_REQUEST_RETENTION_SECONDS = 60 * 24 * 60 * 60;

const MinuteLoggerLocationSchema = new Schema({
  raw: { type: String, default: null },
  latitude: { type: Number, default: null, min: -90, max: 90 },
  longitude: { type: Number, default: null, min: -180, max: 180 },
  groupKey: { type: String, default: null, index: true },
}, {
  _id: false,
});

const MinuteLoggerRequestSchema = new Schema({
  endpointPath: { type: String, required: true, index: true },
  requestPath: { type: String, required: true },
  method: { type: String, required: true, default: 'POST' },
  ip: { type: String, default: null },
  ips: { type: [String], default: [] },
  userAgent: { type: String, default: null },
  referer: { type: String, default: null },
  deviceId: { type: String, default: 'unknown', index: true },
  package: { type: String, default: 'unknown', index: true },
  location: { type: MinuteLoggerLocationSchema, default: null },
  battery: { type: Number, default: null, min: 0, max: 100 },
  batteryTempC: { type: Number, default: null, min: -50, max: 120 },
  query: { type: Schema.Types.Mixed, default: () => ({}) },
  body: { type: Schema.Types.Mixed, default: () => ({}) },
  receivedAt: { type: Date, default: Date.now },
  responseStatusCode: { type: Number, required: true, default: 200 },
  responseBody: { type: Schema.Types.Mixed, default: () => ({ message: 'OK' }) },
}, {
  minimize: false,
  timestamps: false,
});

MinuteLoggerRequestSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: MINUTE_LOGGER_REQUEST_RETENTION_SECONDS }
);
MinuteLoggerRequestSchema.index({ endpointPath: 1, receivedAt: -1 });
MinuteLoggerRequestSchema.index({ endpointPath: 1, deviceId: 1, receivedAt: -1 });
MinuteLoggerRequestSchema.index({ endpointPath: 1, package: 1, receivedAt: -1 });
MinuteLoggerRequestSchema.index({ endpointPath: 1, deviceId: 1, package: 1, receivedAt: -1 });
MinuteLoggerRequestSchema.index({ endpointPath: 1, 'location.groupKey': 1, receivedAt: -1 });

module.exports = mongoose.model('minute_logger_request', MinuteLoggerRequestSchema);
