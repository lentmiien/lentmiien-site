const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const {
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  Chat3TemplateModel,
  AIModelCards,
  Conversation5Model,
  Chat5TemplateModel,
  FileMetaModel,
  BatchPromptModel,
  BatchRequestModel,
} = require('../../database');

const MessageService = require('../../services/messageService');
const ConversationService = require('../../services/conversationService');
const TemplateService = require('../../services/templateService');
const KnowledgeService = require('../../services/knowledgeService');
const BatchService = require('../../services/batchService');

const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel, {
  chat5TemplateModel: Chat5TemplateModel,
  conversationService,
});
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

const TEMP_DIR = path.join(__dirname, '../../tmp_data');

async function ProcessUploadedImage(tmpFile) {
  const fileData = fs.readFileSync(tmpFile);
  const image = sharp(fileData);
  const metadata = await image.metadata();
  const shortSide = Math.min(metadata.width, metadata.height);
  const longSide = Math.max(metadata.width, metadata.height);
  let scale = 1;
  if (shortSide > 768 || longSide > 2048) {
    scale = Math.min(scale, 768 / shortSide, 2048 / longSide);
  }
  const scaledImage = image.resize({ width: Math.round(metadata.width * scale) });
  const imageBuffer = await scaledImage.jpeg().toBuffer();
  const newFilename = `UP-${Date.now()}.jpg`;
  fs.writeFileSync(`./public/img/${newFilename}`, imageBuffer);
  return newFilename;
}

module.exports = {
  models: {
    Chat4Model,
    Conversation4Model,
    Chat4KnowledgeModel,
    Chat3TemplateModel,
    AIModelCards,
    Conversation5Model,
    Chat5TemplateModel,
    FileMetaModel,
    BatchPromptModel,
    BatchRequestModel,
  },
  services: {
    messageService,
    knowledgeService,
    conversationService,
    templateService,
    batchService,
  },
  helpers: {
    ProcessUploadedImage,
  },
  TEMP_DIR,
};
