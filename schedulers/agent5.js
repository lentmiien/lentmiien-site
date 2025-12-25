const logger = require('../utils/logger');
const Agent5Service = require('../services/agent5Service');
const MessageService = require('../services/messageService');
const KnowledgeService = require('../services/knowledgeService');
const ConversationService = require('../services/conversationService');
const {
  Agent5Model,
  Agent5ConversationBehavior,
  Conversation5Model,
  Chat5Model,
  ChatPersonalityModel,
  ChatResponseTypeModel,
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  FileMetaModel,
} = require('../database');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);

const agent5Service = new Agent5Service({
  agentModel: Agent5Model,
  behaviorModel: Agent5ConversationBehavior,
  conversationModel: Conversation5Model,
  chatModel: Chat5Model,
  personalityModel: ChatPersonalityModel,
  responseTypeModel: ChatResponseTypeModel,
  conversationService,
  messageService,
});

function scheduleAgent5Runner() {
  const runState = new Map();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await agent5Service.runDueAgents(runState);
    } catch (error) {
      logger.error('Agent5 scheduler tick failed', {
        category: 'agent5',
        metadata: { error: error.message },
      });
    } finally {
      running = false;
    }
  };

  tick().catch(() => {});
  const handle = setInterval(tick, 60 * 1000);
  handle.unref?.();
  logger.notice('Agent5 scheduler started', { category: 'agent5' });
}

module.exports = scheduleAgent5Runner;
