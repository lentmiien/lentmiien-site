const mongoose = require('mongoose');

const learningItemProgressSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'learning_item',
      required: true,
    },
    itemStableId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    templateType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed'],
      default: 'not_started',
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    correctAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    starsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstCompletedAt: {
      type: Date,
      default: null,
    },
    lastCompletedAt: {
      type: Date,
      default: null,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    lastResult: {
      type: String,
      enum: ['none', 'correct', 'incorrect', 'completed'],
      default: 'none',
    },
    lastAnswer: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const learningProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'useraccount',
      required: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
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
    },
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed'],
      default: 'not_started',
      index: true,
    },
    currentItemIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentItemStableId: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    totalStars: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxStars: {
      type: Number,
      default: 0,
      min: 0,
    },
    stickerUnlocked: {
      type: Boolean,
      default: false,
    },
    stickerLabel: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    lastPlayedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    itemStates: {
      type: [learningItemProgressSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

learningProgressSchema.index({ userId: 1, subtopicId: 1 }, { unique: true });
learningProgressSchema.index({ userId: 1, topicId: 1, updatedAt: -1 });

module.exports = mongoose.model('learning_progress', learningProgressSchema);
