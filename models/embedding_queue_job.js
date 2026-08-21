const mongoose = require('mongoose');

const { Schema } = mongoose;

const SourceMetadataSchema = new Schema({
  collectionName: { type: String, required: true },
  documentId: { type: String, required: true },
  contentType: { type: String, required: true },
  parentCollection: { type: String, default: null },
  parentId: { type: String, default: null },
}, { _id: false });

const EmbeddingQueueJobSchema = new Schema({
  _id: { type: String, required: true },
  source: { type: SourceMetadataSchema, required: true },
  mode: {
    type: String,
    enum: ['default', 'high_quality'],
    required: true,
  },
  operation: {
    type: String,
    enum: ['upsert', 'delete'],
    required: true,
  },
  options: { type: Schema.Types.Mixed, default: {} },
  desiredHash: { type: String, required: true },
  revision: { type: Number, default: 1, min: 1 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },
  attempts: { type: Number, default: 0, min: 0 },
  retryable: { type: Boolean, default: true },
  nextAttemptAt: { type: Date, default: null, index: true },
  claimToken: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null, index: true },
  lastError: { type: String, default: null },
  queuedAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

EmbeddingQueueJobSchema.index({ status: 1, operation: 1, nextAttemptAt: 1, queuedAt: 1 });
EmbeddingQueueJobSchema.index({ status: 1, leaseExpiresAt: 1 });
EmbeddingQueueJobSchema.index({
  'source.collectionName': 1,
  'source.documentId': 1,
  mode: 1,
});

module.exports = mongoose.model('embedding_queue_job', EmbeddingQueueJobSchema);
