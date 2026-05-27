const mongoose = require('mongoose');

const { Schema } = mongoose;

const INCOMING_REQUEST_RETENTION_SECONDS = 7 * 24 * 60 * 60;

const IncomingRequestSchema = new Schema({
  endpointPath: { type: String, required: true, index: true },
  requestPath: { type: String, required: true },
  method: { type: String, required: true },
  ip: { type: String, default: null },
  ips: { type: [String], default: [] },
  userAgent: { type: String, default: null },
  referer: { type: String, default: null },
  query: { type: Schema.Types.Mixed, default: {} },
  receivedAt: { type: Date, default: Date.now },
  windowStart: { type: Date, required: true },
  countInWindow: { type: Number, required: true },
  allowed: { type: Boolean, required: true, index: true },
  responseStatusCode: { type: Number, required: true },
  responseText: { type: String, required: true },
}, {
  timestamps: false,
});

IncomingRequestSchema.index({ receivedAt: 1 }, { expireAfterSeconds: INCOMING_REQUEST_RETENTION_SECONDS });
IncomingRequestSchema.index({ endpointPath: 1, receivedAt: -1 });

module.exports = mongoose.model('incoming_request', IncomingRequestSchema);
