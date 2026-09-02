const mongoose = require('mongoose');

const ActorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '', trim: true, maxlength: 100 },
}, { _id: false });

const RunpodWorkloadTemplateSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 80,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  providerTemplateId: { type: String, default: null, trim: true, maxlength: 128 },
  providerTemplateName: { type: String, required: true, trim: true, maxlength: 120 },
  providerSyncStatus: {
    type: String,
    enum: ['pending', 'synced', 'failed'],
    default: 'pending',
    index: true,
  },
  providerSyncErrorCode: { type: String, default: null, trim: true, maxlength: 80 },
  providerSyncedAt: { type: Date, default: null },
  image: { type: String, required: true, trim: true, maxlength: 500 },
  args: { type: String, default: '', maxlength: 4000 },
  diskGb: { type: Number, required: true, min: 5, max: 500 },
  ports: [{ type: String, trim: true, maxlength: 40 }],
  env: {
    type: Map,
    of: String,
    default: () => ({}),
  },
  persistentDiskGb: { type: Number, required: true, min: 10, max: 1000 },
  persistentPath: { type: String, required: true, trim: true, maxlength: 300 },
  startSsh: { type: Boolean, default: false },
  startJupyter: { type: Boolean, default: false },
  setupKind: {
    type: String,
    enum: ['ollama_pull', 'ollama_download'],
    required: true,
  },
  defaultModel: { type: String, required: true, trim: true, maxlength: 120 },
  servicePort: { type: Number, required: true, min: 1, max: 65535 },
  healthPath: { type: String, required: true, trim: true, maxlength: 200 },
  accessMode: {
    type: String,
    enum: ['runpod_proxy', 'cloudflare_access'],
    default: 'runpod_proxy',
    index: true,
  },
  gatewayUrl: { type: String, default: null, trim: true, maxlength: 500 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: ActorSchema, default: () => ({}) },
  updatedBy: { type: ActorSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodWorkloadTemplateSchema.index({ slug: 1 }, { unique: true, name: 'runpod_template_slug_1' });
RunpodWorkloadTemplateSchema.index(
  { providerTemplateId: 1 },
  {
    unique: true,
    name: 'runpod_provider_template_id_1',
    partialFilterExpression: { providerTemplateId: { $type: 'string' } },
  }
);
RunpodWorkloadTemplateSchema.index({ active: 1, name: 1 });

module.exports = mongoose.model('runpod_workload_template', RunpodWorkloadTemplateSchema);
