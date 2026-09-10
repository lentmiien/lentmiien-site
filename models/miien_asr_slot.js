const mongoose = require('mongoose');

// Two fixed global slots and one outstanding request per principal, across
// workers/restarts. No private payload and no automatic expiry of uncertain work.
// Compiled before database startup with global buffering disabled. Never start
// DDL here: admission verifies operator-provisioned indexes after DB readiness.
const MiienAsrSlotSchema = new mongoose.Schema({
  _id: { type: String },
  jobId: { type: String, required: true },
  principalId: { type: String, required: true, unique: true },
  conversationId: { type: String, required: true },
  startedAt: { type: Date, required: true },
}, { versionKey: false, autoCreate: false, autoIndex: false, bufferCommands: false });
module.exports = mongoose.model('miien_asr_slot', MiienAsrSlotSchema);
