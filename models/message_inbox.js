const mongoose = require('mongoose');

const { Schema } = mongoose;

const MessageInboxSchema = new Schema({
  messageId: { type: String, required: true, unique: true },
  threadId: { type: String, default: null },
  labels: { type: [String], default: [] },
  sizeEstimate: { type: Number, default: null },
  html: { type: String, default: '' },
  text: { type: String, default: '' },
  textAsHtml: { type: String, default: '' },
  subject: { type: String, default: '' },
  date: { type: Date, default: Date.now, required: true },
  from: { type: String, required: true, lowercase: true, trim: true },
  retentionDeadlineDate: { type: Date, required: true },
  hasEmbedding: { type: Boolean, default: false },
  hasHighQualityEmbedding: { type: Boolean, default: false },
  appliedRetentionDays: { type: Number, default: null },
  appliedFilterId: { type: Schema.Types.ObjectId, ref: 'message_filter', default: null },
  appliedLabelRules: { type: [String], default: [] },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
});

MessageInboxSchema.index({ date: -1 });
MessageInboxSchema.index({ from: 1 });

module.exports = mongoose.model('message_inbox', MessageInboxSchema);
