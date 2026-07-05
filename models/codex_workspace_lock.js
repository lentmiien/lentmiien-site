const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodexWorkspaceLockSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  workspaceId: { type: String, required: true, unique: true },
  turnId: { type: String, required: true, index: true },
  workerId: { type: String, required: true, index: true },
  acquiredAt: { type: Date, default: Date.now },
  heartbeatAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  versionKey: false,
});

CodexWorkspaceLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('codex_workspace_lock', CodexWorkspaceLockSchema);
