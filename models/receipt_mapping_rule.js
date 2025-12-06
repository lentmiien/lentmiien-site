const mongoose = require('mongoose');

const ConditionSchema = new mongoose.Schema({
  field: {
    type: String,
    enum: ['business_name', 'business_address', 'layout_text', 'method', 'amount'],
    required: true,
  },
  operator: {
    type: String,
    enum: ['icontains', 'equals', 'regex', 'not_contains'],
    default: 'icontains',
  },
  value: { type: String, required: true },
}, { _id: false });

const BudgetPrefillSchema = new mongoose.Schema({
  from_account: { type: String },
  to_account: { type: String },
  from_fee: { type: Number, default: 0 },
  to_fee: { type: Number, default: 0 },
  categories: { type: String },
  tags: { type: String },
  type: { type: String },
  transaction_business: { type: String },
}, { _id: false });

const CreditPrefillSchema = new mongoose.Schema({
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'credit_card' },
  label: { type: String },
  external: { type: Boolean, default: false },
  externalMultiplier: { type: Number, default: 1 },
}, { _id: false });

const ReceiptMappingRuleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  target: {
    type: String,
    enum: ['budget', 'credit'],
    default: 'budget',
  },
  priority: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  conditions: {
    type: [ConditionSchema],
    default: [],
  },
  budgetPrefill: {
    type: BudgetPrefillSchema,
    default: () => ({}),
  },
  creditPrefill: {
    type: CreditPrefillSchema,
    default: () => ({}),
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('receipt_mapping_rule', ReceiptMappingRuleSchema);
