const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const AudioWorkflowTriggerSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  enabled: { type: Boolean, default: true, index: true },
  shouldInclude: { type: [String], default: [] },
  shouldNotInclude: { type: [String], default: [] },
  systemPrompt: { type: String, default: '' },
  messagePrompt: { type: String, default: '{{transcript}}' },
  llmModel: { type: String, default: 'gpt-5.5' },
  reasoning: { type: String, enum: ['minimal', 'low', 'medium', 'high', 'xhigh'], default: 'medium' },
  verbosity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  outputFormat: { type: String, enum: ['text', 'json'], default: 'text' },
  tools: { type: [String], default: [] },
  ttsEnabled: { type: Boolean, default: true },
  ttsVoiceId: { type: String, default: 'piper_en_amy' },
  ttsFormat: { type: String, default: 'wav' },
  sortOrder: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
});

AudioWorkflowTriggerSchema.index({ enabled: 1, sortOrder: 1, createdAt: 1 });

module.exports = mongoose.model('audio_workflow_trigger', AudioWorkflowTriggerSchema);
