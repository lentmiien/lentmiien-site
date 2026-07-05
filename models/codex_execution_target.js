const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodexExecutionTargetSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  type: {
    type: String,
    enum: ['local-windows', 'local-linux', 'local-darwin', 'remote-ssh-linux'],
    default: 'local-linux',
    index: true,
  },
  platform: {
    type: String,
    enum: ['windows', 'linux', 'darwin', 'remote-linux'],
    default: 'linux',
    index: true,
  },
  enabled: { type: Boolean, default: true, index: true },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  connection: { type: Schema.Types.Mixed, default: {} },
}, {
  timestamps: true,
  versionKey: false,
});

CodexExecutionTargetSchema.index({ name: 1 });

module.exports = mongoose.model('codex_execution_target', CodexExecutionTargetSchema);
