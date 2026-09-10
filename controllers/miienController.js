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
const MiienAsrSlot = require('../models/miien_asr_slot');
const { MiienTranscriptionJobs, transcriptionLimits } = require('../utils/miienTranscriptionJobs');
const { hasCapabilities } = require('../utils/authorization');
const { READ, WRITE, TRANSCRIBE, SYNTHESIZE, MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');
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
const limits = transcriptionLimits();
const transcription = new MiienTranscriptionJobs({ chat: service, slots: MiienAsrSlot, logger, limits,
  asr: new AsrApiService({ requestTimeoutMs: limits.deadlineMs }),
  authorize: async id => {
    const principal = await db.UseraccountModel.findById(id).select('_id name type_user');
    return principal && await hasCapabilities(principal, [READ, WRITE, TRANSCRIBE], {
      roleModel: db.RoleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES,
    }) ? principal : null;
  },
});
module.exports = createMiienRouter({ service, speech, transcription, roleModel: db.RoleModel, logger });
