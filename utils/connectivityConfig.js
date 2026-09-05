const { createHash } = require('crypto');

const MONITOR_VERSION = '2';

function getConnectivityConfig(env = process.env) {
  function number(name, fallback, min, max) {
    const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  }
  const enabled = env.CONNECTIVITY_MONITOR_ENABLED ?? 'true';
  if (!['true', 'false'].includes(enabled)) throw new Error('Invalid CONNECTIVITY_MONITOR_ENABLED');
  const config = {
    enabled: enabled === 'true',
    monitorVersion: MONITOR_VERSION,
    intervalMs: number('CONNECTIVITY_INTERVAL_MS', 120000, 60000, 600000),
    retentionDays: number('CONNECTIVITY_RETENTION_DAYS', 3, 1, 7),
    sustainedMs: number('CONNECTIVITY_SUSTAINED_MS', 600000, 600000, 86400000),
    cooldownMs: number('CONNECTIVITY_COOLDOWN_MS', 3600000, 600000, 86400000),
    timeoutMs: number('CONNECTIVITY_TIMEOUT_MS', 5000, 1000, 15000),
    slowMs: number('CONNECTIVITY_SLOW_MS', 1500, 100, 10000),
    publicOrigin: null,
  };
  if (config.slowMs >= config.timeoutMs) throw new Error('CONNECTIVITY_SLOW_MS must be below timeout');
  if (env.CONNECTIVITY_PUBLIC_ORIGIN) {
    const url = new URL(env.CONNECTIVITY_PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9.-]+$/i.test(url.hostname)
      || !url.hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      throw new Error('Invalid CONNECTIVITY_PUBLIC_ORIGIN');
    }
    config.publicOrigin = url.origin;
  }
  config.maxGapMs = config.intervalMs * 1.5;
  config.signature = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return config;
}

module.exports = { getConnectivityConfig, MONITOR_VERSION };
