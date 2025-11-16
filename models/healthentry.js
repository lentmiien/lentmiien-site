const mongoose = require('mongoose');

const ThresholdSchema = new mongoose.Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
  },
  { _id: false }
);

const InsightSchema = new mongoose.Schema(
  {
    metric: { type: String, required: true },
    windowSize: { type: Number, required: true },
    movingAverage: { type: Number },
    min: { type: Number },
    max: { type: Number },
    latest: { type: Number },
    trend: { type: String, enum: ['up', 'down', 'flat'] },
    computedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AlertSchema = new mongoose.Schema(
  {
    metric: { type: String, required: true },
    type: { type: String, enum: ['low', 'high'], required: true },
    threshold: { type: Number },
    value: { type: Number },
    triggeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const HealthEntry = new mongoose.Schema(
  {
    dateOfEntry: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    basicData: { type: Map, of: String, default: {} },
    medicalRecord: { type: Map, of: String, default: {} },
    diary: { type: [String], default: [] }, // each entry is a String representing chat3 entry ID
    measurementType: { type: String, trim: true },
    measurementContext: { type: String, trim: true },
    tags: { type: [String], default: [] },
    notes: { type: String, trim: true },
    personalizedThresholds: { type: Map, of: ThresholdSchema, default: undefined },
    analyticsSummary: {
      computedAt: { type: Date },
      windowSize: { type: Number },
      insights: [InsightSchema],
      alerts: [AlertSchema],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('healthentry', HealthEntry);
