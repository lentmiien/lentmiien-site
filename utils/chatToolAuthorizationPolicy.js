const CHAT_TOOL_CAPABILITIES = Object.freeze({
  codexReadOnly: 'codex.run.read_only',
  codexWorkspaceWrite: 'codex.run.workspace_write',
  codexYolo: 'codex.run.yolo',
  humanRequestCreate: 'human.request.create',
  humanRequestManage: 'human.request.manage',
});

const CHAT_TOOL_ADMIN_CAPABILITIES = Object.freeze(Object.values(CHAT_TOOL_CAPABILITIES));

// These tools can inspect source code, run shell commands, edit workspaces, and
// pause a chat while a human completes an action. Keep every capability admin-only
// by default; individual grants remain available through the shared role system.
const CHAT_TOOL_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: CHAT_TOOL_ADMIN_CAPABILITIES,
  family: Object.freeze([]),
  user: Object.freeze([]),
  other: Object.freeze([]),
});

module.exports = {
  CHAT_TOOL_ADMIN_CAPABILITIES,
  CHAT_TOOL_CAPABILITIES,
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
};
