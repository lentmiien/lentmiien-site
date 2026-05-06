const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const RequestOptionsSchema = new Schema({
  model: { type: String, default: 'whisper-api' },
  language: { type: String, default: null },
  task: { type: String, default: 'transcribe' },
  vadFilter: { type: Boolean, default: true },
  beamSize: { type: Number, default: 5 },
  temperature: { type: Number, default: 1.0 },
  wordTimestamps: { type: Boolean, default: false },
  samplingRate: { type: Number, default: null },
  maxNewTokens: { type: Number, default: null },
  hotwords: { type: String, default: null },
  context: { type: String, default: null },
}, { _id: false });

const OwnerSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: null },
}, { _id: false });

const AsrSegmentSchema = new Schema({
  id: { type: Number, default: 0 },
  start: { type: Number, default: null },
  end: { type: Number, default: null },
  text: { type: String, default: '' },
  avgLogprob: { type: Number, default: null },
  noSpeechProb: { type: Number, default: null },
  compressionRatio: { type: Number, default: null },
}, { _id: false });

const AsrQualityThresholdsSchema = new Schema({
  avgLogprobMin: { type: Number, default: null },
  noSpeechProbMax: { type: Number, default: null },
  compressionRatioMax: { type: Number, default: null },
}, { _id: false });

const AsrQualitySchema = new Schema({
  segmentCount: { type: Number, default: 0 },
  avgLogprob: { type: Number, default: null },
  minAvgLogprob: { type: Number, default: null },
  noSpeechProb: { type: Number, default: null },
  maxNoSpeechProb: { type: Number, default: null },
  compressionRatio: { type: Number, default: null },
  maxCompressionRatio: { type: Number, default: null },
  possibleGarbage: { type: Boolean, default: false },
  garbageReasons: { type: [String], default: [] },
  thresholds: { type: AsrQualityThresholdsSchema, default: () => ({}) },
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
  segments: { type: [AsrSegmentSchema], default: [] },
  quality: { type: AsrQualitySchema, default: () => ({}) },
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
