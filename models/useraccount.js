const mongoose = require('mongoose');

const Useraccount = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  email: { type: String, required: true, max: 100 },
  type_user: { type: String, required: true, max: 10 },
  hash_password: { type: String, required: true, max: 256 },
  mypage_icon_settings: {
    order: [{ type: String }],
    hidden: [{ type: String }],
    updatedAt: { type: Date },
  },
});

module.exports = mongoose.model('useraccount', Useraccount);
