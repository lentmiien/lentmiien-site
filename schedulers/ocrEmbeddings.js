const mongoose = require('mongoose');
const ocrEmbeddingService = require('../services/ocrEmbeddingService');

function scheduleOcrEmbeddingReconciliation() {
  ocrEmbeddingService.setDatabaseReadyCheck(
    () => mongoose.connection.readyState === 1
  );
  ocrEmbeddingService.start();
  return ocrEmbeddingService;
}

module.exports = scheduleOcrEmbeddingReconciliation;
