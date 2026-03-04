const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    importance: {
      type: Number,
      default: 3,
      min: 1,
      max: 5,
    },
  },
  {
    timestamps: true,
  }
);

bookmarkSchema.index({ user: 1, importance: -1, updatedAt: -1 });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
