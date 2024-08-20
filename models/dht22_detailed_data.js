const mongoose = require('mongoose');

const Dht22DetailedData = new mongoose.Schema({
  min: { type: Object },//{temperature:26.2, humidity:55}
  max: { type: Object },//{temperature:26.4, humidity:55.2}
  avg: { type: Object },//{temperature:26.268, humidity:55.112}
  timestamp: { type: Date },
});

module.exports = mongoose.model('dht22_detailed_data', Dht22DetailedData, "dht22_detailed_data");
