const mongoose = require('mongoose');

const CreditCardSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  issuedDate: {
    type: Date,
    default: null,
  },
  creditLimit: {
    type: Number,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('credit_card', CreditCardSchema);
