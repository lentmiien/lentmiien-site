const path = require('path');
const { storageRoot } = require('./paths');
function config(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const n = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  if (!['true', 'false', undefined, ''].includes(env.EMBEDDINGGEMMA2_ENABLED)) throw new Error('Invalid pilot enable flag');
  const dbName = env.EMBEDDINGGEMMA2_DB_NAME || 'embeddinggemma2_pilot';
  if (!/^embeddinggemma2_pilot(?:_[a-z0-9_]{1,32})?$/.test(dbName)) throw new Error('Invalid pilot database name');
  const base = new URL(env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Gateway must be a trusted HTTP(S) origin');
  if (process.platform === 'win32' && env.EMBEDDINGGEMMA2_ENABLED === 'true' && !env.EMBEDDINGGEMMA2_STORAGE_DIR) throw new Error('Windows pilot requires a protected storage directory');
  const root = storageRoot(env.EMBEDDINGGEMMA2_STORAGE_DIR || path.join(__dirname, '../../private_data/embeddinggemma2'), path.resolve(__dirname, '../../public'));
  return {
    enabled: env.EMBEDDINGGEMMA2_ENABLED === 'true', dbName, root, base: base.origin,
    timeout: integer('EMBEDDINGGEMMA2_TIMEOUT_MS', 1800000, 1800000, 3600000),
    userItems: integer('EMBEDDINGGEMMA2_USER_ITEMS', 200, 1, 2000),
    globalItems: integer('EMBEDDINGGEMMA2_GLOBAL_ITEMS', 500, 1, 5000),
    userBytes: integer('EMBEDDINGGEMMA2_USER_BYTES', 268435456, 8388608, 4294967296),
    globalBytes: integer('EMBEDDINGGEMMA2_GLOBAL_BYTES', 536870912, 8388608, 8589934592),
  };
}
module.exports = { config };
