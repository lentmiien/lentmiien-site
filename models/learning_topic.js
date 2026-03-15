const mongoose = require('mongoose');
const { rewardSchema, themeSchema } = require('./learning_shared');

const learningTopicSchema = new mongoose.Schema(
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
    shortLabel: {
      type: String,
      default: '',
      trim: true,
      maxlength: 60,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true,
    },
    order: {
      type: Number,
      default: 0,
      index: true,
      min: 0,
      max: 9999,
    },
    theme: {
      type: themeSchema,
      default: () => ({}),
    },
    reward: {
      type: rewardSchema,
      default: () => ({}),
    },
    metadata: {
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

learningTopicSchema.index({ status: 1, order: 1, title: 1 });

module.exports = mongoose.model('learning_topic', learningTopicSchema);
