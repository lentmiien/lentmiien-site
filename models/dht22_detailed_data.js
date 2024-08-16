const mongoose = require('mongoose');

const Dht22DetailedData = new mongoose.Schema({
  timestamp: { type: Date },
  temperature: { type: Number },
  humidity: { type: Number },
});

module.exports = mongoose.model('dht22_detailed_data', Dht22DetailedData, "dht22_detailed_data");
