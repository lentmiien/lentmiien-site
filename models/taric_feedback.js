const mongoose = require('mongoose');
const { validateFeedbackRecord } = require('../utils/taricRecords');
const { SCHEMA_VERSION, hash } = require('../utils/taricContracts');
const { appendOnly } = require('./taric_recommendation');

function createFeedbackSchema() {
  const schema = new mongoose.Schema({
    ownerId: { type: String, required: true, immutable: true, maxlength: 128, match: /^[A-Za-z0-9_-]+$/ },
    principalId: { type: String, required: true, immutable: true, maxlength: 128, match: /^[A-Za-z0-9_-]+$/ },
    recommendationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true, match: /^[A-Za-z0-9_-]{16,128}$/ },
    requestHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true,
      validate: { validator: (value) => { validateFeedbackRecord(value); return true; },
        message: 'Invalid TARIC feedback snapshot' } },
  }, { strict: 'throw', minimize: false, timestamps: { createdAt: true, updatedAt: false },
    autoIndex: false, autoCreate: false, bufferCommands: false });
  schema.pre('validate', function validateHash() {
    if (this.snapshot && this.recommendationId && this.requestHash !== hash({ schema_version: SCHEMA_VERSION,
      recommendationId: this.recommendationId.toString(), feedback: { selected_code: this.snapshot.selected_code } })) {
      this.invalidate('requestHash', 'Invalid TARIC feedback request hash');
    }
  });
  schema.index({ ownerId: 1, principalId: 1, idempotencyKey: 1 }, { unique: true });
  // One final choice. Corrections/supersession need a reviewed append-only event design.
  schema.index({ ownerId: 1, principalId: 1, recommendationId: 1 }, { unique: true });
  appendOnly(schema);
  return schema;
}
module.exports = { createFeedbackSchema };
