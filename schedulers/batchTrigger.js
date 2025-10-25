const MessageService = require('../services/messageService');
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
  } catch (error) {
    logger.error('Scheduled batch trigger failed', { error });
  }
}

function scheduleDailyBatchTrigger() {
  const lastRunKey = { value: null };

  const interval = setInterval(async () => {
    const now = new Date();
    if (!shouldRun(now, lastRunKey)) return;
    await runBatchTrigger();
  }, 60 * 1000);

  interval.unref?.();
}

module.exports = scheduleDailyBatchTrigger;
