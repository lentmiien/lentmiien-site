const mongoose = require('mongoose');

const Account = new mongoose.Schema({
  account_name: { type: String, required: true, max: 100 } // Account name, ex "82 Bank"
});

module.exports = mongoose.model('account', Account);
