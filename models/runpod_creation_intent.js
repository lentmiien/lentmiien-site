const mongoose = require('mongoose');

// One unresolved creation per resource kind. The built-in _id index supplies the
// atomic gate even before secondary indexes are built. Never store request env/secrets.
const schema = new mongoose.Schema({
  _id: { type: String, enum: ['pod', 'volume'], required: true },
  token: { type: String, required: true, maxlength: 36 },
  providerName: { type: String, required: true, maxlength: 120 },
  providerId: { type: String, default: null, maxlength: 128 },
  state: { type: String, enum: ['pending', 'unknown', 'resolved'], required: true },
  cleanupRequestedAt: { type: Date, default: null },
  intendedStopAt: { type: Date, default: null },
  startedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('runpod_creation_intent', schema);
