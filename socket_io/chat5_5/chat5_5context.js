const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const { 
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  Chat3TemplateModel,
  ChatPersonalityModel,
  ChatResponseTypeModel,
  Conversation5Model,
  FileMetaModel,
  BatchPromptModel,
  BatchRequestModel } = require('../../database');

const MessageService = require('../../services/messageService');
const ConversationService = require('../../services/conversationService');
const TemplateService = require('../../services/templateService');
const KnowledgeService = require('../../services/knowledgeService');
const BatchService = require('../../services/batchService');
const TtsService = require('../../services/ttsService');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);
const ttsService = new TtsService();

const TEMP_DIR = path.join(__dirname, '../../tmp_data');

async function ProcessUploadedImage(tmpFile) {
  const file_data = fs.readFileSync(tmpFile);
  const img_data = sharp(file_data);
  const metadata = await img_data.metadata();
  let short_side = metadata.width < metadata.height ? metadata.width : metadata.height;
  let long_side = metadata.width > metadata.height ? metadata.width : metadata.height;
  let scale = 1;
  if (short_side > 768 || long_side > 2048) {
    if (768 / short_side < scale) scale = 768 / short_side;
    if (2048 / long_side < scale) scale = 2048 / long_side;
  }
  const scale_img = img_data.resize({ width: Math.round(metadata.width * scale) });
  const img_buffer = await scale_img.jpeg().toBuffer();
  const new_filename = `UP-${Date.now()}.jpg`;
  fs.writeFileSync(`./public/img/${new_filename}`, img_buffer);
  return new_filename;
}

module.exports = {
  models: {
    Chat4Model,
    Conversation4Model,
    Chat4KnowledgeModel,
    Chat3TemplateModel,
    ChatPersonalityModel,
    ChatResponseTypeModel,
    Conversation5Model,
    FileMetaModel,
    BatchPromptModel,
    BatchRequestModel
  },
  services: {
    messageService,
    knowledgeService,
    conversationService,
    templateService,
    batchService,
    ttsService
  },
  helpers: {
    ProcessUploadedImage
  },
  TEMP_DIR
};
