const mongoose = require('mongoose');

const Transaction = new mongoose.Schema({
  transaction_date: { type: Date, required: true }, // Date of the transaction
  account_id: { type: String, required: true }, // ID of account for the transaction
  amount: { type: Number, required: true }, // Transfered amount
  category_id: { type: String, required: true }, // Group category, ex. Bills, Entertainment, Home...
  tag_id: { type: String, required: true } // Tag of this transaction type, ex. Electrical Bill, Supermarket...
});

module.exports = mongoose.model('transaction', Transaction);
