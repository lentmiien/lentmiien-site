const mongoose = require('mongoose');

const EncryptedFieldSchema = new mongoose.Schema(
  {
    v: { type: Number, required: true, min: 1 },
    alg: { type: String, required: true, trim: true },
    kid: { type: String, required: true, trim: true },
    iv: { type: String, required: true, trim: true },
    tag: { type: String, required: true, trim: true },
    ct: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const ApiRecordSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    order: { type: Number, default: null },
    customer: { type: String, default: null, trim: true },
    tracking: { type: String, default: null, trim: true },
    title: { type: String, default: null, trim: true },
    comment: { type: String, default: null, trim: true },
    next_deadline: { type: Date, default: null },
    completed: { type: Boolean, default: false },
    fields: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => ({}) },
    encryptedFields: { type: Map, of: EncryptedFieldSchema, default: () => ({}) },
    rev: { type: Number, required: true, default: 0, min: 0 },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  {
    minimize: false,
    versionKey: false,
    toJSON: {
      flattenMaps: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
    toObject: {
      flattenMaps: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
  }
);

ApiRecordSchema.index({ updatedAt: -1 });
ApiRecordSchema.index({ createdAt: -1 });
ApiRecordSchema.index({ next_deadline: 1 });
ApiRecordSchema.index({ completed: 1, next_deadline: 1 });
ApiRecordSchema.index({ order: 1 });
ApiRecordSchema.index({ customer: 1, order: 1 });
ApiRecordSchema.index({ title: 1 });

module.exports = mongoose.model('api_record', ApiRecordSchema);
