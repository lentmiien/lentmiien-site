const mongoose = require('mongoose');

const TapoMonthlyConsumptionSnapshotSchema = new mongoose.Schema(
  {
    deviceName: { type: String, required: true, trim: true, index: true },
    deviceNameKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    monthKey: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    year: { type: Number, required: true, index: true },
    month: { type: Number, required: true, index: true },
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
  },
  { timestamps: true }
);

TapoMonthlyConsumptionSnapshotSchema.index({ deviceNameKey: 1, monthKey: 1 }, { unique: true });

module.exports = mongoose.model(
  'tapo_monthly_consumption_snapshot',
  TapoMonthlyConsumptionSnapshotSchema,
  'tapo_monthly_consumption_snapshots'
);
