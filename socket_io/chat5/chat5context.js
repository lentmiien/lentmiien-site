const path = require('path');

const { 
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  Chat3TemplateModel,
  FileMetaModel,
  BatchPromptModel,
  BatchRequestModel } = require('../../database');

const MessageService = require('../../services/messageService');
const ConversationService = require('../../services/conversationService');
const TemplateService = require('../../services/templateService');
const KnowledgeService = require('../../services/knowledgeService');
const BatchService = require('../../services/batchService');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

const TEMP_DIR = path.join(__dirname, '../../tmp_data');

function someChat5Helper(foo) {
  // ...do something
}

module.exports = {
  models: {
    Chat4Model,
    Conversation4Model,
    Chat4KnowledgeModel,
    Chat3TemplateModel,
    FileMetaModel,
    BatchPromptModel,
    BatchRequestModel
  },
  services: {
    messageService,
    knowledgeService,
    conversationService,
    templateService,
    batchService
  },
  helpers: {
    someChat5Helper
  },
  TEMP_DIR
};
