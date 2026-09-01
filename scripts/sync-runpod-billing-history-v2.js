#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const { runpodBillingHistoryService } = require('../services/runpodBillingHistoryService');

const EXECUTE_FLAG = '--execute';

function safeCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 80
    ? error.code
    : 'RUNPOD_BILLING_SYNC_FAILED';
}

async function main({
  argv = process.argv.slice(2),
  billingService = runpodBillingHistoryService,
  mongooseInstance = mongoose,
  mongoUrl = process.env.MONGOOSE_URL,
  apiKey = process.env.RUNPOD_API_KEY,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No billing records were changed.');
    stdout(`Re-run with ${EXECUTE_FLAG} to fetch Runpod API v2 billing and upsert the local monthly history.`);
    return 0;
  }
  if (!apiKey || !mongoUrl) {
    stderr(`Runpod billing sync failed: ${!apiKey ? 'RUNPOD_NOT_CONFIGURED' : 'MONGOOSE_URL_REQUIRED'}`);
    return 1;
  }

  try {
    await mongooseInstance.connect(mongoUrl, { serverSelectionTimeoutMS: 10_000 });
    const result = await billingService.syncHistory({ name: 'runpod-billing-backfill' });
    const stored = await billingService.getStoredHistory();
    const firstPeriod = stored.periods?.[0]?.periodKey || 'none';
    const lastPeriod = stored.periods?.at?.(-1)?.periodKey || 'none';
    stdout(`Stored ${result.accountPeriods} account months (${firstPeriod} through ${lastPeriod}).`);
    stdout(`Stored ${result.podPeriods} per-Pod billing periods and created ${result.historicalPods} historical Pod records.`);
    if (Object.keys(result.errors || {}).length) {
      stdout(`Partial provider failure: ${Object.keys(result.errors).sort().join(', ')}.`);
    }
    return 0;
  } catch (error) {
    stderr(`Runpod billing sync failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (mongooseInstance.connection.readyState !== 0) {
      await mongooseInstance.disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  EXECUTE_FLAG,
  main,
  safeCode,
};
