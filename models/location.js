const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  user: { type: String, required: true },
  name: { type: String, required: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number]
  }
});

locationSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Location', locationSchema);
