const mongoose = require('mongoose');

const calendarEntrySchema = new mongoose.Schema({
  recipeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat4Knowledge',
    required: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const CookingCalendarV2Schema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Please fill a valid date format (YYYY-MM-DD)'],
  },
  entries: {
    type: [calendarEntrySchema],
    default: [],
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CookingCalendarV2', CookingCalendarV2Schema);
