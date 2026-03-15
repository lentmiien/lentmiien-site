const mongoose = require('mongoose');

const learningAttemptSchema = new mongoose.Schema(
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
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'learning_item',
      required: true,
      index: true,
    },
    itemStableId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    templateType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    attemptType: {
      type: String,
      enum: ['answer', 'activity'],
      default: 'answer',
    },
    answer: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isCorrect: {
      type: Boolean,
      default: null,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    starsAwarded: {
      type: Number,
      default: 0,
      min: 0,
    },
    feedbackMessage: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
  },
  {
    timestamps: true,
  }
);

learningAttemptSchema.index({ userId: 1, subtopicId: 1, createdAt: -1 });
learningAttemptSchema.index({ itemStableId: 1, createdAt: -1 });

module.exports = mongoose.model('learning_attempt', learningAttemptSchema);
