const mongoose = require('mongoose');

const ExternalAssetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  kind: {
    type: String,
    enum: ['savings', 'loan'],
    required: true,
    default: 'savings',
    index: true,
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{3}$/,
    default: 'JPY',
    index: true,
  },
  startDate: {
    type: String,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  scheduledEndDate: {
    type: String,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  currentBalance: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  balanceDate: {
    type: String,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  monthlyPayment: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  annualInterestRate: {
    type: Number,
    default: 0,
  },
  compounding: {
    type: String,
    enum: ['none', 'monthly', 'yearly'],
    default: 'monthly',
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

ExternalAssetSchema.index({ active: 1, kind: 1, name: 1 });

module.exports = mongoose.model('external_asset', ExternalAssetSchema);
