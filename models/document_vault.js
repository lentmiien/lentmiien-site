const mongoose = require('mongoose');

const { Schema } = mongoose;
const id = Schema.Types.ObjectId;
const page = new Schema({
  filename: { type: String, required: true },
  state: { type: String, enum: ['ocr', 'chat', 'review', 'approved', 'stored', 'failed'], default: 'ocr' },
  revision: { type: Number, default: 0 },
  filedAt: Date,
  ocrText: String,
  englishText: String,
  documentDate: String,
  title: String,
  tags: [String],
  description: String,
  totalAmount: Number,
  currency: String,
  physical: {
    decision: { type: String, enum: ['keep', 'dispose'] },
    yearLabel: String,
    folderId: String,
    groupLabel: String,
  },
  failedStage: String,
  issue: String,
});
const job = new Schema({
  kind: { type: String, enum: ['ocr', 'chat', 'group'], required: true },
  pageId: id,
  actorId: { type: id, required: true },
  authority: { type: String, required: true },
  thenClassify: Boolean,
  queuedAt: { type: Date, required: true },
});
const group = new Schema({
  ownerId: { type: id, required: true, immutable: true },
  uploaderId: { type: id, required: true, immutable: true },
  viewerIds: [id],
  uploadKey: String,
  uploadDigest: String,
  state: { type: String, enum: ['uploading', 'ready', 'discarding'], default: 'uploading' },
  pages: [page],
  jobs: [job],
  nextJobAt: Date,
  description: String,
  descriptionRevision: { type: Number, default: 0 },
  summaryState: { type: String, enum: ['waiting', 'queued', 'ready', 'failed'], default: 'waiting' },
  summaryIssue: String,
  lastJob: { jobId: id, outcome: String },
}, { timestamps: true, optimisticConcurrency: true });
group.index({ uploaderId: 1, uploadKey: 1 }, { unique: true, partialFilterExpression: { uploadKey: { $type: 'string' } } });
group.index({ state: 1, nextJobAt: 1 });
group.index({ 'pages._id': 1 });
for (const field of ['ownerId', 'uploaderId', 'viewerIds']) group.index({ [field]: 1, state: 1, _id: -1 });

const scan = new Schema({
  groupId: { type: id, required: true, index: true },
  mime: { type: String, required: true },
  bytes: { type: Buffer, required: true, select: false },
});
const queue = new Schema({
  _id: String,
  version: { type: Number, default: 0 },
  active: {
    type: new Schema({
      groupId: { type: id, required: true },
      jobId: { type: id, required: true },
      pageId: id,
      kind: String,
      expiresAt: { type: Date, required: true },
    }, { _id: false }),
    default: null,
  },
  recent: { type: [String], default: [] },
  pauseReason: { type: String, default: null },
}, { versionKey: false });

module.exports = {
  Group: mongoose.model('DocumentVaultGroup', group),
  Scan: mongoose.model('DocumentVaultScan', scan),
  Queue: mongoose.model('DocumentVaultQueue', queue),
};
