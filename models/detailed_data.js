const mongoose = require('mongoose');

const DetailedData = new mongoose.Schema({
  timestamp: { type: Date },
  accel_x: { type: Number },
  accel_y: { type: Number },
  accel_z: { type: Number },
});

module.exports = mongoose.model('detailed_data', DetailedData, "detailed_data");
