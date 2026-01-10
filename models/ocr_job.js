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

const FileResultSchema = new Schema({
  rawText: { type: String, default: '' },
  layoutText: { type: String, default: '' },
  layoutDirection: { type: String, default: 'horizontal' },
  overlayBoxes: { type: [OverlayBoxSchema], default: [] },
  imagePath: { type: String, default: null },
  originalOverlayBoxes: { type: [OverlayBoxSchema], default: [] },
  originalLayoutText: { type: String, default: '' },
  originalLayoutDirection: { type: String, default: null },
  model: { type: String, default: null },
  promptUsed: { type: String, default: null },
  segmentsCount: { type: Number, default: 0 },
  receivedAt: { type: Date, default: null },
}, { _id: false });

const FileSchema = new Schema({
  id: { type: String, required: true },
  originalname: { type: String, default: null },
  mimetype: { type: String, default: null },
  size: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },
  error: { type: String, default: null },
  previewPath: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
  result: { type: FileResultSchema, default: null },
}, { _id: false });

const OcrJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  prompt: { type: String, required: true },
  maxNewTokens: { type: Number, required: true },
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
  files: { type: [FileSchema], default: [] },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

OcrJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ocr_job', OcrJobSchema);
