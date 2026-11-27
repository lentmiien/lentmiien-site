const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    _id: String,
    schemaVersion: { type: Number, required: true },
    revision: { type: Number, required: true },
    paused: { type: Boolean, required: true },
    payload: { type: String, required: true },
    writer: String,
    lastOperation: String,
    leaseUntil: Date,
    savedAt: Date
  },
  { versionKey: false, bufferCommands: false, collection: 'emberwake_worlds' }
);

module.exports = mongoose.model('EmberwakeWorld', schema);
