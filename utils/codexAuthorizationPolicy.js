const CODEX_CAPABILITIES = Object.freeze({
  runpodModelRun: 'codex.run.runpod_model',
});

const CODEX_ADMIN_CAPABILITIES = Object.freeze(Object.values(CODEX_CAPABILITIES));

// Runpod-backed models can incur infrastructure cost, so they are restricted to
// the administrator capability bundle by default. An individual account can be
// granted the semantic capability through the existing role store when needed.
const CODEX_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: CODEX_ADMIN_CAPABILITIES,
  family: Object.freeze([]),
  user: Object.freeze([]),
  other: Object.freeze([]),
});

module.exports = {
  CODEX_ADMIN_CAPABILITIES,
  CODEX_CAPABILITIES,
  CODEX_ROLE_CAPABILITY_BUNDLES,
};
