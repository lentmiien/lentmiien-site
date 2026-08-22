const mongoose = require('mongoose');

const esShoppingRequirementSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true, index: true },
  categoryId: { type: String, index: true },
  sourceItemId: { type: String, index: true },
  domain: {
    type: String,
    enum: ['water', 'food', 'toilet', 'critical-medication', 'cooking-fuel', 'power', 'other'],
    default: 'other',
  },
  label: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  requiredAmount: { type: Number, required: true, min: 0 },
  currentAmount: { type: Number, min: 0 },
  targetAmount: { type: Number, min: 0 },
  packageSize: { type: Number, min: 0 },
  reason: { type: String, required: true, trim: true },
  trigger: {
    type: String,
    enum: ['below-floor', 'reorder-point', 'milestone-gap', 'expiring-soon', 'manual'],
    required: true,
  },
  dueDate: { type: Date },
  status: {
    type: String,
    enum: ['needed', 'planned', 'purchased', 'resolved'],
    default: 'needed',
    index: true,
  },
  plannedAt: { type: Date },
  purchasedAt: { type: Date },
  resolvedAt: { type: Date },
}, { timestamps: true });

esShoppingRequirementSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model('esShoppingRequirement', esShoppingRequirementSchema);
