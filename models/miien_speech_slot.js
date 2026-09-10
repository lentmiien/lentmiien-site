const mongoose = require('mongoose');

// One durable admission slot, not an audio store. Never automatically expire an
// ambiguous upstream request: the Gateway cannot confirm cancellation.
const MiienSpeechSlotSchema = new mongoose.Schema({
  _id: { type: String },
  jobId: { type: String, required: true },
  principalId: { type: String, required: true },
  conversationId: { type: String, required: true },
  startedAt: { type: Date, required: true },
}, { versionKey: false });
module.exports = mongoose.model('miien_speech_slot', MiienSpeechSlotSchema);
