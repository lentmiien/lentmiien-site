const { normalizeOrigin } = require('../../middleware/sessionCsrf');
function config(env = process.env) {
  const maxOnline = Number(env.COMMONS_MAX_ONLINE || 10);
  const origins = (env.COMMONS_ALLOWED_ORIGINS || 'https://home.lentmiien.com').split(',').map(s => s.trim());
  if (!Number.isInteger(maxOnline) || maxOnline < 1 || maxOnline > 10
    || origins.some(s => normalizeOrigin(s) !== s)
    || !['true', 'false'].includes(env.COMMONS_ENABLED || 'true')
    || !['true', 'false'].includes(env.COMMONS_NPC_ENABLED || 'false')) throw new Error('Invalid Commons configuration');
  return { enabled: env.COMMONS_ENABLED !== 'false', maxOnline, origins, npcEnabled: env.COMMONS_NPC_ENABLED === 'true', checkpointMs: 5000, leaseMs: 20000 };
}
// Optional NPC settings are read only when enabled. Invalid settings preserve the
// existing fail-closed Commons installation contract without stopping the Site.
function npcConfig(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if ((raw !== undefined && (typeof raw !== 'string' || !/^\d+$/.test(raw)))
      || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid Commons NPC configuration');
    return value;
  };
  return Object.freeze({
    timeoutMs: integer('COMMONS_NPC_TIMEOUT_MS', 90000, 60000, 120000),
    contextTokens: integer('COMMONS_NPC_CONTEXT_TOKENS', 16384, 8192, 65536),
    maxTokens: integer('COMMONS_NPC_MAX_TOKENS', 512, 256, 1024),
  });
}
module.exports = { config, npcConfig };
