#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const {
  RUNPOD_API_ORIGIN,
  RunpodApiV2Service,
} = require('../services/runpodApiV2Service');

async function main({
  service = new RunpodApiV2Service(),
  stdout = console.log,
  stderr = console.error,
} = {}) {
  try {
    const [metadata, dashboard] = await Promise.all([
      service.getApiMetadata({ forceRefresh: true }),
      service.getDashboard({ bucketSize: 'day', lastN: 30, forceRefresh: true }),
    ]);

    stdout(`Runpod connection OK: ${metadata.title} ${metadata.version} (OpenAPI ${metadata.openapi})`);
    stdout(`Base URL: ${RUNPOD_API_ORIGIN}/v2`);
    stdout(`Catalog counts: ${dashboard.gpus.length} GPUs, ${dashboard.cpus.length} CPUs, ${dashboard.dataCenters.length} data centers, ${dashboard.templates.length} official templates`);
    stdout(`Billing response: ${dashboard.billing.records.length} records in the last 30 daily buckets`);

    const failures = Object.entries(dashboard.errors || {});
    if (failures.length) {
      for (const [section, error] of failures) {
        stderr(`Runpod ${section} check failed: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''}`);
      }
      return 1;
    }

    stdout('All step 1 Runpod API v2 checks passed. No instances were created or changed.');
    return 0;
  } catch (error) {
    stderr(`Runpod API v2 connection check failed: ${error?.code || error?.name || 'RUNPOD_API_ERROR'}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main };
