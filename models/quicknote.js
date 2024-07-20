const mongoose = require('mongoose');

const quickNoteSchema = new mongoose.Schema({
  user: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number]
  },
  nearestLocation: {
    name: String,
    distance: Number
  }
});

module.exports = mongoose.model('QuickNote', quickNoteSchema);
