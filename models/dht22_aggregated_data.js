const mongoose = require('mongoose');

const Dht22AggregatedData = new mongoose.Schema({
  timestamp: { type: Date },
  average_temperature: { type: Number },
  average_humidity: { type: Number },
});

module.exports = mongoose.model('dht22_aggregated_data', Dht22AggregatedData, "dht22_aggregated_data");
