const mongoose = require('mongoose');
const { rewardSchema, themeSchema } = require('./learning_shared');

const learningSubtopicSchema = new mongoose.Schema(
  {
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'learning_topic',
      required: true,
      index: true,
    },
    topicStableId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    topicSlug: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
    },
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
      min: 0,
      max: 9999,
      index: true,
    },
    estimatedMinutes: {
      type: Number,
      default: 3,
      min: 1,
      max: 120,
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

learningSubtopicSchema.index({ topicId: 1, slug: 1 }, { unique: true });
learningSubtopicSchema.index({ topicId: 1, status: 1, order: 1, title: 1 });

module.exports = mongoose.model('learning_subtopic', learningSubtopicSchema);
