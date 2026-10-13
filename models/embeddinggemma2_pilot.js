const mongoose = require('mongoose');
const { MODEL, REVISION, SPACE } = require('../services/embeddingGemma2/contract');
const COLLECTION = 'embeddinggemma2_test';
const schema = new mongoose.Schema({
  recordType: { type: String, enum: ['entry'], default: 'entry', required: true, immutable: true },
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  state: { type: String, enum: ['pending', 'ready', 'deleting'], required: true },
  kind: { type: String, enum: ['text', 'image', 'audio', 'video'], required: true },
  text: { type: String, maxlength: 32000 }, title: { type: String, maxlength: 512 },
  asset: { type: String, match: /^[a-f0-9]{48}$/ }, mime: String, filename: { type: String, maxlength: 120 },
  bytes: { type: Number, required: true, min: 1, max: 8388608 },
  model: { type: String, enum: [MODEL], required: true }, revision: { type: String, enum: [REVISION], required: true },
  space_id: { type: String, enum: [SPACE], required: true }, dimensions: { type: Number, enum: [768], required: true },
  normalized: { type: Boolean, required: true, validate: v => v === true }, precision: { type: String, enum: ['bfloat16', 'float32'] },
  preprocessing: { type: mongoose.Schema.Types.Mixed, required: true, validate: v => v?.version === 'pilot-v1' },
  mapping: { type: mongoose.Schema.Types.Mixed, required: true, validate: v => v?.index === 0 && v?.input_index === 0 },
  vector: { type: [Number], required: true, validate: v => v.length === 768 && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < 0.00001 },
  capturedAt: { type: Date, default: Date.now, immutable: true },
}, { collection: COLLECTION, bufferCommands: false, autoIndex: false, autoCreate: false, strict: 'throw' });
schema.pre('validate', function () {
  if (this.kind === 'text') {
    if (!this.text?.trim() || this.asset || this.mime || this.filename) this.invalidate('text', 'Text records require raw text and no media asset.');
  } else if (!this.asset || !this.mime || !this.filename || this.text !== undefined || this.title !== undefined) {
    this.invalidate('asset', 'Media records require an asset and no text/title.');
  }
});
schema.index({ owner: 1, state: 1, space_id: 1, dimensions: 1, capturedAt: -1 }, { name: 'eg2_owner_space', partialFilterExpression: { recordType: 'entry' } });
// Two schemas share one explicit collection. The string control ID cannot collide
// with entry ObjectIds; every service query also filters by recordType.
const leaseSchema = new mongoose.Schema({
  _id: { type: String, enum: ['operation'] },
  recordType: { type: String, enum: ['control'], default: 'control', required: true, immutable: true },
  token: String, until: Date,
}, { collection: COLLECTION, bufferCommands: false, autoCreate: false, autoIndex: false, strict: 'throw' });
function models(connection) {
  if (connection.readyState !== 1) throw new Error('Primary database unavailable');
  // Use only the established primary connection and its existing authentication.
  return { Record: connection.models.EmbeddingGemma2Pilot || connection.model('EmbeddingGemma2Pilot', schema), Lease: connection.models.EmbeddingGemma2Lease || connection.model('EmbeddingGemma2Lease', leaseSchema) };
}
module.exports = { schema, leaseSchema, models, COLLECTION };
