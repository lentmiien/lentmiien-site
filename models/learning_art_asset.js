const mongoose = require('mongoose');

const learningArtAssetSchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      trim: true,
      maxlength: 80,
    },
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      maxlength: 120,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
    svgMarkup: {
      type: String,
      required: true,
      maxlength: 100000,
    },
    source: {
      type: String,
      enum: ['upload'],
      default: 'upload',
    },
    createdBy: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
    updatedBy: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
  }
);

learningArtAssetSchema.index({ title: 1, createdAt: -1 });

module.exports = mongoose.model('learning_art_asset', learningArtAssetSchema);
