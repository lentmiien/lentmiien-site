const mongoose = require('mongoose');

const esItemSchema = new mongoose.Schema({
  categoryId: { type: String, required: true },
  amount: { type: Number, required: true },
  rotateDate: { type: Date, required: true },
  label: { type: String }
});

module.exports = mongoose.model('esItem', esItemSchema);
