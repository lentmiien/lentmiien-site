const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const ModularLlmTestRunSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  serviceId: {
    type: String,
    required: true,
    default: 'modular_llm',
    trim: true,
    maxlength: 100,
    index: true,
  },
  operation: {
    type: String,
    required: true,
    enum: ['pipeline', 'interpreter', 'reasoner', 'renderer'],
    default: 'pipeline',
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['running', 'succeeded', 'failed'],
    default: 'running',
    index: true,
  },
  requestedBy: { type: String, default: '', trim: true, maxlength: 100 },
  inputText: { type: String, required: true, maxlength: 20000 },
  inputSha256: { type: String, required: true, minlength: 64, maxlength: 64, index: true },
  maxRepairAttempts: { type: Number, required: true, enum: [0, 1], default: 1 },
  persistGatewayRun: { type: Boolean, required: true, default: true },
  includeDiagnostics: { type: Boolean, required: true, default: true },
  gatewayRunId: { type: String, default: null, trim: true, maxlength: 200, index: true },
  gatewayStatus: { type: String, default: null, trim: true, maxlength: 100 },
  bundleId: { type: String, default: null, trim: true, maxlength: 200, index: true },
  failedStage: { type: String, default: null, trim: true, maxlength: 100 },
  output: { type: String, default: null, maxlength: 1000000 },
  httpStatus: { type: Number, default: null, min: 100, max: 599 },
  errorType: { type: String, default: null, trim: true, maxlength: 200 },
  errorMessage: { type: String, default: null, maxlength: 4000 },
  errorDetails: { type: Schema.Types.Mixed, default: null },
  response: { type: Schema.Types.Mixed, default: null },
  durationMs: { type: Number, default: null, min: 0 },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'modular_llm_test_runs',
});

ModularLlmTestRunSchema.index({ createdAt: -1 });
ModularLlmTestRunSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ModularLlmTestRun', ModularLlmTestRunSchema);
