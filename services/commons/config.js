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
module.exports = { config };
