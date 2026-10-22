const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  namespace: { type: String, required: true, immutable: true, maxlength: 60 },
  slot: { type: Number, required: true, immutable: true, min: 0, max: 9 },
  label: { type: String, required: true, maxlength: 80 },
  hash: { type: String, required: true, select: false },
  capabilities: { type: [String], required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, bufferCommands: false });
schema.index({ ownerId: 1, namespace: 1, slot: 1 }, { unique: true });
module.exports = mongoose.model('ServiceCredential', schema);
