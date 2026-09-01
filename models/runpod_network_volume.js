const mongoose = require('mongoose');

const ActorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '', trim: true, maxlength: 100 },
}, { _id: false });

const OperationErrorSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['create', 'sync', 'delete'],
    required: true,
  },
  code: { type: String, required: true, trim: true, maxlength: 80 },
  providerCode: { type: String, default: null, trim: true, maxlength: 120 },
  providerStatus: { type: Number, default: null, min: 100, max: 599 },
  providerTitle: { type: String, default: null, trim: true, maxlength: 240 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  detail: { type: String, default: null, trim: true, maxlength: 1000 },
  occurredAt: { type: Date, required: true },
}, { _id: false });

const RunpodNetworkVolumeSchema = new mongoose.Schema({
  providerNetworkVolumeId: { type: String, required: true, trim: true, maxlength: 128 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  recordOrigin: {
    type: String,
    enum: ['managed', 'provider_import'],
    default: 'managed',
    index: true,
  },
  dataCenterId: { type: String, required: true, trim: true, maxlength: 100 },
  volumeType: {
    type: String,
    enum: ['STANDARD', 'HIGH_PERFORMANCE', 'UNKNOWN'],
    default: 'UNKNOWN',
  },
  sizeGb: { type: Number, required: true, min: 10, max: 4096 },
  lifecycleGroup: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  },
  providerPresent: { type: Boolean, default: true, index: true },
  estimatedMonthlyCostUsd: { type: Number, default: null, min: 0 },
  cachedModels: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 120,
  }],
  modelsUpdatedAt: { type: Date, default: null },
  lastProviderSyncAt: { type: Date, default: null },
  lastOperationError: { type: OperationErrorSchema, default: null },
  archivedAt: { type: Date, default: null },
  createdBy: { type: ActorSchema, default: () => ({}) },
  updatedBy: { type: ActorSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodNetworkVolumeSchema.index(
  { providerNetworkVolumeId: 1 },
  { unique: true, name: 'runpod_provider_network_volume_id_1' }
);
RunpodNetworkVolumeSchema.index({ lifecycleGroup: 1, updatedAt: -1 });
RunpodNetworkVolumeSchema.index({ dataCenterId: 1, lifecycleGroup: 1 });

module.exports = mongoose.model('runpod_network_volume', RunpodNetworkVolumeSchema);
