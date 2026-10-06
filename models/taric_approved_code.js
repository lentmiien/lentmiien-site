const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: String, required: true, match: /^\d{10}$/ },
  headings: { type: String, default: '', maxlength: 4000 },
  goods_summary: { type: String, default: '', maxlength: 2000 },
  description_summary: { type: String, default: '', maxlength: 255 },
  approved: { type: Boolean, required: true, default: true },
  revision: { type: Number, required: true, default: 1, min: 1 },
  updatedBy: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
}, { timestamps: true, strict: 'throw', versionKey: false });
module.exports = mongoose.models.taric_approved_codes || mongoose.model('taric_approved_codes', schema, 'taric_approved_codes');
