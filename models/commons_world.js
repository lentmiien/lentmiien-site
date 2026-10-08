const mongoose = require('mongoose');
const { Schema } = mongoose;
const Player = new Schema({
  userId: { type: String, required: true, immutable: true },
  plot: { type: Number, required: true },
  x: Number, y: Number, facing: String, scene: String,
  petals: { type: Number, default: 0 }, lantern: { type: Boolean, default: false },
  decorated: { type: Boolean, default: false },
  discoveries: { type: [String], default: [] }, watered: { type: [String], default: [] },
  receipts: { type: [{ _id: false, id: String, message: String }], default: [] },
}, { _id: false });
const CommonsWorld = new Schema({
  _id: { type: String }, version: { type: Number, required: true }, revision: { type: Number, default: 0 },
  leaseOwner: String, leaseUntil: Date, players: { type: [Player], default: [] },
  blooms: { type: Number, default: 0 }, savedAt: Date,
}, { versionKey: false, bufferCommands: false });
module.exports = mongoose.model('CommonsWorld', CommonsWorld);
