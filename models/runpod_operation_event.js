const mongoose = require('mongoose');

const ActorSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '', trim: true, maxlength: 100 },
}, { _id: false });

const RunpodOperationEventSchema = new mongoose.Schema({
  resourceType: {
    type: String,
    enum: ['pod', 'template', 'billing'],
    required: true,
    index: true,
  },
  podRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_pod',
    default: null,
    index: true,
  },
  templateRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'runpod_workload_template',
    default: null,
    index: true,
  },
  action: {
    type: String,
    enum: ['create', 'sync', 'setup', 'start', 'stop', 'delete', 'auto_stop', 'template_sync', 'billing_sync'],
    required: true,
    index: true,
  },
  outcome: {
    type: String,
    enum: ['requested', 'succeeded', 'failed'],
    required: true,
    index: true,
  },
  providerStatus: { type: Number, default: null, min: 100, max: 599 },
  errorCode: { type: String, default: null, trim: true, maxlength: 80 },
  actor: { type: ActorSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
});

RunpodOperationEventSchema.index({ resourceType: 1, createdAt: -1 });
RunpodOperationEventSchema.index({ podRecordId: 1, createdAt: -1 });
RunpodOperationEventSchema.index({ templateRecordId: 1, createdAt: -1 });

module.exports = mongoose.model('runpod_operation_event', RunpodOperationEventSchema);
