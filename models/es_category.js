const mongoose = require('mongoose');

const esCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  recommendedStock: { type: Number, required: true },
  unit: { type: String, required: true },
  rotationPeriodMonths: { type: Number, required: true }
});

module.exports = mongoose.model('esCategory', esCategorySchema);
