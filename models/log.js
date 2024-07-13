const mongoose = require('mongoose');

const Log = new mongoose.Schema({
  device: { type: String },
  timestamp: { type: Date },
  power: { type: Number },
});

module.exports = mongoose.model('log', Log);
