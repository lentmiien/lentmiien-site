const mongoose = require('mongoose');

const Useraccount = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  email: { type: String, required: true, max: 100 },
  type_user: { type: String, required: true, max: 10 },
  hash_password: { type: String, required: true, max: 256 },
  password_changed_at: { type: Date, default: null },
  password_change_requested: { type: Boolean, default: false },
  two_factor: {
    enabled: { type: Boolean, default: false },
    version: { type: String, default: '' },
    secret: { type: String, select: false },
    last_step: { type: Number, default: -1, select: false },
    recovery_hashes: { type: [String], default: [], select: false },
  },
  dashboard_settings: { type: mongoose.Schema.Types.Mixed, default: undefined },
  navbar_settings: { type: mongoose.Schema.Types.Mixed, default: undefined },
  mypage_icon_settings: {
    order: [{ type: String }],
    hidden: [{ type: String }],
    updatedAt: { type: Date },
  },
});

module.exports = mongoose.model('useraccount', Useraccount);
