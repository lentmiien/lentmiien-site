const mongoose = require('mongoose');

const Useraccount = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  email: { type: String, required: true, max: 100 },
  type_user: { type: String, required: true, max: 10 },
  hash_password: { type: String, required: true, max: 256 },
});

module.exports = mongoose.model('useraccount', Useraccount);
