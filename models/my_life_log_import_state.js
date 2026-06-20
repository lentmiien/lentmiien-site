const mongoose = require('mongoose');

const { Schema } = mongoose;

const MyLifeLogImportStateSchema = new Schema({
  source: { type: String, required: true, trim: true },
  importedThrough: { type: Date, default: null },
  lastFileName: { type: String, trim: true, default: '' },
  lastPreviewedAt: { type: Date, default: null },
  lastImportedAt: { type: Date, default: null },
  lastImportSummary: { type: Schema.Types.Mixed, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
});

MyLifeLogImportStateSchema.index({ source: 1 }, { unique: true });

module.exports = mongoose.model('my_life_log_import_state', MyLifeLogImportStateSchema);
