const mongoose = require('mongoose');

const ActorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '', trim: true, maxlength: 100 },
}, { _id: false });

const ManifestFileSchema = new mongoose.Schema({
  path: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    match: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u,
  },
  sizeBytes: { type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  sha256: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{64}$/u,
  },
}, { _id: false });

const RunpodModelArtifactSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 120,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  sourceKind: {
    type: String,
    enum: ['huggingface'],
    default: 'huggingface',
  },
  sourceRepository: {
    type: String,
    required: true,
    trim: true,
    maxlength: 240,
    match: /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,139}$/u,
  },
  sourceRevision: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{40}$/u,
  },
  sourceLastModifiedAt: { type: Date, default: null },
  variant: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    match: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u,
  },
  runtimeKind: {
    type: String,
    enum: ['llama_cpp'],
    required: true,
  },
  runtimeRepository: {
    type: String,
    required: true,
    trim: true,
    maxlength: 240,
    match: /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,139}$/u,
  },
  runtimeRevision: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-f0-9]{40}$/u,
  },
  networkVolumeRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_network_volume',
    required: true,
    index: true,
  },
  providerNetworkVolumeId: { type: String, required: true, trim: true, maxlength: 128 },
  dataCenterId: { type: String, required: true, trim: true, maxlength: 100 },
  relativeModelPath: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    match: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u,
  },
  relativeRuntimePath: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    match: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u,
  },
  manifest: {
    type: [ManifestFileSchema],
    default: () => [],
    validate: {
      validator: (value) => Array.isArray(value) && value.length <= 32,
      message: 'A model artifact manifest cannot contain more than 32 files.',
    },
  },
  totalBytes: { type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  recommendedVolumeGb: { type: Number, required: true, min: 10, max: 4096 },
  recommendedVramGb: { type: Number, required: true, min: 1, max: 4096 },
  defaultContextTokens: { type: Number, required: true, min: 512, max: 1048576 },
  preparationStatus: {
    type: String,
    enum: ['planned', 'preparing', 'ready', 'failed', 'archived'],
    default: 'planned',
    index: true,
  },
  preparationErrorCode: { type: String, default: null, trim: true, maxlength: 80 },
  preparedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null },
  createdBy: { type: ActorSchema, default: () => ({}) },
  updatedBy: { type: ActorSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodModelArtifactSchema.index(
  { slug: 1, providerNetworkVolumeId: 1 },
  { unique: true, name: 'runpod_model_artifact_slug_volume_1' }
);
RunpodModelArtifactSchema.index(
  { sourceRepository: 1, sourceRevision: 1, variant: 1, providerNetworkVolumeId: 1 },
  { unique: true, name: 'runpod_model_artifact_source_volume_1' }
);
RunpodModelArtifactSchema.index({ preparationStatus: 1, updatedAt: -1 });

module.exports = mongoose.model('runpod_model_artifact', RunpodModelArtifactSchema);
