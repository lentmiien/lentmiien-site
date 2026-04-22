const mongoose = require('mongoose');

const inputImageSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  url: { type: String, required: true },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  sizeBytes: { type: Number, default: 0 },
  sourceType: {
    type: String,
    enum: ['upload', 'gallery'],
    required: true,
  },
  sourceImageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GptImageGeneration',
    default: null,
  },
  sourceGenerationId: { type: String, default: null },
}, { _id: false });

const gptImageGenerationSchema = new mongoose.Schema({
  generationId: { type: String, required: true, index: true },
  outputIndex: { type: Number, required: true },
  createdBy: { type: String, required: true, index: true },
  model: { type: String, required: true, default: 'gpt-image-2' },
  requestType: {
    type: String,
    enum: ['generate', 'edit'],
    required: true,
  },
  prompt: { type: String, required: true, maxlength: 32000 },
  promptKeywords: [{ type: String }],
  revisedPrompt: { type: String, default: '' },
  inputImages: { type: [inputImageSchema], default: [] },
  outputFileName: { type: String, required: true, unique: true },
  outputUrl: { type: String, required: true },
  outputMimeType: { type: String, required: true },
  outputSizeBytes: { type: Number, required: true },
  requestedSize: { type: String, required: true },
  resolvedSize: { type: String, default: '' },
  quality: { type: String, required: true },
  background: { type: String, required: true },
  outputFormat: { type: String, required: true },
  outputCompression: { type: Number, default: null },
  moderation: { type: String, required: true },
  requestedCount: { type: Number, required: true },
  likeCount: { type: Number, default: 0 },
  likedByUsers: { type: [String], default: [] },
  openaiCreatedAt: { type: Date, default: null },
  openaiUsage: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
  collection: 'gpt_image_generations',
});

gptImageGenerationSchema.index({ generationId: 1, outputIndex: 1 }, { unique: true });
gptImageGenerationSchema.index({ createdAt: -1 });
gptImageGenerationSchema.index({ promptKeywords: 1 });
gptImageGenerationSchema.index({ likedByUsers: 1, createdAt: -1 });

module.exports = mongoose.model('GptImageGeneration', gptImageGenerationSchema);
