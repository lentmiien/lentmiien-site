const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  category: { type: String, required: true },
  score: { type: Number, min: 0, max: 3, required: true }
});

const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true, unique: true },
  comment: { type: String },
  ratings: [ratingSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Image', imageSchema);
