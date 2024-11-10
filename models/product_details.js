const mongoose = require('mongoose');

const ProductDetails = new mongoose.Schema({
  product_code: { type: String, required: true },
  name: { type: String, required: true },
  details: { type: String, required: true },
  content: { type: String },
  description: { type: String },
  price: { type: Number, required: true },
  ai_description: { type: String, required: true },
  created: { type: Date },
  material: { type: String },
  size: { type: String },
  usage: { type: String },
  additional_notes: { type: String },
});

module.exports = mongoose.model('productdetails', ProductDetails);
