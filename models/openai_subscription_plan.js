const mongoose = require('mongoose');

const OpenAISubscriptionPlanSchema = new mongoose.Schema({
  planName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
  },
  monthlyCost: {
    type: Number,
    required: true,
    min: 0,
  },
  startDate: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
    index: true,
  },
}, {
  timestamps: true,
});

OpenAISubscriptionPlanSchema.index({ startDate: 1 }, { unique: true });

module.exports = mongoose.model('openai_subscription_plan', OpenAISubscriptionPlanSchema);
