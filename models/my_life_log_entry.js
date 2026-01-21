const mongoose = require('mongoose');

const { Schema } = mongoose;

const MyLifeLogEntrySchema = new Schema({
  type: { type: String, required: true, enum: ['basic', 'medical', 'diary', 'visual_log'] },
  label: { type: String, trim: true, default: '' },
  value: { type: String, trim: true, default: '' },
  text: { type: String, trim: true, default: '' },
  v_log_data: { type: String, default: '' },
  timestamp: { type: Date, required: true },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
});

MyLifeLogEntrySchema.index({ timestamp: -1 });
MyLifeLogEntrySchema.index({ label: 1 });
MyLifeLogEntrySchema.index({ type: 1 });

module.exports = mongoose.model('my_life_log_entry', MyLifeLogEntrySchema);
