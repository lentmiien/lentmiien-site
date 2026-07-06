const mongoose = require('mongoose');

const { Schema } = mongoose;

const PriceSchema = new Schema({
  input: { type: Number, default: 0, min: 0 },
  cached: { type: Number, default: 0, min: 0 },
  output: { type: Number, default: 0, min: 0 },
  reasoning: { type: Number, default: 0, min: 0 },
}, { _id: false });

const UserRefSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const CodexTokenPriceSchema = new Schema({
  _id: { type: String, default: 'default' },
  currency: { type: String, default: 'USD', trim: true, maxlength: 12 },
  unitTokens: { type: Number, default: 1000000, min: 1 },
  prices: { type: PriceSchema, default: () => ({}) },
  updatedBy: { type: UserRefSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('codex_token_price', CodexTokenPriceSchema);
