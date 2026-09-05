const mongoose = require('mongoose');

const ProbeSchema = new mongoose.Schema({
  name: { type: String, enum: ['internet', 'cloudflare', 'publicApp'], required: true },
  outcome: { type: String, enum: ['ok', 'timeout', 'unsafe_address', 'http_status', 'oversized', 'connection_error', 'unexpected_response', 'dns_error'], required: true },
  statusCode: Number,
  latencyMs: Number,
  degraded: Boolean,
  degradedSince: Date,
}, { _id: false });

const ConnectivitySampleSchema = new mongoose.Schema({
  sampledAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
  signature: { type: String, required: true },
  probes: { type: [ProbeSchema], required: true },
  lastAttemptAt: { type: Date, default: null },
  notification: { type: String, enum: ['none', 'attempted', 'sent', 'failed', 'deferred'], default: 'none' },
}, { collection: 'connectivity_samples', bufferCommands: false, versionKey: false });

ConnectivitySampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ConnectivitySample', ConnectivitySampleSchema);
