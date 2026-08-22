const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  deadline: { type: Date, required: true },
  targetDays: { type: Number, required: true, min: 0 },
}, { _id: false });

const sourceSchema = new mongoose.Schema({
  label: { type: String, trim: true },
  url: { type: String, trim: true },
  sourceDate: { type: Date },
}, { _id: false });

const esProfileSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'household' },
  householdSize: { type: Number, required: true, min: 1, default: 3 },
  officialFloorDays: { type: Number, required: true, min: 0, default: 3 },
  longTermTargetDays: { type: Number, required: true, min: 0, default: 7 },
  longTermGoalDate: { type: Date, default: () => new Date('2026-12-31T00:00:00.000Z') },
  milestones: { type: [milestoneSchema], default: undefined },
  mealsPerPersonDay: { type: Number, required: true, min: 1, default: 3 },
  waterLitresPerPersonDay: { type: Number, required: true, min: 0, default: 3 },
  toiletUsesPerPersonDay: { type: Number, required: true, min: 0, default: 5 },
  assumptions: { type: String, trim: true },
  lastHouseholdReviewAt: { type: Date },
  recommendationReviewedAt: { type: Date },
  recommendationNextReviewAt: { type: Date, default: () => new Date('2028-01-01T00:00:00.000Z') },
  recommendationSource: { type: sourceSchema, default: undefined },
  timeZone: { type: String, default: 'Asia/Tokyo', trim: true },
}, { timestamps: true });

module.exports = mongoose.model('esProfile', esProfileSchema);
