const MessageService = require('../services/messageService');
const mongoose = require('mongoose');
const KnowledgeService = require('../services/knowledgeService');
const ConversationService = require('../services/conversationService');
const BatchService = require('../services/batchService');
const {
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  FileMetaModel,
  BatchPromptModel,
  BatchRequestModel,
} = require('../database');
const logger = require('../utils/logger');
const performanceMetrics = require('../services/performanceMetricsService');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

function shouldRun(now, lastRunKey) {
  if (now.getHours() !== 19 || now.getMinutes() !== 0) return false;
  const key = now.toISOString().slice(0, 10);
  if (lastRunKey.value === key) return false;
  lastRunKey.value = key;
  return true;
}

async function runBatchTrigger() {
  try {
    await performanceMetrics.trackTask('dailyBatchTrigger.run', async () => {
      const pendingCount = await BatchPromptModel.countDocuments({ request_id: 'new' });
      if (pendingCount === 0) {
        logger.debug('Scheduled batch trigger skipped, no pending prompts', { pendingCount });
        return;
      }

      const result = await batchService.triggerBatchRequest();
      logger.notice('Scheduled batch trigger executed', {
        processedPrompts: result.ids.length,
        createdRequests: result.requests.length,
      });
    });
  } catch (error) {
    logger.error('Scheduled batch trigger failed', { error });
  }
}

async function runTerminalBatchCleanup() {
  try {
    const result = await performanceMetrics.trackTask(
      'terminalBatchCleanupRetry.run',
      () => batchService.retryTerminalPromptCleanup(),
    );
    if (result?.cleaned > 0) {
      logger.notice('Retried terminal batch placeholder cleanup', {
        category: 'batch',
        metadata: result,
      });
    }
  } catch (error) {
    logger.error('Terminal batch placeholder cleanup retry failed', {
      category: 'batch',
      metadata: { error: error?.message || String(error) },
    });
  }
}

function scheduleDailyBatchTrigger() {
  const lastRunKey = { value: null };
  let running = false;

  const interval = setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
    if (running) return;
    running = true;
    try {
      const runDailyTrigger = shouldRun(new Date(), lastRunKey);
      await runTerminalBatchCleanup();
      if (runDailyTrigger) {
        await runBatchTrigger();
      }
    } finally {
      running = false;
    }
  }, 60 * 1000);

  interval.unref?.();
}

module.exports = scheduleDailyBatchTrigger;
module.exports.runTerminalBatchCleanup = runTerminalBatchCleanup;
