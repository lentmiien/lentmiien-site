const mongoose = require('mongoose');

const CreditCardMonthlyBalanceSchema = new mongoose.Schema({
  creditCard: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'credit_card',
    required: true,
    index: true,
  },
  year: {
    type: Number,
    required: true,
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  startingBalance: {
    type: Number,
    default: 0,
  },
  usageTotal: {
    type: Number,
    default: 0,
  },
  repaymentTotal: {
    type: Number,
    default: 0,
  },
  externalPoints: {
    type: Number,
    default: 0,
  },
  closingBalance: {
    type: Number,
    default: 0,
  },
  confirmedAt: {
    type: Date,
    default: null,
  },
  note: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

CreditCardMonthlyBalanceSchema.index(
  { creditCard: 1, year: 1, month: 1 },
  { unique: true },
);

module.exports = mongoose.model('credit_card_monthly_balance', CreditCardMonthlyBalanceSchema);
