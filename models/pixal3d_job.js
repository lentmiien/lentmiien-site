const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const OwnerSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, trim: true },
}, { _id: false });

const InputImageSchema = new Schema({
  fileName: { type: String, required: true },
  publicUrl: { type: String, required: true },
  originalName: { type: String, default: '', maxlength: 255 },
  mimeType: { type: String, required: true },
  format: { type: String, required: true, enum: ['jpeg', 'png', 'webp'] },
  sizeBytes: { type: Number, required: true, min: 1 },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
}, { _id: false });

const OutputModelSchema = new Schema({
  fileName: { type: String, required: true },
  publicUrl: { type: String, required: true },
  mimeType: { type: String, default: 'model/gltf-binary' },
  sizeBytes: { type: Number, required: true, min: 1 },
  glbVersion: { type: Number, default: 2 },
}, { _id: false });

const ParametersSchema = new Schema({
  seed: { type: Number, required: true, min: 0, max: 2147483647 },
  resolution: { type: Number, required: true, enum: [1024, 1536] },
  preprocessImage: { type: Boolean, required: true },
  fovDegrees: {
    type: Number,
    required: true,
    validate: {
      validator: (value) => value === 0 || (value >= 5 && value <= 120),
      message: 'Camera FOV must be 0 or between 5 and 120 degrees.',
    },
  },
  meshScale: { type: Number, required: true, min: 0.25, max: 4 },
  extendPixel: { type: Number, required: true, min: -128, max: 128 },
  sparseStructureSteps: { type: Number, required: true, min: 1, max: 50 },
  sparseStructureGuidance: { type: Number, required: true, min: 0, max: 30 },
  sparseStructureGuidanceRescale: { type: Number, required: true, min: 0, max: 1 },
  shapeSteps: { type: Number, required: true, min: 1, max: 50 },
  shapeGuidance: { type: Number, required: true, min: 0, max: 30 },
  shapeGuidanceRescale: { type: Number, required: true, min: 0, max: 1 },
  textureSteps: { type: Number, required: true, min: 1, max: 50 },
  textureGuidance: { type: Number, required: true, min: 0, max: 30 },
  textureGuidanceRescale: { type: Number, required: true, min: 0, max: 1 },
  maxNumTokens: { type: Number, required: true, min: 8192, max: 100000 },
  decimationTarget: { type: Number, required: true, min: 10000, max: 1000000 },
  textureSize: { type: Number, required: true, enum: [1024, 2048, 4096] },
  dcResolution: { type: Number, required: true, enum: [128, 192, 256] },
  smoothIterations: { type: Number, required: true, min: 0, max: 20 },
  fillHoles: { type: Boolean, required: true },
}, { _id: false });

const MetricsSchema = new Schema({
  generationSeconds: { type: Number, default: null },
  exportSeconds: { type: Number, default: null },
  totalSeconds: { type: Number, default: null },
  actualResolution: { type: Number, default: null },
  cameraSource: { type: String, default: null },
  cameraFovDegrees: { type: Number, default: null },
  cameraDistance: { type: Number, default: null },
  peakAllocatedMiB: { type: Number, default: null },
  peakReservedMiB: { type: Number, default: null },
  sourceVertices: { type: Number, default: null },
  sourceFaces: { type: Number, default: null },
  inputMode: { type: String, default: null },
  workerRecycle: { type: Boolean, default: null },
}, { _id: false });

const Pixal3dJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  owner: { type: OwnerSchema, required: true },
  shared: { type: Boolean, default: false, index: true },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  error: { type: String, default: null, maxlength: 1000 },
  inputImage: { type: InputImageSchema, required: true },
  outputModel: { type: OutputModelSchema, default: null },
  parameters: { type: ParametersSchema, required: true },
  gatewayJobId: { type: String, default: null, index: true },
  gatewayStatus: { type: String, default: null },
  metrics: { type: MetricsSchema, default: () => ({}) },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'pixal3d_jobs',
});

Pixal3dJobSchema.index({ 'owner.id': 1, createdAt: -1 });
Pixal3dJobSchema.index({ shared: 1, createdAt: -1 });
Pixal3dJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Pixal3dJob', Pixal3dJobSchema);
