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
  requestedDishes: {
    type: Map,
    of: String,
  }
});

module.exports = mongoose.model('CookingRequest', CookingRequestSchema);