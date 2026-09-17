const mongoose = require('mongoose');
const { validateRecommendationRecord, requestHash } = require('../utils/taricRecords');

// Export a schema only: no model registration, connection, collection or index creation.
function createRecommendationSchema() {
  const schema = new mongoose.Schema({
    ownerId: { type: String, required: true, immutable: true, maxlength: 128, match: /^[A-Za-z0-9_-]+$/ },
    principalId: { type: String, required: true, immutable: true, maxlength: 128, match: /^[A-Za-z0-9_-]+$/ },
    idempotencyKey: { type: String, required: true, immutable: true, match: /^[A-Za-z0-9_-]{16,128}$/ },
    requestHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true,
      validate: { validator: (value) => { validateRecommendationRecord(value); return true; },
        message: 'Invalid TARIC recommendation snapshot' } },
  }, { strict: 'throw', minimize: false, timestamps: { createdAt: true, updatedAt: false },
    autoIndex: false, autoCreate: false, bufferCommands: false });
  schema.pre('validate', function validateHash() {
    if (this.snapshot && this.requestHash !== requestHash(this.snapshot.request)) {
      this.invalidate('requestHash', 'Invalid TARIC request hash');
    }
  });
  schema.index({ ownerId: 1, principalId: 1, idempotencyKey: 1 }, { unique: true });
  appendOnly(schema);
  return schema;
}
function appendOnly(schema) {
  schema.pre('save', function preventResave() {
    if (!this.isNew) throw new Error('TARIC snapshots are append-only');
  });
  for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete']) {
    schema.pre(operation, function preventMutation() { throw new Error('TARIC snapshots are append-only'); });
  }
  // Bulk/collection access and database credentials are still a trusted infrastructure boundary.
}
module.exports = { createRecommendationSchema, appendOnly };
