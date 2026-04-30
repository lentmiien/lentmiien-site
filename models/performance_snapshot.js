const mongoose = require('mongoose');

const { Schema } = mongoose;

const DEFAULT_SNAPSHOT_RETENTION_DAYS = 7;
const retentionDays = Number.parseInt(process.env.PERFORMANCE_SNAPSHOT_RETENTION_DAYS || '', 10);
const snapshotRetentionSeconds = (
  Number.isInteger(retentionDays) && retentionDays > 0
    ? retentionDays
    : DEFAULT_SNAPSHOT_RETENTION_DAYS
) * 24 * 60 * 60;

const RouteStatsSchema = new Schema({
  method: { type: String, required: true },
  route: { type: String, required: true },
  label: { type: String, required: true },
  count: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  slowCount: { type: Number, default: 0 },
  avgMs: { type: Number, default: 0 },
  p50Ms: { type: Number, default: 0 },
  p95Ms: { type: Number, default: 0 },
  p99Ms: { type: Number, default: 0 },
  maxMs: { type: Number, default: 0 },
  statusCounts: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const TaskStatsSchema = new Schema({
  name: { type: String, required: true },
  count: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  avgMs: { type: Number, default: 0 },
  p50Ms: { type: Number, default: 0 },
  p95Ms: { type: Number, default: 0 },
  p99Ms: { type: Number, default: 0 },
  maxMs: { type: Number, default: 0 },
}, { _id: false });

const PerformanceSnapshotSchema = new Schema({
  capturedAt: { type: Date, default: Date.now },
  intervalStartedAt: { type: Date, required: true },
  intervalMs: { type: Number, required: true },
  runtime: {
    pid: { type: Number },
    nodeVersion: { type: String },
    platform: { type: String },
    arch: { type: String },
    uptimeSec: { type: Number },
    memory: {
      rssBytes: { type: Number },
      heapTotalBytes: { type: Number },
      heapUsedBytes: { type: Number },
      externalBytes: { type: Number },
      arrayBuffersBytes: { type: Number },
    },
    cpu: {
      userMicros: { type: Number },
      systemMicros: { type: Number },
      userPercent: { type: Number },
      systemPercent: { type: Number },
      totalPercent: { type: Number },
    },
    eventLoop: {
      utilization: { type: Number },
      activeMs: { type: Number },
      idleMs: { type: Number },
      delayMinMs: { type: Number },
      delayMeanMs: { type: Number },
      delayP50Ms: { type: Number },
      delayP95Ms: { type: Number },
      delayP99Ms: { type: Number },
      delayMaxMs: { type: Number },
    },
  },
  requests: {
    totalCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    slowCount: { type: Number, default: 0 },
    activeCount: { type: Number, default: 0 },
    peakActiveCount: { type: Number, default: 0 },
    statusCounts: { type: Schema.Types.Mixed, default: {} },
  },
  routes: { type: [RouteStatsSchema], default: [] },
  tasks: { type: [TaskStatsSchema], default: [] },
}, {
  minimize: false,
});

PerformanceSnapshotSchema.index({ capturedAt: 1 }, { expireAfterSeconds: snapshotRetentionSeconds });

module.exports = mongoose.model('performance_snapshot', PerformanceSnapshotSchema);
