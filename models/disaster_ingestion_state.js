const mongoose = require('mongoose');

const { Schema } = mongoose;

const DisasterFeedStateSchema = new Schema({
  url: { type: String, required: true, trim: true },
  title: { type: String, trim: true, default: null },
  lastCheckedAt: { type: Date, default: null },
  lastUpdatedAt: { type: Date, default: null },
  lastStatus: { type: String, trim: true, default: null },
  lastError: { type: String, trim: true, default: null },
  newEntries: { type: Number, default: 0 },
}, { _id: false });

const DisasterIngestionStateSchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  startedAt: { type: Date, required: true },
  lastRunAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  lastErrorAt: { type: Date, default: null },
  lastError: { type: String, trim: true, default: null },
  running: { type: Boolean, default: false },
  feeds: { type: [DisasterFeedStateSchema], default: [] },
  counters: { type: Schema.Types.Mixed, default: {} },
}, {
  minimize: false,
  timestamps: true,
});

module.exports = mongoose.model('disaster_ingestion_state', DisasterIngestionStateSchema, 'disaster_ingestion_states');
