const mongoose = require('mongoose');
const { MAX_CODES } = require('../utils/amiamiUploadPolicy');

const AmiAmiUploadJobSchema = new mongoose.Schema({
  _id: { type: String, default: 'html-upload' },
  jobId: { type: String, required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, required: true },
  state: { type: String, enum: ['queued', 'running', 'completed', 'failed'], required: true },
  codes: { type: [String], validate: value => value.length <= MAX_CODES },
  totalCodes: Number,
  queuedCount: Number,
  cursor: { type: Number, default: 0 },
  fetched: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  skippedExisting: { type: Number, default: 0 },
  currentCode: { type: String, default: null },
  failures: [{ _id: false, itemCode: String, message: String }],
  message: { type: String, default: null },
  startedAt: Date,
  finishedAt: { type: Date, default: null },
  expiresAt: Date,
  nextFetchAt: Date,
  leaseToken: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('amiamiuploadjobs', AmiAmiUploadJobSchema);
