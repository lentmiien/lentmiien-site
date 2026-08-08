const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', 'logs');
const DEFAULT_RETENTION_DAYS = 7;

function getRetentionDays(value = process.env.LOG_RETENTION_DAYS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

async function pruneOldLogs({
  logDir = DEFAULT_LOG_DIR,
  retentionDays = getRetentionDays(),
  now = Date.now(),
  logger = null,
} = {}) {
  const retentionMs = getRetentionDays(retentionDays) * 24 * 60 * 60 * 1000;
  let removed = 0;
  await fs.promises.mkdir(logDir, { recursive: true });
  const entries = await fs.promises.readdir(logDir);

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.log')) continue;
    const filePath = path.join(logDir, entry);
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile() || now - stats.mtimeMs <= retentionMs) continue;
      await fs.promises.unlink(filePath);
      removed += 1;
      logger?.notice?.(`Removed old log file: ${filePath}`);
    } catch (error) {
      logger?.warning?.(`Unable to inspect log file: ${filePath}`, error);
    }
  }

  return { removed };
}

module.exports = {
  DEFAULT_LOG_DIR,
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  pruneOldLogs,
};
