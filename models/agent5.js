const mongoose = require('mongoose');
const Agent5BehaviorSchema = require('./agent5_behavior_schema');

const Agent5Schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  checkIntervalMinutes: { type: Number, default: 30, min: 1 },
  isActive: { type: Boolean, default: true },
  defaultBehavior: { type: Agent5BehaviorSchema, required: true },
  lastRunAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('agent5', Agent5Schema);
