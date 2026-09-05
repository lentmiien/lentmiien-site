const mongoose = require('mongoose');

const ProbeSchema = new mongoose.Schema({
  name: { type: String, enum: ['internet', 'cloudflare', 'publicApp', 'localHealth', 'database'], required: true },
  outcome: { type: String, enum: ['ok', 'timeout', 'unsafe_address', 'http_status', 'oversized', 'connection_error', 'unexpected_response', 'dns_error', 'unavailable'], required: true },
  statusCode: Number,
  latencyMs: Number,
  degraded: Boolean,
  httpReachable: Boolean,
  slow: Boolean,
  timings: { dnsMs: Number, tcpMs: Number, tlsMs: Number, ttfbMs: Number, totalMs: Number },
  failurePhase: String,
  errorCode: String,
  degradedSince: Date,
}, { _id: false });

const ConnectivitySampleSchema = new mongoose.Schema({
  sampledAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
  signature: { type: String, required: true },
  probes: { type: [ProbeSchema], required: true },
  diagnostics: [ProbeSchema],
  monitorVersion: String,
  intervalMs: Number,
  slowMs: Number,
  timeoutMs: Number,
  runId: String,
  processId: String,
  processStartedAt: Date,
  scheduledAt: Date,
  startedAt: Date,
  endedAt: Date,
  runDurationMs: Number,
  schedulerLatenessMs: Number,
  lastAttemptAt: { type: Date, default: null },
  notification: { type: String, enum: ['none', 'attempted', 'sent', 'failed', 'deferred'], default: 'none' },
}, { collection: 'connectivity_samples', bufferCommands: false, autoIndex: false, versionKey: false });

ConnectivitySampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ConnectivitySample', ConnectivitySampleSchema);
