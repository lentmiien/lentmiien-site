const mongoose = require('mongoose');
const logger = require('../utils/logger');
const performanceMetrics = require('../services/performanceMetricsService');
const disasterIngestionService = require('../services/disasterIngestionService');
const { getIntervalMs } = require('../services/disasterIngestionService');

function scheduleDisasterIngestion() {
  if (process.env.DISASTER_INGESTION_ENABLED === 'false') {
    logger.notice('Disaster ingestion scheduler disabled by DISASTER_INGESTION_ENABLED=false', {
      category: 'disaster_ingestion',
    });
    return;
  }

  const intervalMs = getIntervalMs();

  const tick = async (reason = 'scheduled') => {
    try {
      await performanceMetrics.trackTask('disasterIngestion.runOnce', () => (
        disasterIngestionService.runOnce({ reason })
      ));
    } catch (error) {
      logger.error('Disaster ingestion run failed', {
        category: 'disaster_ingestion',
        metadata: { error: error.message },
      });
    }
  };

  const start = () => {
    logger.notice('Disaster ingestion scheduler started', {
      category: 'disaster_ingestion',
      metadata: { intervalMs },
    });
    tick('startup').catch(() => {});
    const handle = setInterval(() => {
      tick('scheduled').catch(() => {});
    }, intervalMs);
    handle.unref?.();
  };

  if (mongoose.connection.readyState === 1) {
    start();
    return;
  }

  logger.notice('Disaster ingestion scheduler waiting for MongoDB connection', {
    category: 'disaster_ingestion',
  });
  mongoose.connection.once('connected', start);
}

module.exports = scheduleDisasterIngestion;
