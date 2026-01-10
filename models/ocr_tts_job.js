const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const OverlayBoxSchema = new Schema({
  text: { type: String, trim: true, default: '' },
  startX: { type: Number, required: true },
  startY: { type: Number, required: true },
  endX: { type: Number, required: true },
  endY: { type: Number, required: true },
  leftPercent: { type: Number, required: true },
  topPercent: { type: Number, required: true },
  widthPercent: { type: Number, required: true },
  heightPercent: { type: Number, required: true },
  id: { type: String, required: true },
}, { _id: false });

const OcrResultSchema = new Schema({
  rawText: { type: String, default: '' },
  layoutText: { type: String, default: '' },
  paragraphText: { type: String, default: '' },
  layoutDirection: { type: String, default: 'horizontal' },
  spaceCount: { type: Number, default: 0 },
  overlayBoxes: { type: [OverlayBoxSchema], default: [] },
  originalOverlayBoxes: { type: [OverlayBoxSchema], default: [] },
  originalLayoutText: { type: String, default: '' },
  originalLayoutDirection: { type: String, default: null },
  model: { type: String, default: null },
  promptUsed: { type: String, default: null },
  segmentsCount: { type: Number, default: 0 },
  receivedAt: { type: Date, default: null },
}, { _id: false });

const ImageSchema = new Schema({
  originalname: { type: String, default: null },
  mimetype: { type: String, default: null },
  size: { type: Number, default: 0 },
  previewPath: { type: String, default: null },
}, { _id: false });

const AudioSchema = new Schema({
  id: { type: String, required: true },
  voice: { type: String, default: 'lennart_jp' },
  format: { type: String, default: 'mp3' },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },
  error: { type: String, default: null },
  fileName: { type: String, default: null },
  filePath: { type: String, default: null },
  sizeBytes: { type: Number, default: 0 },
  maxNewTokens: { type: Number, default: null },
  isDefault: { type: Boolean, default: false },
  autoPlayedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
}, { _id: false });

const OcrTtsJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  group: { type: String, default: null },
  prompt: { type: String, default: null },
  maxNewTokens: { type: Number, default: null },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },
  error: { type: String, default: null },
  owner: {
    id: { type: String, default: null },
    name: { type: String, default: null },
  },
  image: { type: ImageSchema, default: null },
  ocr: { type: OcrResultSchema, default: null },
  audios: { type: [AudioSchema], default: [] },
  embeddingStatus: {
    type: String,
    enum: ['pending', 'stored', 'failed'],
    default: 'pending',
  },
  embeddingError: { type: String, default: null },
  hqEmbeddingStatus: {
    type: String,
    enum: ['idle', 'pending', 'stored', 'failed'],
    default: 'idle',
  },
  hqEmbeddingError: { type: String, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

OcrTtsJobSchema.index({ createdAt: -1 });
OcrTtsJobSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('ocr_tts_job', OcrTtsJobSchema);
