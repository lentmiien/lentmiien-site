const mongoose = require('mongoose');

const { Schema } = mongoose;

const DEFAULT_SLOW_REQUEST_RETENTION_DAYS = 14;
const retentionDays = Number.parseInt(process.env.PERFORMANCE_SLOW_REQUEST_RETENTION_DAYS || '', 10);
const slowRequestRetentionSeconds = (
  Number.isInteger(retentionDays) && retentionDays > 0
    ? retentionDays
    : DEFAULT_SLOW_REQUEST_RETENTION_DAYS
) * 24 * 60 * 60;

const PerformanceSlowRequestSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  method: { type: String, required: true },
  route: { type: String, required: true },
  path: { type: String, required: true },
  statusCode: { type: Number, required: true },
  durationMs: { type: Number, required: true },
  contentLength: { type: Number, default: null },
  userName: { type: String, default: null },
  userType: { type: String, default: null },
  authType: { type: String, default: null },
}, {
  timestamps: false,
});

PerformanceSlowRequestSchema.index({ timestamp: 1 }, { expireAfterSeconds: slowRequestRetentionSeconds });
PerformanceSlowRequestSchema.index({ durationMs: -1, timestamp: -1 });

module.exports = mongoose.model('performance_slow_request', PerformanceSlowRequestSchema);
