const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  date: { type: String, required: true, immutable: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  text: { type: String, default: '', maxlength: 10000 },
  revision: { type: Number, required: true, min: 1 },
  updatedAt: { type: Date, required: true },
}, { versionKey: false, bufferCommands: false });
schema.index({ ownerId: 1, date: -1 }, { unique: true });
module.exports = mongoose.model('CommonsDiary', schema);
