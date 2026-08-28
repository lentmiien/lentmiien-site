const mongoose = require('mongoose');

const { Schema } = mongoose;

const ModularLlmModelProfileSchema = new Schema({
  serviceId: {
    type: String,
    required: true,
    default: 'modular_llm',
    trim: true,
    maxlength: 100,
    index: true,
  },
  bundleId: { type: String, required: true, trim: true, maxlength: 200, index: true },
  bundleDescription: { type: String, default: '', maxlength: 2000 },
  stage: { type: String, required: true, trim: true, maxlength: 100 },
  displayName: { type: String, default: '', trim: true, maxlength: 200 },
  modelId: { type: String, required: true, trim: true, maxlength: 500 },
  revision: { type: String, default: '', trim: true, maxlength: 200 },
  runtimeMode: { type: String, default: '', trim: true, maxlength: 100 },
  cirVersion: { type: String, default: '', trim: true, maxlength: 100 },
  airVersion: { type: String, default: '', trim: true, maxlength: 100 },
  dtype: { type: String, default: '', trim: true, maxlength: 100 },
  attention: { type: String, default: '', trim: true, maxlength: 100 },
  cacheDir: { type: String, default: '', maxlength: 2000 },
  localPath: { type: String, default: '', maxlength: 4000 },
  adapterPath: { type: String, default: '', maxlength: 4000 },
  maxInputTokens: { type: Number, default: null, min: 1 },
  maxNewTokens: { type: Number, default: null, min: 1 },
  temperature: { type: Number, default: null, min: 0 },
  topP: { type: Number, default: null, min: 0, max: 1 },
  topK: { type: Number, default: null, min: 0 },
  useCases: {
    type: [{ type: String, trim: true, maxlength: 100 }],
    default: [],
  },
  notes: { type: String, default: '', maxlength: 5000 },
  enabledForTesting: { type: Boolean, default: true, index: true },
  available: { type: Boolean, default: true, index: true },
  firstSeenAt: { type: Date, required: true, default: Date.now },
  lastSeenAt: { type: Date, required: true, default: Date.now },
  updatedBy: { type: String, default: '', trim: true, maxlength: 100 },
  gatewayConfig: { type: Schema.Types.Mixed, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'modular_llm_model_profiles',
});

ModularLlmModelProfileSchema.index(
  { serviceId: 1, bundleId: 1, stage: 1 },
  { unique: true },
);
ModularLlmModelProfileSchema.index({ available: -1, bundleId: 1, stage: 1 });

module.exports = mongoose.model('ModularLlmModelProfile', ModularLlmModelProfileSchema);
