const mongoose = require('mongoose');

const esUnitConversionSchema = new mongoose.Schema({
  operationId: { type: String, required: true, unique: true, index: true },
  categoryId: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['prepared', 'applying', 'completed', 'rolled-back', 'rollback-failed', 'lock-conflict'],
    required: true,
    index: true,
  },
  fromUnit: { type: String, required: true },
  toUnit: { type: String, required: true },
  factor: { type: Number, required: true, min: 0 },
  automatic: { type: Boolean, required: true },
  categorySnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  itemSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
  completedAt: { type: Date },
  rolledBackAt: { type: Date },
  failure: { type: String, trim: true },
}, { timestamps: true });

esUnitConversionSchema.index({ categoryId: 1, createdAt: -1 });

module.exports = mongoose.model('esUnitConversion', esUnitConversionSchema);
