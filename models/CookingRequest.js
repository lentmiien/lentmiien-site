const mongoose = require('mongoose');

const CookingRequestSchema = new mongoose.Schema({
  requestDate: {
    type: String, 
    required: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Please fill a valid date format (YYYY-MM-DD)'],
  },
  requesterName: { 
    type: String,
    required: true,
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

module.exports = mongoose.model('CookingRequest', CookingRequestSchema);