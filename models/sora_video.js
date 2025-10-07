const mongoose = require('mongoose');

const SoraVideoSchema = new mongoose.Schema({
  openaiId: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  filename: {
    type: String,
    default: '',
  },
  prompt: {
    type: String,
    required: true,
    trim: true,
  },
  model: {
    type: String,
    required: true,
    trim: true,
  },
  seconds: {
    type: Number,
    required: true,
    min: 1,
  },
  size: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    default: '',
    trim: true,
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 3,
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  status: {
    type: String,
    enum: ['queued', 'in_progress', 'completed', 'failed', 'cancelled'],
    default: 'queued',
  },
  errorMessage: {
    type: String,
    default: '',
    trim: true,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SoraVideo', SoraVideoSchema);
