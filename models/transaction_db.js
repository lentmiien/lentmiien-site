const mongoose = require('mongoose');

const Transaction_db = new mongoose.Schema({
  from_account: { type: String, required: true }, // Account id of payer
  to_account: { type: String, required: true }, // Account id of receiver
  from_fee: { type: Number, required: true }, // Transaction fee for payer
  to_fee: { type: Number, required: true }, // Transaction fee for receiver
  amount: { type: Number, required: true }, // Transaction amount
  date: { type: Number, required: true }, // Date as an integer (ex 20221207 -> December 7th 2022)
  transaction_business: { type: String, required: true }, // Business for external transaction
  type: { type: String, required: true }, // Type of transaction
  categories: { type: String, required: true }, // Categories
  tags: { type: String, required: true }, // Tags
});

module.exports = mongoose.model('transaction_db', Transaction_db);
