const mongoose = require('mongoose');

const RunpodPodBillingPeriodSchema = new mongoose.Schema({
  providerPodId: { type: String, required: true, trim: true, maxlength: 128 },
  podRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_pod',
    default: null,
    index: true,
  },
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
  totalAmount: { type: Number, required: true, min: 0 },
  gpuAmount: { type: Number, required: true, min: 0 },
  cpuAmount: { type: Number, required: true, min: 0 },
  diskAmount: { type: Number, required: true, min: 0 },
  finalized: { type: Boolean, default: false, index: true },
  syncedAt: { type: Date, required: true, index: true },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodPodBillingPeriodSchema.index(
  { providerPodId: 1, bucketSize: 1, startTime: 1 },
  { unique: true, name: 'runpod_pod_billing_pod_bucket_start_1' }
);
RunpodPodBillingPeriodSchema.index({ startTime: -1, providerPodId: 1 });

module.exports = mongoose.model('runpod_pod_billing_period', RunpodPodBillingPeriodSchema);
