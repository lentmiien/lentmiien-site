const mongoose = require('mongoose');

const Useraccount = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  email: { type: String, required: true, max: 100 },
  type_user: { type: String, required: true, max: 10 },
  hash_password: { type: String, required: true, max: 256 },
  dashboard_settings: { type: mongoose.Schema.Types.Mixed, default: undefined },
  navbar_settings: { type: mongoose.Schema.Types.Mixed, default: undefined },
  mypage_icon_settings: {
    order: [{ type: String }],
    hidden: [{ type: String }],
    updatedAt: { type: Date },
  },
});

module.exports = mongoose.model('useraccount', Useraccount);
