const mongoose = require('mongoose');

const ActorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '', trim: true, maxlength: 100 },
}, { _id: false });

const OperationErrorSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['start', 'stop', 'extend', 'reconfigure', 'delete', 'auto_stop'],
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

const RunpodPodSchema = new mongoose.Schema({
  providerPodId: { type: String, default: null, trim: true, maxlength: 128 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  recordOrigin: {
    type: String,
    enum: ['managed', 'provider_import', 'billing_history'],
    default: 'managed',
    index: true,
  },
  podPurpose: {
    type: String,
    enum: ['ollama_service', 'llama_cpp_service', 'model_download', 'model_artifact_prepare'],
    default: 'ollama_service',
    index: true,
  },
  workloadTemplateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_workload_template',
    default: null,
    index: true,
  },
  modelArtifactRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_model_artifact',
    default: null,
    index: true,
  },
  providerTemplateId: { type: String, default: null, trim: true, maxlength: 128 },
  providerStatus: {
    type: String,
    enum: ['REQUESTED', 'PROVISIONING', 'STARTING', 'RUNNING', 'EXITED', 'ERROR', 'TERMINATED', 'UNKNOWN'],
    default: 'REQUESTED',
    index: true,
  },
  lifecycleGroup: {
    type: String,
    enum: ['running', 'stopped', 'archived'],
    default: 'running',
    index: true,
  },
  validActions: [{
    type: String,
    enum: ['start', 'stop', 'restart', 'terminate'],
  }],
  setupStatus: {
    type: String,
    enum: ['pending', 'waiting', 'downloading', 'ready', 'failed', 'not_applicable'],
    default: 'pending',
    index: true,
  },
  setupErrorCode: { type: String, default: null, trim: true, maxlength: 80 },
  setupModel: { type: String, default: '', trim: true, maxlength: 120 },
  contextTokens: { type: Number, default: null, min: 2048, max: 262144 },
  setupStartedAt: { type: Date, default: null },
  setupCompletedAt: { type: Date, default: null },
  autoDeleteAfterSetup: { type: Boolean, default: false },
  cleanupStatus: {
    type: String,
    enum: ['not_required', 'pending', 'completed', 'failed'],
    default: 'not_required',
    index: true,
  },
  cleanupErrorCode: { type: String, default: null, trim: true, maxlength: 80 },
  accessMode: {
    type: String,
    enum: ['runpod_proxy', 'cloudflare_access', 'private_none'],
    default: 'runpod_proxy',
    index: true,
  },
  publicUrl: { type: String, default: null, trim: true, maxlength: 500 },
  cloud: { type: String, enum: ['SECURE', 'COMMUNITY', 'UNKNOWN'], default: 'UNKNOWN' },
  dataCenterId: { type: String, default: null, trim: true, maxlength: 100 },
  gpu: {
    id: { type: String, required: true, trim: true, maxlength: 240 },
    name: { type: String, default: '', trim: true, maxlength: 240 },
    memoryGb: { type: Number, default: null, min: 0 },
    count: { type: Number, required: true, min: 1, max: 32 },
    catalogPricePerHour: { type: Number, default: null, min: 0 },
  },
  diskGb: { type: Number, default: null, min: 1, max: 1000 },
  persistentDiskGb: { type: Number, default: null, min: 10, max: 1000 },
  persistentPath: { type: String, default: '', trim: true, maxlength: 300 },
  networkVolumeRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_network_volume',
    default: null,
    index: true,
  },
  providerNetworkVolumeId: { type: String, default: null, trim: true, maxlength: 128 },
  networkVolumeName: { type: String, default: '', trim: true, maxlength: 120 },
  networkVolumeType: {
    type: String,
    enum: ['STANDARD', 'HIGH_PERFORMANCE', 'UNKNOWN', ''],
    default: '',
  },
  networkVolumeSizeGb: { type: Number, default: null, min: 10, max: 4096 },
  networkVolumeMountPath: { type: String, default: '', trim: true, maxlength: 300 },
  ports: [{ type: String, trim: true, maxlength: 40 }],
  estimatedCostPerHour: { type: Number, default: null, min: 0 },
  providerCostPerHour: { type: Number, default: null, min: 0 },
  maxHourlyCostAcknowledged: { type: Number, default: null, min: 0 },
  autoStopMinutes: { type: Number, default: null, min: 15, max: 10080 },
  autoStopAt: { type: Date, default: null, index: true },
  autoStopClaimedAt: { type: Date, default: null },
  lastOperationError: { type: OperationErrorSchema, default: null },
  providerCreatedAt: { type: Date, default: null },
  providerStartedAt: { type: Date, default: null },
  lastProviderSyncAt: { type: Date, default: null },
  lastActionAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null },
  usageTrackingMode: {
    type: String,
    enum: ['observed', 'billing_only'],
    default: 'observed',
  },
  usageState: {
    type: String,
    enum: ['running', 'stopped', 'archived', 'unknown'],
    default: 'unknown',
    index: true,
  },
  usageTrackedSinceAt: { type: Date, default: null },
  usageStateEnteredAt: { type: Date, default: null },
  usageLastObservedAt: { type: Date, default: null },
  runningMs: { type: Number, default: 0, min: 0 },
  stoppedMs: { type: Number, default: 0, min: 0 },
  lastRunningCostPerHour: { type: Number, default: null, min: 0 },
  storageRates: {
    containerRunningUsdPerGbMonth: { type: Number, default: 0.10, min: 0 },
    volumeRunningUsdPerGbMonth: { type: Number, default: 0.10, min: 0 },
    volumeStoppedUsdPerGbMonth: { type: Number, default: 0.20, min: 0 },
    hoursPerMonth: { type: Number, default: 730, min: 1 },
  },
  billingTotalUsd: { type: Number, default: 0, min: 0 },
  billingComputeUsd: { type: Number, default: 0, min: 0 },
  billingStorageUsd: { type: Number, default: 0, min: 0 },
  billingFirstPeriodAt: { type: Date, default: null },
  billingLastPeriodEndAt: { type: Date, default: null },
  billingSyncedAt: { type: Date, default: null, index: true },
  createdBy: { type: ActorSchema, default: () => ({}) },
  updatedBy: { type: ActorSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodPodSchema.index(
  { providerPodId: 1 },
  {
    unique: true,
    name: 'runpod_provider_pod_id_1',
    partialFilterExpression: { providerPodId: { $type: 'string' } },
  }
);
RunpodPodSchema.index({ lifecycleGroup: 1, updatedAt: -1 });
RunpodPodSchema.index({ setupStatus: 1, updatedAt: -1 });
RunpodPodSchema.index({ autoStopAt: 1, lifecycleGroup: 1 });
RunpodPodSchema.index({ providerNetworkVolumeId: 1, lifecycleGroup: 1 });
RunpodPodSchema.index({ podPurpose: 1, createdAt: -1 });

module.exports = mongoose.model('runpod_pod', RunpodPodSchema);
