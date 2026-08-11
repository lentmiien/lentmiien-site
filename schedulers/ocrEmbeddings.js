const ocrEmbeddingService = require('../services/ocrEmbeddingService');

function scheduleOcrEmbeddingReconciliation() {
  ocrEmbeddingService.start();
  return ocrEmbeddingService;
}

module.exports = scheduleOcrEmbeddingReconciliation;
