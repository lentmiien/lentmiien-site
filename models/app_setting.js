const mongoose = require('mongoose');

const AppSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 160,
    match: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  },
  value: {
    type: String,
    required: true,
    trim: true,
    maxlength: 10000,
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1000,
  },
  createdBy: {
    type: String,
    default: 'system',
    trim: true,
    maxlength: 100,
  },
  updatedBy: {
    type: String,
    default: 'system',
    trim: true,
    maxlength: 100,
  },
}, {
  timestamps: true,
  collection: 'app_settings',
});

module.exports = mongoose.model('AppSetting', AppSettingSchema);
