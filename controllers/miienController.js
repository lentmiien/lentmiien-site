const db = require('../database');
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const AsrApiService = require('../services/asrApiService');
const { MiienChatService } = require('../services/miienChatService');
const { listAvailableChatModels } = require('../services/chat5ModelCatalogService');
const { createMiienRouter } = require('../routes/miien');
const logger = require('../utils/logger');
const messageService = new MessageService(db.Chat4Model, db.FileMetaModel);
module.exports = createMiienRouter({
  service: new MiienChatService({ conversations: db.Conversation5Model, messages: db.Chat5Model,
    pending: db.PendingRequests, listModels: listAvailableChatModels,
    conversationService: new ConversationService(db.Conversation4Model, messageService, null) }),
  asr: new AsrApiService({ requestTimeoutMs: 60000 }), roleModel: db.RoleModel, logger,
});
