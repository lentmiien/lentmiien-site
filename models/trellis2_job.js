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
  resolution: { type: Number, required: true, enum: [512, 1024, 1536] },
  preprocessImage: { type: Boolean, required: true },
  sparseStructureSteps: { type: Number, required: true, min: 1, max: 50 },
  sparseStructureGuidance: { type: Number, required: true, min: 0, max: 20 },
  shapeSteps: { type: Number, required: true, min: 1, max: 50 },
  shapeGuidance: { type: Number, required: true, min: 0, max: 20 },
  textureSteps: { type: Number, required: true, min: 1, max: 50 },
  textureGuidance: { type: Number, required: true, min: 0, max: 20 },
  decimationTarget: { type: Number, required: true, min: 100000, max: 1000000 },
  textureSize: { type: Number, required: true, enum: [1024, 2048, 4096] },
  remesh: { type: Boolean, required: true },
}, { _id: false });

const MetricsSchema = new Schema({
  generationSeconds: { type: Number, default: null },
  exportSeconds: { type: Number, default: null },
  totalSeconds: { type: Number, default: null },
  peakVramMiB: { type: Number, default: null },
  sourceVertices: { type: Number, default: null },
  sourceFaces: { type: Number, default: null },
  inputMode: { type: String, default: null },
}, { _id: false });

const Trellis2JobSchema = new Schema({
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
  collection: 'trellis2_jobs',
});

Trellis2JobSchema.index({ 'owner.id': 1, createdAt: -1 });
Trellis2JobSchema.index({ shared: 1, createdAt: -1 });
Trellis2JobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Trellis2Job', Trellis2JobSchema);
