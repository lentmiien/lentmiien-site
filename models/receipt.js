const mongoose = require('mongoose');

const Receipt = new mongoose.Schema({
  date: { type: Date, required: true },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  business_name: { type: String },
  business_address: { type: String },
  layout_text: { type: String, default: '' },
  file: { type: String, required: true },
});

module.exports = mongoose.model('receipt', Receipt);
