const mongoose = require('mongoose');

// Deliberately no expiry: an expired lease could admit another writer while the
// first is still running. A crashed writer requires an operator to clear the lock.
module.exports = mongoose.model('accounting_write_lock', new mongoose.Schema({
  _id: String,
  token: { type: String, required: true },
  startedAt: { type: Date, required: true },
}));
