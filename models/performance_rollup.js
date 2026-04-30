const mongoose = require('mongoose');

const { Schema } = mongoose;

const PerformanceRollupSchema = new Schema({
  periodType: {
    type: String,
    required: true,
    enum: ['daily', 'monthly'],
  },
  periodKey: { type: String, required: true },
  metricType: {
    type: String,
    required: true,
    enum: ['overall', 'route', 'task'],
  },
  key: { type: String, required: true },
  method: { type: String, default: null },
  route: { type: String, default: null },
  taskName: { type: String, default: null },
  count: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  slowCount: { type: Number, default: 0 },
  totalDurationMs: { type: Number, default: 0 },
  maxDurationMs: { type: Number, default: 0 },
  status2xx: { type: Number, default: 0 },
  status3xx: { type: Number, default: 0 },
  status4xx: { type: Number, default: 0 },
  status5xx: { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
});

PerformanceRollupSchema.index(
  { periodType: 1, periodKey: 1, metricType: 1, key: 1 },
  { unique: true },
);
PerformanceRollupSchema.index({ periodType: 1, periodKey: -1, metricType: 1 });

module.exports = mongoose.model('performance_rollup', PerformanceRollupSchema);
