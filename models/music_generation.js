const mongoose = require('mongoose');

const MusicGenerationSchema = new mongoose.Schema({
  jobId: { type: String, index: true },
  outputPath: { type: String, required: true, unique: true },
  outputName: { type: String },
  outputSizeBytes: { type: Number },
  outputModifiedAt: { type: Date },
  caption: { type: String },
  lyrics: { type: String },
  instrumental: { type: Boolean, default: false },
  bpm: { type: Number },
  vocalLanguage: { type: String },
  durationSec: { type: Number },
  promptSource: { type: String, enum: ['manual', 'ai'], default: 'manual' },
  aiPromptInput: { type: String },
  rating: { type: Number, min: 1, max: 5, default: null },
  ratingAt: { type: Date },
  lastPlayedAt: { type: Date },
}, { timestamps: true });

MusicGenerationSchema.index({ rating: -1, createdAt: -1 });
MusicGenerationSchema.index({ lastPlayedAt: 1 });

module.exports = mongoose.model('MusicGeneration', MusicGenerationSchema);
