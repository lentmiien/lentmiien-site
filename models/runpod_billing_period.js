const mongoose = require('mongoose');

const BillingAmountsSchema = new mongoose.Schema({
  totalAmount: { type: Number, default: 0, min: 0 },
  podGpuAmount: { type: Number, default: 0, min: 0 },
  podCpuAmount: { type: Number, default: 0, min: 0 },
  podDiskAmount: { type: Number, default: 0, min: 0 },
  serverlessGpuAmount: { type: Number, default: 0, min: 0 },
  serverlessCpuAmount: { type: Number, default: 0, min: 0 },
  serverlessDiskAmount: { type: Number, default: 0, min: 0 },
  serverlessFeeAmount: { type: Number, default: 0, min: 0 },
  storageStandardAmount: { type: Number, default: 0, min: 0 },
  storageHighPerformanceAmount: { type: Number, default: 0, min: 0 },
  endpointAmount: { type: Number, default: 0, min: 0 },
  clusterGpuAmount: { type: Number, default: 0, min: 0 },
  clusterDiskAmount: { type: Number, default: 0, min: 0 },
  clusterNetworkingAmount: { type: Number, default: 0, min: 0 },
}, { _id: false });

const RunpodBillingPeriodSchema = new mongoose.Schema({
  bucketSize: { type: String, enum: ['month'], default: 'month', required: true },
  periodKey: {
    type: String,
    required: true,
    trim: true,
    match: /^\d{4}-\d{2}$/,
  },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  currency: { type: String, enum: ['USD'], default: 'USD', required: true },
  source: {
    type: String,
    enum: ['provider', 'synthesized_zero', 'provisional_zero'],
    required: true,
    index: true,
  },
  providerRecordPresent: { type: Boolean, default: false },
  finalized: { type: Boolean, default: false, index: true },
  amounts: { type: BillingAmountsSchema, default: () => ({}) },
  syncedAt: { type: Date, required: true, index: true },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodBillingPeriodSchema.index(
  { bucketSize: 1, startTime: 1 },
  { unique: true, name: 'runpod_billing_bucket_start_1' }
);
RunpodBillingPeriodSchema.index({ startTime: -1 });

module.exports = mongoose.model('runpod_billing_period', RunpodBillingPeriodSchema);
