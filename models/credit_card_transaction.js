const mongoose = require('mongoose');

const CreditCardTransactionSchema = new mongoose.Schema({
  creditCard: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'credit_card',
    required: true,
    index: true,
  },
  transactionDate: {
    type: Date,
    required: true,
  },
  label: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  external: {
    type: Boolean,
    default: false,
  },
  externalMultiplier: {
    type: Number,
    default: 1,
    min: 0,
  },
}, {
  timestamps: true,
});

CreditCardTransactionSchema.index({ creditCard: 1, transactionDate: 1 });

module.exports = mongoose.model('credit_card_transaction', CreditCardTransactionSchema);
