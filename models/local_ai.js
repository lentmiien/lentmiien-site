const mongoose = require('mongoose');
const { Schema } = mongoose;
// The web process compiles models before connecting, with buffering disabled.
// Provision explicitly after readiness; Mongoose caches failed auto-init promises.
const options = { timestamps: true, minimize: false, bufferCommands: false, autoCreate: false, autoIndex: false, writeConcern: { w: 'majority', j: true } };
const job = new Schema({
  _id: String, ownerId: { type: String, required: true }, tokenId: String,
  key: { type: String, required: true }, digest: { type: String, required: true },
  slot: Number, ownerSlot: Number, admissionReleasedAt: Date,
  schemaVersion: Number, type: String, request: Schema.Types.Mixed, source: Schema.Types.Mixed, affinity: String,
  state: { type: String, default: 'queued', index: true }, reason: String,
  reconciledAt: Date, nextAttemptAt: Date, runId: { type: String, default: null, index: true },
  attempts: { type: [Schema.Types.Mixed], default: [] }, result: Schema.Types.Mixed,
  published: { type: Boolean, default: false }, acknowledged: { type: Boolean, default: false },
  projection: Schema.Types.Mixed, version: { type: Number, default: 0 },
}, { ...options, autoIndex: false });
job.index({ ownerId: 1, key: 1 }, { unique: true });
job.index({ slot: 1 }, { name: 'admission_slot_unique', unique: true, partialFilterExpression: { slot: { $type: 'number' } } });
job.index({ ownerId: 1, ownerSlot: 1 }, { name: 'admission_owner_slot_unique', unique: true, partialFilterExpression: { ownerSlot: { $type: 'number' } } });
job.index({ state: 1, nextAttemptAt: 1, affinity: 1, slot: 1 });
const run = new Schema({
  _id: String, wire: Schema.Types.Mixed, manifest: { type: [Schema.Types.Mixed], default: [] },
  state: { type: String, default: 'building' }, fence: Number, putStarted: { type: Boolean, default: false },
  seal: Schema.Types.Mixed, remote: Schema.Types.Mixed, admission: Schema.Types.Mixed, reason: String, stopMode: { type: String, default: null },
  stopConfirmed: { type: Boolean, default: false },
}, options);
const control = new Schema({
  _id: String, holder: String, ownerHost: String, ownerPid: Number, ownerProcessStart: String, fence: { type: Number, default: 0 }, leaseUntil: Date,
  cohortLimit: { type: Number, default: 8 },
  activeRun: { type: String, default: null }, nextAttemptAt: Date, suppressedWindow: String,
  stopIntent: Schema.Types.Mixed, retry: Schema.Types.Mixed,
  manualRequestedAt: Date, manualDeadline: Date, manualGatewayDeadline: Date, reason: String, readiness: Schema.Types.Mixed,
}, options);
const token = new Schema({
  _id: String, hash: { type: String, unique: true, required: true }, ownerId: { type: String, required: true },
  label: String, capabilities: [String], expiresAt: { type: Date, required: true }, revokedAt: Date,
}, options);
const input = new Schema({
  _id: String, ownerId: { type: String, required: true, immutable: true }, tokenId: String,
  key: { type: String, immutable: true }, requestDigest: { type: String, immutable: true },
  expectedSha256: { type: String, immutable: true }, source: { type: Schema.Types.Mixed, immutable: true },
  slot: Number, ownerSlot: Number, state: { type: String, default: 'preparing' },
  writer: Schema.Types.Mixed, descriptor: Schema.Types.Mixed, gatewayReceipt: Schema.Types.Mixed,
}, options);
input.index({ ownerId: 1, key: 1 }, { unique: true });
input.index({ slot: 1 }, { unique: true });
input.index({ ownerId: 1, ownerSlot: 1 }, { unique: true });
input.index({ 'source.conversationId': 1, 'source.messageId': 1 });
const inputQuota = new Schema({
  _id: String,
  allocations: { type: [{ _id: false, id: String, ownerId: String, bytes: Number }], default: [] },
}, options);
module.exports = {
  OutputQuota: mongoose.model('LocalAiOutputQuota', inputQuota.clone()),
  Input: mongoose.model('LocalAiInput', input), InputQuota: mongoose.model('LocalAiInputQuota', inputQuota),
  Job: mongoose.model('LocalAiJob', job), Run: mongoose.model('LocalAiRun', run),
  Control: mongoose.model('LocalAiControl', control), Token: mongoose.model('LocalAiToken', token),
};
