const CODEX_CAPABILITIES = Object.freeze({
  runpodModelRun: 'codex.run.runpod_model',
  turnSteer: 'codex.turn.steer',
});

const CODEX_ADMIN_CAPABILITIES = Object.freeze(Object.values(CODEX_CAPABILITIES));

// Runpod-backed models can incur infrastructure cost, so that capability is
// restricted to administrators by default. Turn steering follows the normal
// authenticated Codex roles and still requires object-level ownership.
const CODEX_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: CODEX_ADMIN_CAPABILITIES,
  family: Object.freeze([CODEX_CAPABILITIES.turnSteer]),
  user: Object.freeze([CODEX_CAPABILITIES.turnSteer]),
  other: Object.freeze([]),
});

module.exports = {
  CODEX_ADMIN_CAPABILITIES,
  CODEX_CAPABILITIES,
  CODEX_ROLE_CAPABILITY_BUNDLES,
};
