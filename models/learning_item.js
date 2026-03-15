const mongoose = require('mongoose');

const learningItemSchema = new mongoose.Schema(
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
    subtopicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'learning_subtopic',
      required: true,
      index: true,
    },
    subtopicStableId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    subtopicSlug: {
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
    title: {
      type: String,
      required: true,
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
    kind: {
      type: String,
      enum: ['activity', 'question'],
      default: 'question',
      index: true,
    },
    templateType: {
      type: String,
      enum: ['scene', 'single_choice', 'count_target', 'builder_sequence', 'state_change'],
      required: true,
      index: true,
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

learningItemSchema.index({ subtopicId: 1, stableId: 1 }, { unique: true });
learningItemSchema.index({ subtopicId: 1, status: 1, order: 1, title: 1 });

module.exports = mongoose.model('learning_item', learningItemSchema);
