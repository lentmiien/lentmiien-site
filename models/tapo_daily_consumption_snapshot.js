const mongoose = require('mongoose');

const TapoDailyConsumptionSnapshotSchema = new mongoose.Schema(
  {
    deviceName: { type: String, required: true, trim: true, index: true },
    deviceNameKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    year: { type: Number, required: true, index: true },
    month: { type: Number, required: true, index: true },
    day: { type: Number, required: true },
    consumptionKwh: { type: Number, required: true },
    source: { type: String, trim: true, default: null },
    readingId: { type: String, trim: true, default: null },
    readingKind: { type: String, trim: true, default: 'sample' },
    deviceIp: { type: String, trim: true, default: null },
    model: { type: String, trim: true, default: null },
    currentPowerW: { type: Number, default: null },
    lastReadingAt: { type: Date, required: true, index: true },
    bucketStartUtc: { type: Date, required: true },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

TapoDailyConsumptionSnapshotSchema.index({ deviceNameKey: 1, dateKey: 1 }, { unique: true });
TapoDailyConsumptionSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model(
  'tapo_daily_consumption_snapshot',
  TapoDailyConsumptionSnapshotSchema,
  'tapo_daily_consumption_snapshots'
);
