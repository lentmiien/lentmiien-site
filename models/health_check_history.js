const mongoose = require('mongoose');
const { Schema } = mongoose;
const measurementSchema = new Schema({
  id: { type: String, required: true }, category: String, name: String, original: String,
  value: Schema.Types.Mixed, unit: String, reference_range: String, rating: String,
  finding: String, description: String, why_useful: String,
}, { _id: false });
const sectionSchema = new Schema({ name: String, original_japanese: String, section_rating: String }, { _id: false });
const examSchema = new Schema({
  exam_date: { type: String, required: true }, overall_rating: String,
  metabolic_syndrome_determination: String, overall_comment: String, doctor_comment: String,
  metabolic_comment: String, doctor_judgment: String, report_notes: String,
  institution: String, doctor: String, measurements: [measurementSchema], sections: [sectionSchema],
}, { _id: false });
const historySchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  revision: { type: Number, required: true, default: 0 },
  exams: [examSchema],
}, { timestamps: true, collection: 'health_check_histories' });
historySchema.index({ ownerId: 1 }, { unique: true });
module.exports = mongoose.model('HealthCheckHistory', historySchema);
