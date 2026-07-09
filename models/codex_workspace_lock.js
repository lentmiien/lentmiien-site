const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodexWorkspaceLockSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  workspaceId: { type: String, required: true },
  turnId: { type: String, required: true },
  workerId: { type: String, required: true },
  acquiredAt: { type: Date, default: Date.now },
  heartbeatAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  versionKey: false,
  autoIndex: false,
});

CodexWorkspaceLockSchema.index({ workspaceId: 1 }, { unique: true, name: 'workspaceId_1' });
CodexWorkspaceLockSchema.index({ turnId: 1 }, { name: 'turnId_1' });
CodexWorkspaceLockSchema.index({ workerId: 1 }, { name: 'workerId_1' });
CodexWorkspaceLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_1' });

module.exports = mongoose.model('codex_workspace_lock', CodexWorkspaceLockSchema);
