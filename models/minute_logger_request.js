const mongoose = require('mongoose');

const { Schema } = mongoose;

const MINUTE_LOGGER_REQUEST_RETENTION_SECONDS = 60 * 24 * 60 * 60;

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

module.exports = mongoose.model('minute_logger_request', MinuteLoggerRequestSchema);
