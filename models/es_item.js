const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
  domainUnits: { type: Number, min: 0, default: 0 },
  completeMeals: { type: Number, min: 0, default: 0 },
  stapleServings: { type: Number, min: 0, default: 0 },
  mainDishServings: { type: Number, min: 0, default: 0 },
  produceServings: { type: Number, min: 0, default: 0 },
  supplementalServings: { type: Number, min: 0, default: 0 },
  noCookMeals: { type: Number, min: 0, default: 0 },
  waterLitresRequired: { type: Number, min: 0, default: 0 },
  fuelMealsRequired: { type: Number, min: 0, default: 0 },
}, { _id: false });

const esItemSchema = new mongoose.Schema({
  categoryId: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  label: { type: String, trim: true },

  // rotateDate is retained as the v1 compatibility date. New records use
  // expiresAt or inspectionDueAt according to their category's mode.
  rotateDate: { type: Date },
  expiresAt: { type: Date },
  inspectionDueAt: { type: Date },
  lastVerifiedAt: { type: Date },
  opened: { type: Boolean, default: false },
  packageSize: { type: Number, min: 0 },
  notes: { type: String, trim: true },
  foodRole: {
    type: String,
    enum: ['complete', 'staple', 'main', 'produce', 'supplemental'],
  },
  contributionOverride: { type: contributionSchema, default: undefined },
  status: {
    type: String,
    enum: ['active', 'consumed', 'discarded', 'replaced'],
    default: 'active',
    index: true,
  },
  resolvedAt: { type: Date, index: true },
  resolutionNote: { type: String, trim: true },
  quantityUpdatedAt: { type: Date },
}, { timestamps: true });

esItemSchema.index({ categoryId: 1, status: 1 });
esItemSchema.index({ expiresAt: 1, status: 1 });
esItemSchema.index({ inspectionDueAt: 1, status: 1 });

module.exports = mongoose.model('esItem', esItemSchema);
