require('dotenv').config();

const mongoose = require('mongoose');

const logger = require('../utils/logger');
require('../database');
const codexQueueWorker = require('../services/codexQueueWorker');

let shuttingDown = false;
let keepAliveInterval = null;

function getPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function waitForDatabase() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  }
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection is not ready.');
  }
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.notice('Codex worker process stopping', {
    category: 'codex_tool',
    metadata: { signal },
  });
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  codexQueueWorker.stop();
  await mongoose.disconnect().catch((error) => {
    logger.warning('Codex worker MongoDB disconnect failed', {
      category: 'codex_tool',
      metadata: { error: error.message },
    });
  });
  process.exit(exitCode);
}

async function main() {
  await waitForDatabase();
  codexQueueWorker.start();
  const status = codexQueueWorker.getStatus();
  if (!status.enabled) {
    logger.notice('Codex worker process disabled; exiting', {
      category: 'codex_tool',
      metadata: { workerId: status.workerId },
    });
    codexQueueWorker.stop();
    await mongoose.disconnect();
    return;
  }
  logger.notice('Codex worker process started', {
    category: 'codex_tool',
    metadata: {
      workerId: status.workerId,
      enabled: status.enabled,
      globalConcurrency: status.globalConcurrency,
      pollIntervalMs: status.pollIntervalMs,
    },
  });

  keepAliveInterval = setInterval(() => {}, getPositiveIntegerEnv('CODEX_WORKER_KEEPALIVE_MS', 60 * 60 * 1000));
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1));
});

process.on('unhandledRejection', (error) => {
  logger.error('Codex worker unhandled rejection', {
    category: 'codex_tool',
    metadata: { error },
  });
});

main().catch((error) => {
  logger.error('Codex worker process failed to start', {
    category: 'codex_tool',
    metadata: { error },
  });
  process.exit(1);
});
