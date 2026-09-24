const mongoose = require('mongoose');
const { Schema } = mongoose;
const revision = new Schema({
  source: { type: Schema.Types.Mixed, default: undefined, validate: v => v == null || Buffer.byteLength(JSON.stringify(v)) <= 128 * 1024 },
  revision: { type: Number, required: true, min: 1, max: 100 },
  status: { type: String, required: true, enum: ['unreviewed', 'verified', 'needs_review', 'excluded'] },
  sourceHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  feedbackId: { type: String, default: null, match: /^[a-f0-9]{32}$/ }, feedbackHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  target: { type: String, default: null, validate: v => v === null || /^\d{10}$/.test(v) },
  approvedDescription: { type: String, default: null, maxlength: 255 },
  note: { type: String, required: true, maxlength: 2000 },
  actor: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
  at: { type: String, required: true, match: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/ }, correction: { type: Boolean, required: true },
}, { _id: false, strict: 'throw' });
const settings = { timestamps: true, strict: 'throw', minimize: false, autoCreate: false, autoIndex: false, bufferCommands: false };
const reviewSchema = new Schema({ _id: { type: String, required: true, match: /^[a-f0-9]{32}$/ },
  owner: { type: String, required: true, maxlength: 100, immutable: true }, request: { type: String, required: true, match: /^[a-f0-9]{32}$/, immutable: true },
  revision: { type: Number, required: true, min: 1, max: 100 }, latest: { type: revision, required: true },
  identityKeys: { type: [String], default: undefined },
  history: { type: [revision], validate: v => v.length <= 100 },
}, settings);
reviewSchema.index({ owner: 1, request: 1 }, { unique: true, name: 'review_owner_request' });
reviewSchema.index({ owner: 1, 'latest.at': -1, _id: -1 }, { name: 'review_chronology' });
// Service writes can append exactly one CAS revision; existing source/audit
// entries cannot be replaced through model updates or document save.
for (const operation of ['updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
  reviewSchema.pre(operation, function () { throw new Error('TARIC review audit requires append-only CAS'); });
}
reviewSchema.pre('save', function () { if (!this.isNew) throw new Error('TARIC review audit requires append-only CAS'); });
reviewSchema.pre('updateOne', function () {
  const update = this.getUpdate(); const filter = this.getFilter();
  const next = update?.$set?.latest;
  const previous = filter.revision?.$exists === false ? 0 : filter.revision;
  if (!next || !Number.isInteger(previous) || previous < 0 || previous >= 100 || next.revision !== previous + 1
    || update.$set.revision !== next.revision || JSON.stringify(update.$push?.history) !== JSON.stringify(next)
    || typeof filter.owner !== 'string' || filter._id !== filter.request
    || Object.keys(update).some(k => !['$set', '$push', '$setOnInsert'].includes(k))
    || Object.keys(update.$set).some(k => !['latest', 'revision', 'identityKeys', 'updatedAt'].includes(k))
    || Object.keys(update.$push).some(k => k !== 'history')
    || Object.keys(update.$setOnInsert || {}).some(k => !['owner', 'request', 'createdAt', '__v'].includes(k))) {
    throw new Error('TARIC review audit requires append-only CAS');
  }
});
// Equality filters precede source chronology; all source dates are canonical UTC strings.
for (const [suffix, field] of [['date', null], ['jan', 'inputs.jan'], ['mode', 'mode'], ['state', 'state']]) {
  reviewSchema.index({ owner: 1, ...(field ? { [`latest.source.${field}`]: 1 } : {}), 'latest.source.createdAt': -1, request: -1 }, { name: `review_source_${suffix}` });
}
reviewSchema.index({ owner: 1, 'latest.status': 1, identityKeys: 1 }, { name: 'review_conflicts' });
const exportSchema = new Schema({ _id: { type: String, required: true, match: /^[a-f0-9]{32}$/ },
  owner: { type: String, required: true, immutable: true, maxlength: 100 }, actor: { type: String, required: true, immutable: true, match: /^[a-f0-9]{24}$/ },
  snapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ }, sha256: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  requests: { type: [String], default: undefined, immutable: true, validate: v => v == null || (v.length <= 200 && v.every(id => /^[a-f0-9]{32}$/.test(id))) },
  jsonl: { type: String, required: true, immutable: true, validate: v => Buffer.byteLength(v) <= 8 * 1024 * 1024 },
}, settings);
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
  exportSchema.pre(operation, function () { throw new Error('TARIC export manifests are append-only'); });
}
exportSchema.pre('save', function () { if (!this.isNew) throw new Error('TARIC export manifests are append-only'); });
exportSchema.index({ owner: 1, createdAt: -1, _id: -1 }, { name: 'export_chronology' });
exportSchema.index({ owner: 1, requests: 1 }, { name: 'export_source_requests' });
module.exports = {
  Review: mongoose.models.taric_reviews || mongoose.model('taric_reviews', reviewSchema, 'taric_reviews'),
  Export: mongoose.models.taric_exports || mongoose.model('taric_exports', exportSchema, 'taric_exports'),
};
