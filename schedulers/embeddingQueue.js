const mongoose = require('mongoose');

const embeddingQueueService = require('../services/embeddingQueueService');
const logger = require('../utils/logger');

function scheduleEmbeddingQueue() {
  if (process.env.EMBED_QUEUE_ENABLED === 'false') {
    logger.notice('Embedding queue worker disabled by EMBED_QUEUE_ENABLED=false', {
      category: 'embedding_queue',
    });
    return embeddingQueueService;
  }

  const start = () => embeddingQueueService.start();
  if (mongoose.connection.readyState === 1) {
    start();
  } else {
    logger.notice('Embedding queue worker waiting for MongoDB connection', {
      category: 'embedding_queue',
    });
    mongoose.connection.once('connected', start);
  }
  return embeddingQueueService;
}

module.exports = scheduleEmbeddingQueue;
