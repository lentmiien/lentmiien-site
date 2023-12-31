const mongoose = require('mongoose');

const CookingCalendarSchema = new mongoose.Schema({
  date: { 
    type: String, 
    required: true,
    unique: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Please fill a valid date format (YYYY-MM-DD)'],
  },
  dinnerToCook: { 
    type: String,
    default: null,
  },
  lunchToCook: { 
    type: String,
    default: null,
  },
  dessertToCook: { 
    type: String,
    default: null,
  }
});

module.exports = mongoose.model('CookingCalendar', CookingCalendarSchema);