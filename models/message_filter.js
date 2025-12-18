const mongoose = require('mongoose');

const { Schema } = mongoose;

const LabelRuleSchema = new Schema({
  label: { type: String, required: true, trim: true, lowercase: true },
  retentionDays: { type: Number, min: 1, default: null },
  generateEmbedding: { type: Boolean, default: false },
  generateHighQualityEmbedding: { type: Boolean, default: false },
}, { _id: false });

const MessageFilterSchema = new Schema({
  sender: { type: String, required: true, trim: true, lowercase: true, unique: true },
  retentionDays: { type: Number, min: 1, default: 90 },
  generateEmbedding: { type: Boolean, default: false },
  generateHighQualityEmbedding: { type: Boolean, default: false },
  labelRules: { type: [LabelRuleSchema], default: [] },
}, {
  timestamps: true,
});

module.exports = mongoose.model('message_filter', MessageFilterSchema);
