const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const OwnerSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: null },
}, { _id: false });

const UploadedAudioSchema = new Schema({
  originalName: { type: String, default: null },
  storedFileName: { type: String, required: true },
  storedPath: { type: String, required: true },
  publicUrl: { type: String, required: true },
  mimeType: { type: String, default: null },
  sizeBytes: { type: Number, default: 0 },
}, { _id: false });

const OutputAudioSchema = new Schema({
  id: { type: String, default: null, index: true },
  fileName: { type: String, default: null },
  filePath: { type: String, default: null },
  mimeType: { type: String, default: null },
  voiceId: { type: String, default: null },
  format: { type: String, default: null },
  sizeBytes: { type: Number, default: 0 },
}, { _id: false });

const LlmSchema = new Schema({
  responseIds: { type: [String], default: [] },
  finalMessageId: { type: String, default: null },
  outputText: { type: String, default: '' },
  error: { type: String, default: null },
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

const ManualQualityRatedBySchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: null },
}, { _id: false });

const AudioWorkflowJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  status: {
    type: String,
    enum: [
      'queued',
      'processing_asr',
      'waiting_for_llm',
      'processing_tts',
      'completed',
      'failed',
    ],
    default: 'queued',
    index: true,
  },
  error: { type: String, default: null },
  deviceId: { type: String, default: null },
  sampleRate: { type: Number, default: null },
  channels: { type: Number, default: null },
  format: { type: String, default: null },
  owner: { type: OwnerSchema, default: () => ({}) },
  inputAudio: { type: UploadedAudioSchema, required: true },
  transcribeWorkId: { type: String, default: null, index: true },
  asrJobId: { type: String, default: null, index: true },
  transcriptText: { type: String, default: '' },
  detectedLanguage: { type: String, default: null },
  duration: { type: Number, default: null },
  asrSegments: { type: [AsrSegmentSchema], default: [] },
  asrQuality: { type: AsrQualitySchema, default: () => ({}) },
  possibleGarbage: { type: Boolean, default: false, index: true },
  manualQualityRating: {
    type: String,
    enum: ['unrated', 'ok', 'garbage'],
    default: 'unrated',
    index: true,
  },
  manualQualityRatedAt: { type: Date, default: null },
  manualQualityRatedBy: { type: ManualQualityRatedBySchema, default: () => ({}) },
  matchedTriggerId: { type: String, default: null, index: true },
  matchedTriggerName: { type: String, default: null },
  conversation5Id: { type: String, default: null, index: true },
  llm: { type: LlmSchema, default: () => ({}) },
  ttsId: { type: String, default: null, index: true },
  outputAudio: { type: OutputAudioSchema, default: () => ({}) },
  queuedAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

AudioWorkflowJobSchema.index({ createdAt: -1 });
AudioWorkflowJobSchema.index({ status: 1, createdAt: 1 });
AudioWorkflowJobSchema.index({ 'llm.responseIds': 1 });

module.exports = mongoose.model('audio_workflow_job', AudioWorkflowJobSchema);
