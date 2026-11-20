const mongoose = require('mongoose');

const id = mongoose.Schema.Types.ObjectId;
const schema = new mongoose.Schema({
  _id: { type: id, required: true }, // Original vault page ID
  groupId: { type: id, required: true, immutable: true },
  status: { type: String, enum: ['unreviewed', 'processing', 'dismissed', 'completed', 'expired'], required: true },
  submittedOn: String,
  updatedBy: id,
}, { collection: 'insuranceclaims', versionKey: false });

module.exports = mongoose.model('InsuranceClaim', schema);
