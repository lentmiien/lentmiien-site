const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, index: true },
  boxes: [{ _id: false, id: String, emptyWeight: Number, maxLoadWeight: Number }],
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true, bufferCommands: false });
module.exports = mongoose.model('PackingJob', schema);
