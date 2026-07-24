const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const OwnerSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, trim: true },
}, { _id: false });

const PromptTo3dJobSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  owner: { type: OwnerSchema, required: true },
  activeKey: { type: String },
  status: {
    type: String,
    enum: ['queued', 'generating_image', 'generating_model', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  prompt: { type: String, required: true, maxlength: 32000 },
  imageOptions: { type: Schema.Types.Mixed, required: true },
  pixal3dParameters: { type: Schema.Types.Mixed, required: true },
  gptImageGenerationId: { type: String, default: null, index: true },
  gptImageId: { type: String, default: null },
  imageUrl: { type: String, default: null },
  pixal3dJobId: { type: String, default: null, index: true },
  error: { type: String, default: null, maxlength: 1000 },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'prompt_to_3d_jobs',
});

PromptTo3dJobSchema.index(
  { activeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeKey: { $type: 'string' } },
  },
);
PromptTo3dJobSchema.index({ 'owner.id': 1, createdAt: -1 });
PromptTo3dJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PromptTo3dJob', PromptTo3dJobSchema);
