const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
  domainUnits: { type: Number, min: 0, default: 0 },
  completeMeals: { type: Number, min: 0, default: 0 },
  stapleServings: { type: Number, min: 0, default: 0 },
  mainDishServings: { type: Number, min: 0, default: 0 },
  produceServings: { type: Number, min: 0, default: 0 },
  noCookMeals: { type: Number, min: 0, default: 0 },
  waterLitresRequired: { type: Number, min: 0, default: 0 },
  fuelMealsRequired: { type: Number, min: 0, default: 0 },
}, { _id: false });

const milestoneSchema = new mongoose.Schema({
  deadline: { type: Date, required: true },
  target: { type: Number, required: true, min: 0 },
}, { _id: false });

const sourceSchema = new mongoose.Schema({
  label: { type: String, trim: true },
  url: { type: String, trim: true },
  sourceDate: { type: Date },
  lastReviewedAt: { type: Date },
}, { _id: false });

const esCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },

  // Legacy v1 fields remain readable so existing records are never silently
  // discarded. V2 uses the policy fields below when they are present.
  recommendedStock: { type: Number, min: 0, default: 0 },
  unit: { type: String, required: true, trim: true },
  rotationPeriodMonths: { type: Number, min: 1, default: 12 },

  managementMode: {
    type: String,
    enum: ['rolling', 'expiry-managed', 'durable'],
  },
  applicable: { type: Boolean, default: true },
  applicabilityStatus: {
    type: String,
    enum: ['applicable', 'not-applicable', 'undecided'],
  },
  conditional: { type: Boolean, default: false },
  targetStrategy: {
    type: String,
    enum: ['duration-scaled', 'fixed'],
  },
  preparednessDomain: {
    type: String,
    enum: ['water', 'food', 'toilet', 'critical-medication', 'cooking-fuel', 'power', 'other'],
    default: 'other',
  },

  purpose: { type: String, trim: true },
  whyItMatters: { type: String, trim: true },
  qualifies: { type: String, trim: true },
  doesNotQualify: { type: String, trim: true },
  calculationRule: { type: String, trim: true },
  examples: [{ type: String, trim: true }],
  householdNote: { type: String, trim: true },

  officialBaseline: { type: Number, min: 0 },
  personalTarget: { type: Number, min: 0 },
  goalDate: { type: Date },
  milestones: { type: [milestoneSchema], default: undefined },

  emergencyFloor: { type: Number, min: 0 },
  reorderPoint: { type: Number, min: 0 },
  restockToAmount: { type: Number, min: 0 },
  normalConsumptionRate: { type: Number, min: 0 },
  consumptionPeriodDays: { type: Number, min: 1, default: 30 },
  shoppingLeadDays: { type: Number, min: 0, default: 7 },
  packageSize: { type: Number, min: 0 },
  lastStockCheck: { type: Date },

  unitsPerPersonDay: { type: Number, min: 0 },
  dependentCount: { type: Number, min: 0 },
  contributionPerUnit: { type: contributionSchema, default: undefined },
  inspectionIntervalMonths: { type: Number, min: 1, default: 6 },

  source: { type: sourceSchema, default: undefined },
  recommendationReviewedAt: { type: Date },
}, { timestamps: true });

esCategorySchema.index({ managementMode: 1, applicabilityStatus: 1 });
esCategorySchema.index({ preparednessDomain: 1, applicable: 1 });

module.exports = mongoose.model('esCategory', esCategorySchema);
