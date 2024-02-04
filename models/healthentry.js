const mongoose = require('mongoose');

const HealthEntry = new mongoose.Schema({
  dateOfEntry: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  basicData: { type: Map, of: String },
  medicalRecord: { type: Map, of: String },
  diary: [String] // each entry is a String representing chat3 entry ID
});

module.exports = mongoose.model('healthentry', HealthEntry);
