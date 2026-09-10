const mongoose = require('mongoose');

const Account_db = new mongoose.Schema({
  name: { type: String, required: true }, // Understandable account name
  balance: { type: Number, required: true }, // Account balance at given date below
  balance_date: { type: Number, required: true }, // Date as an integer (ex 20221207 -> December 7th 2022)
  currency: { type: String, required: true }, // Currency of account
  closedThrough: { type: Number }, // Explicitly reconciled end-of-day boundary
  balanceHistory: [{
    _id: false,
    balance: Number,
    balance_date: Number,
    closedBalance: Number,
    closedThrough: Number,
    confirmedAt: Date,
    confirmedBy: mongoose.Schema.Types.ObjectId,
  }],
});

module.exports = mongoose.model('account_db', Account_db);
