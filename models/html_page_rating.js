const mongoose = require('mongoose');

const ratingValueValidator = {
  validator(value) {
    return value === null || (Number.isInteger(value) && value >= 1 && value <= 5);
  },
  message: 'Ratings must be an integer between 1 and 5.',
};

const ratingSchema = new mongoose.Schema({
  looksGood: { type: Number, default: null, validate: ratingValueValidator },
  isFun: { type: Number, default: null, validate: ratingValueValidator },
  hasGoodUi: { type: Number, default: null, validate: ratingValueValidator },
  educational: { type: Number, default: null, validate: ratingValueValidator },
}, { _id: false });

const htmlPageRatingSchema = new mongoose.Schema({
  filename: { type: String, required: true, unique: true },
  ratings: {
    type: ratingSchema,
    default: () => ({}),
  },
  notes: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  version: { type: Number, default: 1 },
}, {
  timestamps: true,
});

module.exports = mongoose.model('HtmlPageRating', htmlPageRatingSchema);
