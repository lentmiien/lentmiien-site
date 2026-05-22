const mongoose = require('mongoose');

const TapoMetricsSchema = new mongoose.Schema(
  {
    current_power: { type: Number, default: null },
    today_energy: { type: Number, default: null },
    this_month_energy: { type: Number, default: null },
    total_energy: { type: Number, default: null },
    voltage: { type: Number, default: null },
    current: { type: Number, default: null },
    state: { type: Boolean, default: null },
    rssi: { type: Number, default: null },
    signal_level: { type: Number, default: null },
    overheated: { type: Boolean, default: null },
    overloaded: { type: Boolean, default: null },
  },
  { _id: false }
);

const TapoReadingSchema = new mongoose.Schema(
  {
    source: { type: String, trim: true, default: null },
    readingId: { type: String, trim: true, default: null, index: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    kind: { type: String, trim: true, default: 'sample', index: true },
    deviceName: { type: String, required: true, trim: true, index: true },
    deviceNameKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    deviceIp: { type: String, trim: true, default: null },
    model: { type: String, trim: true, default: null },
    timestampUtc: { type: Date, required: true, index: true },
    bucketStartUtc: { type: Date, required: true, index: true },
    localDateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    localMonthKey: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    metrics: { type: TapoMetricsSchema, default: () => ({}) },
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    featureErrors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    collector: { type: mongoose.Schema.Types.Mixed, default: {} },
    rawRecord: { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

TapoReadingSchema.index({ deviceNameKey: 1, kind: 1, bucketStartUtc: 1 });
TapoReadingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('tapo_reading', TapoReadingSchema, 'tapo_readings');
