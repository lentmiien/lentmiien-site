const mongoose = require('mongoose');

const Receipt = new mongoose.Schema({
  date: { type: Date, required: true },
  time: { type: String },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  business_name: { type: String },
  business_address: { type: String },
  layout_text: { type: String, default: '' },
  // Historical records reference a public/img filename and have no owner.
  file: { type: String, required: function () { return this.isNew && !this.scanJpeg; } },
  ownerId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  uploadDigest: { type: String, select: false, immutable: true },
  scanJpeg: { type: Buffer, select: false },
});

module.exports = mongoose.model('receipt', Receipt);
