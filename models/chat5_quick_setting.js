const mongoose = require('mongoose');

const { Schema } = mongoose;

const ContextOverrideSchema = new Schema({
  source: {
    type: String,
    required: true,
    enum: ['text', 'template'],
  },
  text: {
    type: String,
    default: '',
  },
  templateId: {
    type: String,
    default: null,
  },
}, { _id: false });

const QuickSettingOverridesSchema = new Schema({
  category: {
    type: String,
    trim: true,
    maxlength: 100,
    default: undefined,
  },
  tags: {
    type: [{ type: String, trim: true, maxlength: 100 }],
    default: undefined,
  },
  context: {
    type: ContextOverrideSchema,
    default: undefined,
  },
  tools: {
    type: [{ type: String, trim: true, maxlength: 100 }],
    default: undefined,
  },
  model: {
    type: String,
    trim: true,
    maxlength: 255,
    default: undefined,
  },
  maxMessages: {
    type: Number,
    min: 1,
    default: undefined,
  },
  reasoning: {
    type: String,
    enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    default: undefined,
  },
  mode: {
    type: String,
    enum: ['standard', 'pro'],
    default: undefined,
  },
  verbosity: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: undefined,
  },
  members: {
    type: [{ type: String, trim: true, maxlength: 100 }],
    default: undefined,
  },
}, { _id: false });

const Chat5QuickSettingSchema = new Schema({
  user: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  overrides: {
    type: QuickSettingOverridesSchema,
    required: true,
    default: () => ({}),
  },
}, {
  timestamps: true,
  versionKey: false,
});

Chat5QuickSettingSchema.index({ user: 1, name: 1 }, { unique: true });
Chat5QuickSettingSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('chat5_quick_setting', Chat5QuickSettingSchema);
