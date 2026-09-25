const mongoose = require('mongoose');
const { Schema } = mongoose;
// User-created local jobs only. No benchmark score, feedback or external API job.
const schema = new Schema({
  _id: String, owner: { type: String, required: true, immutable: true },
  actor: { type: String, required: true, immutable: true, match: /^[a-f0-9]{24}$/ },
  token: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  snapshotHash: { type: String, required: true, immutable: true },
  filters: Schema.Types.Mixed, configuration: Schema.Types.Mixed,
  cases: { type: [Schema.Types.Mixed], validate: v => v.length <= 200 && Buffer.byteLength(JSON.stringify(v)) <= 8 * 1024 * 1024 },
  skipped: { type: [Schema.Types.Mixed], validate: v => v.length <= 2000 },
  state: String, active: Boolean, cancelRequested: Boolean, fence: String,
  cancelledBy: { type: String, match: /^[a-f0-9]{24}$/ }, cancelRequestedAt: Date,
  sessionCount: { type: Number, default: 0 }, sessionId: String, sessionEndReasons: Schema.Types.Mixed,
  error: String, finishedAt: Date, deadline: Date, lastYieldAt: Date,
}, { timestamps: true, minimize: false, strict: 'throw', autoCreate: false, autoIndex: false, bufferCommands: false });
schema.index({ owner: 1, token: 1 }, { unique: true, name: 'local_batch_idempotency' });
schema.index({ owner: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_local_batch' });
schema.index({ owner: 1, createdAt: -1, _id: -1 }, { name: 'local_batch_chronology' });
schema.index({ owner: 1, 'cases.id': 1 }, { name: 'local_batch_case_purge' });
module.exports = { Reprocess: mongoose.models.taric_reprocess_runs || mongoose.model('taric_reprocess_runs', schema, 'taric_reprocess_runs') };
