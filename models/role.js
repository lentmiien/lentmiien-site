const mongoose = require('mongoose');

const Role = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  permissions: [{ type: String, required: true }],
  type: { type: String, enum: ['group', 'user'] } // Distinguishes between a group role and a specific user role
});

module.exports = mongoose.model('role', Role);
