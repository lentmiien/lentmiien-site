const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const RequestOptionsSchema = new Schema({
  language: { type: String, default: null },
  task: { type: String, default: 'transcribe' },
  vadFilter: { type: Boolean, default: true },
  beamSize: { type: Number, default: 5 },
  temperature: { type: Number, default: 1.0 },
  wordTimestamps: { type: Boolean, default: false },
}, { _id: false });

const OwnerSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: null },
}, { _id: false });

const AsrJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  sourceType: {
    type: String,
    enum: ['upload', 'recording'],
    default: 'upload',
  },
  originalName: { type: String, default: null },
  storedFileName: { type: String, required: true },
  storedPath: { type: String, required: true },
  publicUrl: { type: String, required: true },
  mimeType: { type: String, default: null },
  sizeBytes: { type: Number, default: 0 },
  requestOptions: { type: RequestOptionsSchema, default: () => ({}) },
  transcriptText: { type: String, default: '' },
  detectedLanguage: { type: String, default: null },
  duration: { type: Number, default: null },
  task: { type: String, default: 'transcribe' },
  model: { type: String, default: null },
  status: {
    type: String,
    enum: ['completed', 'failed'],
    default: 'completed',
  },
  error: { type: String, default: null },
  owner: { type: OwnerSchema, default: () => ({}) },
  embeddingStatus: {
    type: String,
    enum: ['pending', 'stored', 'failed'],
    default: 'pending',
  },
  embeddingError: { type: String, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

AsrJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('asr_job', AsrJobSchema);
