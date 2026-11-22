const mongoose = require('mongoose');

const { Schema } = mongoose;
const id = Schema.Types.ObjectId;
const failedReply = new Schema({
  reason: { type: String, required: true },
  raw: String,
  clipped: Boolean,
}, { _id: false });
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
  // Kept only while reprocessing a filed page, for restoration at the edit deadline.
  beforeRedo: Schema.Types.Mixed,
  duplicateStatus: { type: String, enum: ['checking', 'possible_duplicate'] },
  duplicateReviewedAt: Date,
  duplicateThrough: Date,
  duplicateAfter: id,
  failedStage: String,
  failedReply,
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
  duplicateEffects: { type: [new Schema({ overlap: Number, outcome: String, removePage: id })], default: undefined },
  nextJobAt: Date,
  description: String,
  beforeRedoDescription: String,
  descriptionRevision: { type: Number, default: 0 },
  summaryState: { type: String, enum: ['waiting', 'queued', 'ready', 'failed'], default: 'waiting' },
  summaryIssue: String,
  failedSummaryReply: failedReply,
  lastJob: { jobId: id, outcome: String },
}, { timestamps: true, optimisticConcurrency: true });
group.index({ uploaderId: 1, uploadKey: 1 }, { unique: true, partialFilterExpression: { uploadKey: { $type: 'string' } } });
group.index({ state: 1, nextJobAt: 1 });
group.index({ 'pages._id': 1 });
for (const field of ['ownerId', 'uploaderId', 'viewerIds']) group.index({ [field]: 1, state: 1, _id: -1 });

group.index({ ownerId: 1, 'pages.documentDate': 1 });
group.index({ 'pages.duplicateStatus': 1 }, { sparse: true });

const scan = new Schema({
  groupId: { type: id, required: true, index: true },
  mime: { type: String, required: true },
  preview: { type: Buffer, select: false },
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
  DuplicateFeedback: mongoose.model('DocumentVaultDuplicateFeedback', new Schema({
    overlap: { type: Number, required: true }, outcome: { type: String, enum: ['unique', 'duplicate'], required: true },
  }, { collection: 'documentvaultduplicatefeedback', versionKey: false })),
  Group: mongoose.model('DocumentVaultGroup', group),
  Scan: mongoose.model('DocumentVaultScan', scan),
  Queue: mongoose.model('DocumentVaultQueue', queue),
};
