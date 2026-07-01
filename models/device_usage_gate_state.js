const mongoose = require('mongoose');

const { Schema } = mongoose;

const DeviceUsageGateStateSchema = new Schema({
  localDateKey: { type: String, required: true, unique: true, index: true },
  manualStudyMinutes: { type: Number, required: true, min: 0, max: 1440, default: 0 },
  manualStudyNote: { type: String, default: '' },
  manualStudyUpdatedAt: { type: Date, default: null },
  manualStudyUpdatedBy: { type: String, default: null },
  homeworkCleared: { type: Boolean, required: true, default: false, index: true },
  homeworkClearedAt: { type: Date, default: null },
  homeworkClearedBy: { type: String, default: null },
  homeworkUpdatedAt: { type: Date, default: null },
  homeworkUpdatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('device_usage_gate_state', DeviceUsageGateStateSchema);
