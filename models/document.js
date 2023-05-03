const mongoose = require('mongoose');

const Document = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  username: { type: String, required: true, max: 100 },
  ai_type: { type: String, required: true },
  document_type: { type: String, required: true },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
});

module.exports = mongoose.model('document', Document);
