const db = require('../database');
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const AsrApiService = require('../services/asrApiService');
const { MiienChatService } = require('../services/miienChatService');
const { listAvailableChatModels } = require('../services/chat5ModelCatalogService');
const { createMiienRouter } = require('../routes/miien');
const logger = require('../utils/logger');
const { MiienSpeechService } = require('../services/miienSpeechService');
const MiienSpeechSlot = require('../models/miien_speech_slot');
const { hasCapabilities } = require('../utils/authorization');
const { READ, SYNTHESIZE, MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');
const messageService = new MessageService(db.Chat4Model, db.FileMetaModel);
const service = new MiienChatService({ conversations: db.Conversation5Model, messages: db.Chat5Model,
  pending: db.PendingRequests, listModels: listAvailableChatModels,
  conversationService: new ConversationService(db.Conversation4Model, messageService, null) });
const speech = new MiienSpeechService({ chat: service, slots: MiienSpeechSlot, logger,
  authorize: async id => {
    const principal = await db.UseraccountModel.findById(id).select('_id name type_user');
    return principal && await hasCapabilities(principal, [READ, SYNTHESIZE], {
      roleModel: db.RoleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES,
    }) ? principal : null;
  },
});
module.exports = createMiienRouter({ service, speech,
  asr: new AsrApiService({ requestTimeoutMs: 60000 }), roleModel: db.RoleModel, logger,
});
