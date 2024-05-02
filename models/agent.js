const mongoose = require('mongoose');

const Agent = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  description: { type: String, required: true },
  context: { type: String, required: true },
  memory: { type: String, required: true },
});

module.exports = mongoose.model('agent', Agent);
