const mongoose = require('mongoose');

const AggregatedData = new mongoose.Schema({
  min: { type: Object },
  max: { type: Object },
  avg: { type: Object },
  timestamp: { type: Date },
});

module.exports = mongoose.model('aggregated_data', AggregatedData, "aggregated_data");
