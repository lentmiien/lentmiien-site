const mongoose = require('mongoose');

const ExchangeRateSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    base: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: 'JPY',
      index: true,
    },
    amount: {
      type: Number,
      default: 1,
    },
    rates: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);

ExchangeRateSchema.index({ base: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('exchange_rate', ExchangeRateSchema);
