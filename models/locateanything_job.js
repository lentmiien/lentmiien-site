const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const OwnerSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: null },
}, { _id: false });

const RequestOptionsSchema = new Schema({
  task: {
    type: String,
    enum: ['detect_text', 'detect', 'ground', 'ground_single', 'ground_text', 'ground_gui', 'point'],
    default: 'ground_gui',
  },
  query: { type: String, default: '' },
  categories: { type: [String], default: [] },
  outputType: {
    type: String,
    enum: ['box', 'point'],
    default: 'point',
  },
  generationMode: {
    type: String,
    enum: ['fast', 'hybrid', 'slow'],
    default: 'hybrid',
  },
  maxImageEdge: { type: Number, default: 1280 },
  maxNewTokens: { type: Number, default: 256 },
  doSample: { type: Boolean, default: false },
  temperature: { type: Number, default: 0 },
  topP: { type: Number, default: 0.9 },
  repetitionPenalty: { type: Number, default: 1.1 },
}, { _id: false });

const LocateAnythingFileSchema = new Schema({
  id: { type: String, default: () => randomUUID(), required: true },
  originalName: { type: String, default: null },
  storedFileName: { type: String, required: true },
  storedPath: { type: String, required: true },
  publicUrl: { type: String, required: true },
  mimeType: { type: String, default: null },
  sizeBytes: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },
  error: { type: String, default: null },
  gatewayStatusCode: { type: Number, default: null },
  rawOutput: { type: Schema.Types.Mixed, default: null },
  rawErrorOutput: { type: Schema.Types.Mixed, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { _id: false });

const LocateAnythingJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  source: { type: String, default: 'admin_test' },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'partial_failed', 'failed'],
    default: 'queued',
  },
  error: { type: String, default: null },
  gatewayBaseUrl: { type: String, default: null },
  gatewayPath: { type: String, default: '/image/locateanything/file' },
  requestOptions: { type: RequestOptionsSchema, default: () => ({}) },
  owner: { type: OwnerSchema, default: () => ({}) },
  files: { type: [LocateAnythingFileSchema], default: [] },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

LocateAnythingJobSchema.index({ createdAt: -1 });
LocateAnythingJobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('locateanything_job', LocateAnythingJobSchema);
