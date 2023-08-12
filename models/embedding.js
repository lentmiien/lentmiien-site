const mongoose = require('mongoose');

const Embedding = new mongoose.Schema({
  database: { type: String, required: true },
  database_id: { type: String, required: true },
  embedding: { type: [Number], required: true },
  tokens: { type: Number, required: true },
});

module.exports = mongoose.model('embedding', Embedding);
