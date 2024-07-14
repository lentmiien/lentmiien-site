const mongoose = require('mongoose');

const Summary = new mongoose.Schema({
  device: { type: String },
  timestamp: { type: Date },
  power: { type: Number },
});

module.exports = mongoose.model('summary', Summary, 'summary');
