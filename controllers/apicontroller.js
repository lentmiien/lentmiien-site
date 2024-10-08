// API for the VUE app

exports.root = async (req, res, next) => {
  // Do some initial checks and setups

  next();
}

/*******************
 * HEALTH
 */
const HealthService = require('../services/healthService');
const { HealthEntry } = require('../database');
// Services
const healthService = new HealthService(HealthEntry);

exports.getHealthEntries = async (req, res) => {
  let entries = [];

  if ("start" in req.query && "end" in req.query) {
    entries = await healthService.getInRange(req.query.start, req.query.end);
  } else {
    entries = await healthService.getAll();
  }

  entries.sort((a,b) => {
    if (a.dateOfEntry < b.dateOfEntry) return 1;
    if (a.dateOfEntry > b.dateOfEntry) return -1;
    return 0;
  });

  res.json(entries);
};

exports.updateHealthEntry = async (req, res) => {
  const {date, basic, medical, diary} = req.body;
  res.json(await healthService.updateEntry(date, basic, medical, diary));
};

exports.uploadHealthCsv = async (req, res) => {
  const {inputDataArray, type} = req.body;
  res.json(await healthService.appendData(inputDataArray, type));
};

exports.deleteHealthEntry = async (req, res) => {
  const {date} = req.body;
  res.json(await healthService.deleteEntry(date));
};

/*******************
 * CHAT
 */
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, Chat3TemplateModel, FileMetaModel, BatchPromptModel, BatchRequestModel } = require('../database');
const { whisper } = require('../utils/ChatGPT');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

exports.getChatEntries = async (req, res) => {
  let entries = [];

  if ("start" in req.query && "end" in req.query) {
    entries = await conversationService.getInRange(req.user.name, req.query.start, req.query.end);
  }

  res.json(entries);
};
