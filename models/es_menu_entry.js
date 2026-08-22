const mongoose = require('mongoose');

const esMenuEntrySchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 5 },
  meal: { type: String, required: true, enum: ['breakfast', 'lunch', 'dinner'] },
  label: { type: String, required: true, trim: true },
  servings: { type: Number, required: true, min: 0.1 },
  stapleSource: { type: String, trim: true },
  mainDishSource: { type: String, trim: true },
  produceSource: { type: String, trim: true },
  noCook: { type: Boolean, default: false },
  waterLitresRequired: { type: Number, min: 0, default: 0 },
  requiresFuel: { type: Boolean, default: false },
  dietaryNote: { type: String, trim: true },
}, { timestamps: true });

esMenuEntrySchema.index({ day: 1, meal: 1 }, { unique: true });

module.exports = mongoose.model('esMenuEntry', esMenuEntrySchema);
