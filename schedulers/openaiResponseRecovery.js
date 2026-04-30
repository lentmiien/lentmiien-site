const mongoose = require('mongoose');
const logger = require('../utils/logger');
const performanceMetrics = require('../services/performanceMetricsService');
const MessageService = require('../services/messageService');
const KnowledgeService = require('../services/knowledgeService');
const ConversationService = require('../services/conversationService');
const { emitConversationMessages } = require('../utils/chat5Realtime');
const {
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  FileMetaModel,
} = require('../database');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function runRecovery(app) {
  const batchSize = parsePositiveInteger(process.env.OPENAI_PENDING_RECONCILE_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const updates = await conversationService.reconcilePendingResponses({ limit: batchSize });

  if (!Array.isArray(updates) || updates.length === 0) {
    return;
  }

  const io = app?.get?.('io');
  let completedCount = 0;
  let failedCount = 0;

  for (const update of updates) {
    if (update?.type === 'completed') {
      completedCount += 1;
      if (io && update.conversation) {
        emitConversationMessages(io, {
          conversation: update.conversation,
          messages: update.messages,
          placeholderId: update.placeholder_id,
        });
      }
      continue;
    }

    if (update?.type === 'failed') {
      failedCount += 1;
    }
  }

  logger.notice('OpenAI pending response recovery processed updates', {
    recoveredCompleted: completedCount,
    recoveredFailed: failedCount,
    totalUpdates: updates.length,
  });
}

function scheduleOpenAIResponseRecovery(app) {
  const intervalMs = parsePositiveInteger(process.env.OPENAI_PENDING_RECONCILE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await performanceMetrics.trackTask('openaiResponseRecovery.run', () => runRecovery(app));
    } catch (error) {
      logger.error('OpenAI pending response recovery failed', {
        category: 'openai_webhook_recovery',
        metadata: { error: error.message },
      });
    } finally {
      running = false;
    }
  };

  const start = () => {
    logger.notice('OpenAI pending response recovery started', {
      category: 'openai_webhook_recovery',
      metadata: { intervalMs },
    });
    tick().catch(() => {});
    const handle = setInterval(tick, intervalMs);
    handle.unref?.();
  };

  if (mongoose.connection.readyState === 1) {
    start();
    return;
  }

  logger.notice('OpenAI pending response recovery waiting for MongoDB connection', {
    category: 'openai_webhook_recovery',
  });
  mongoose.connection.once('connected', () => {
    start();
  });
}

module.exports = scheduleOpenAIResponseRecovery;
