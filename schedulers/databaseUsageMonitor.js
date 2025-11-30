const axios = require('axios');
const logger = require('../utils/logger');
const { ApiDebugLog } = require('../database');
const { fetchDatabaseUsage, evaluateAlerts } = require('../services/databaseUsageService');
const { formatBytes, formatPercent, calculatePercent } = require('../utils/metricsFormatter');

const PLACEHOLDER_WEBHOOK_URL = 'https://example.com/replace-with-db-usage-webhook';
const DEFAULT_INTERVAL_MINUTES = 60;

function getWebhookUrl() {
  return process.env.DB_USAGE_ALERT_WEBHOOK || PLACEHOLDER_WEBHOOK_URL;
}

function buildAlertMessage(alert) {
  if (alert.type === 'totalStorage') {
    return `Database storage at ${formatBytes(alert.actualBytes)} (limit ${formatBytes(alert.thresholdBytes)}).`;
  }
  if (alert.type === 'apiDebug') {
    const share = calculatePercent(alert.totalStorageBytes || 0, alert.actualBytes || 0);
    return `${alert.collectionName || 'api_debug_log'} using ${formatBytes(alert.actualBytes || 0)} (${formatPercent(share)}) which exceeds ${formatBytes(alert.thresholdBytes)}.`;
  }
  return 'Database usage alert triggered.';
}

async function dispatchAlerts(alerts, usage) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    logger.notice('Database usage alerts suppressed, no webhook configured.');
    return;
  }

  if (webhookUrl === PLACEHOLDER_WEBHOOK_URL) {
    logger.notice('Database usage alerts available, but webhook uses placeholder URL. Configure DB_USAGE_ALERT_WEBHOOK to enable notifications.', {
      alertCount: alerts.length,
    });
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    database: usage.dbStats?.name,
    alerts: alerts.map((alert) => ({
      type: alert.type,
      level: alert.level,
      message: buildAlertMessage(alert),
      actualBytes: alert.actualBytes,
      thresholdBytes: alert.thresholdBytes,
      collectionName: alert.collectionName,
    })),
  };

  try {
    await axios.post(webhookUrl, payload);
    logger.notice('Database usage alert webhook dispatched', { alertCount: payload.alerts.length });
  } catch (error) {
    logger.error('Failed to send database usage alert webhook', {
      error: error.message,
    });
  }
}

function createSignature(alerts) {
  return JSON.stringify(
    alerts.map((alert) => ({
      type: alert.type,
      level: alert.level,
      collection: alert.collectionName,
    })),
  );
}

function scheduleDatabaseUsageMonitor() {
  let lastSignature = null;
  const intervalMinutes = Number.parseInt(process.env.DB_USAGE_ALERT_INTERVAL_MINUTES || '', 10);
  const intervalMs = Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes * 60 * 1000
    : DEFAULT_INTERVAL_MINUTES * 60 * 1000;

  const runCheck = async () => {
    try {
      const usage = await fetchDatabaseUsage();
      const apiDebugCollectionName = ApiDebugLog?.collection?.collectionName;
      const alerts = evaluateAlerts(usage, { collectionHints: { apiDebugCollectionName } });

      if (!alerts.length) {
        lastSignature = null;
        return;
      }

      const signature = createSignature(alerts);
      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      await dispatchAlerts(alerts, usage);
    } catch (error) {
      logger.error('Database usage monitor failed', {
        error: error.message,
      });
    }
  };

  runCheck().catch(() => {});
  const handle = setInterval(runCheck, intervalMs);
  handle.unref?.();
}

module.exports = scheduleDatabaseUsageMonitor;
