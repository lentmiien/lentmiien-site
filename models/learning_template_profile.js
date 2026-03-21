const mongoose = require('mongoose');

const learningTemplateProfileSchema = new mongoose.Schema(
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
    slug: {
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
    templateType: {
      type: String,
      enum: ['scene', 'single_choice', 'count_target', 'builder_sequence', 'state_change'],
      required: true,
      index: true,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
      max: 9999,
      index: true,
    },
    defaultItemTitle: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    prompt: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
    helperText: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
    blurb: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
    points: {
      type: Number,
      default: 1,
      min: 0,
      max: 10,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

learningTemplateProfileSchema.index({ templateType: 1, order: 1, title: 1 });

module.exports = mongoose.model('learning_template_profile', learningTemplateProfileSchema);
