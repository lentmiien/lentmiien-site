const mongoose = require('mongoose');

const AccountingBusinessMappingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  normalizedName: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  groupName: {
    type: String,
    required: true,
    trim: true,
    default: 'Other',
    index: true,
  },
  sources: [{
    type: String,
    enum: ['budget', 'credit_card'],
  }],
  lastSeenAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

AccountingBusinessMappingSchema.index({ groupName: 1, name: 1 });

module.exports = mongoose.model('accounting_business_mapping', AccountingBusinessMappingSchema);
