// API for the VUE app

const binpackingController = require('./binpackingcontroller');
const productDetailsController = require('./productdetailscontroller');

exports.root = async (req, res, next) => {
  // Do some initial checks and setups

  next();
}

/*******************
 * BIN PACKING
 */
exports.binPacking = (req, res) => binpackingController.run(req, res);
exports.processProductDetails = async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : req.body?.data;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ status: 'error', message: 'Expected an array payload or an object with a `data` array' });
  }

  try {
    const output = await productDetailsController.processProductData(rows, { responseStyle: 'json' });
    res.json(output);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

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
 * MESSAGE INBOX
 */
const { MessageInboxService } = require('../services/messageInboxService');
const { MessageInboxEntry, MessageFilter } = require('../database');
const messageInboxService = new MessageInboxService(MessageInboxEntry, MessageFilter);

exports.saveIncomingMessage = async (req, res) => {
  try {
    const result = await messageInboxService.saveIncomingMessage(req.body || {});
    if (result.status === 'ignored') {
      return res.json({
        status: 'ignored',
        reason: result.reason,
        id: result.message?._id,
        messageId: result.message?.messageId,
      });
    }
    const message = result.message;
    return res.json({
      status: 'saved',
      id: message._id,
      messageId: message.messageId,
      retentionDeadlineDate: message.retentionDeadlineDate,
      hasEmbedding: message.hasEmbedding,
      hasHighQualityEmbedding: message.hasHighQualityEmbedding,
      appliedRetentionDays: message.appliedRetentionDays,
      appliedFilterId: message.appliedFilterId,
      appliedLabelRules: message.appliedLabelRules,
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

/*******************
 * CHAT
 */
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, Chat3TemplateModel, FileMetaModel, BatchPromptModel, BatchRequestModel, Task } = require('../database');
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

const getChat5ConversationId = (body) => {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.conversation_id === 'string') return body.conversation_id.trim();
  if (typeof body.conversationId === 'string') return body.conversationId.trim();
  return '';
};

const getChat5Prompt = (body) => {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.prompt === 'string') return body.prompt;
  if (typeof body.text === 'string') return body.text;
  if (typeof body.message === 'string') return body.message;
  return '';
};

const buildChat5TextContent = (text) => ({
  text,
  image: null,
  audio: null,
  tts: null,
  transcript: null,
  revisedPrompt: null,
  imageQuality: null,
  toolOutput: null,
});

exports.chat5SendResponse = async (req, res) => {
  const userId = req.user && req.user.name ? req.user.name : (req.query && req.query.name ? req.query.name : null);
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized.' });
  }

  const conversationId = getChat5ConversationId(req.body);
  if (!conversationId || conversationId === 'NEW') {
    return res.status(400).json({ status: 'error', message: 'Missing conversation ID.' });
  }

  const promptRaw = getChat5Prompt(req.body);
  if (!promptRaw || promptRaw.trim().length === 0) {
    return res.status(400).json({ status: 'error', message: 'Please provide input text.' });
  }

  try {
    const { conversation } = await conversationService.postToConversationNew({
      conversationId,
      userId,
      messageContent: buildChat5TextContent(promptRaw),
      messageType: 'text',
      generateAI: true,
    });

    return res.json({ status: 'ok', conversationId: conversation._id.toString() });
  } catch (error) {
    if (error && error.message === 'Conversation not found') {
      return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
    }
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

exports.chat5BatchSendResponse = async (req, res) => {
  const userId = req.user && req.user.name ? req.user.name : (req.query && req.query.name ? req.query.name : null);
  if (!userId) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized.' });
  }

  const conversationId = getChat5ConversationId(req.body);
  if (!conversationId || conversationId === 'NEW') {
    return res.status(400).json({ status: 'error', message: 'Missing conversation ID.' });
  }

  const promptRaw = getChat5Prompt(req.body);
  if (!promptRaw || promptRaw.trim().length === 0) {
    return res.status(400).json({ status: 'error', message: 'Please provide input text.' });
  }

  try {
    const { conversation } = await conversationService.postToConversationNew({
      conversationId,
      userId,
      messageContent: buildChat5TextContent(promptRaw),
      messageType: 'text',
      generateAI: false,
    });

    const placeholder = await messageService.createMessageNew({
      userId: 'bot',
      contentType: 'text',
      content: buildChat5TextContent('Pending batch response'),
      category: conversation.category,
      tags: conversation.tags,
      conversationId: conversation._id,
    });

    conversation.messages.push(placeholder._id.toString());
    conversation.updatedAt = new Date();
    await conversation.save();

    await batchService.addPromptToBatch({
      userId,
      conversationId: conversation._id.toString(),
      messageId: placeholder._id.toString(),
      model: conversation.metadata?.model,
      title: conversation.title,
      taskType: 'response',
    });

    return res.json({ status: 'ok', conversationId: conversation._id.toString() });
  } catch (error) {
    if (error && error.message === 'Conversation not found') {
      return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
    }
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

exports.fetchLastMessage = async (req, res) => {
  const conversationId = req.query && req.query.id ? req.query.id : null;
  if (!conversationId) {
    return res.status(400).json({ status: 'error', message: 'Missing conversation ID.' });
  }

  const {conv, msg} = await conversationService.loadConversation(conversationId);
  res.json({message: msg[msg.length-1].content.text});
}

/*******************
 * EXTERNAL
 */
const ScheduleTaskService = require('../services/scheduleTaskService');
const { ExchangeRate } = require('../database');

exports.testConnect = async (req, res) => {
  res.json({status: "OK"});
};

exports.fetchFeedback = async (req, res) => {
  const {conv, msg} = await conversationService.loadConversation("689d3d435f68766cf42f085f");
  res.json({message: msg[msg.length-1].content.text});
}

exports.setTask = async (req, res) => {
  try {
    const { title, description, type, start, end, userId } = req.body;
    let doc = new Task({
      userId: userId ? userId : "Lennart",
      type,
      title,
      description,
      start: start ? ScheduleTaskService.roundToSlot(new Date(start)) : null,
      end: end ? ScheduleTaskService.roundToSlot(new Date(end)) : null,
      done: false,
    });
    await doc.save();
    res.json({status: "OK", doc});
  } catch(err) {
    res.json({status: "Failed", doc: null});
  }
};

/*******************
 * EXCHANGE RATES
 */
const isValidDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

exports.updateExchangeRates = async (req, res) => {
  const payload = req.body || {};
  const date = payload.date;
  const base = typeof payload.base === 'string' ? payload.base.trim().toUpperCase() : 'JPY';
  const amount = payload.amount === undefined ? 1 : Number(payload.amount);
  const ratesInput = payload.rates && typeof payload.rates === 'object' && !Array.isArray(payload.rates)
    ? payload.rates
    : null;

  if (!isValidDateKey(date)) {
    return res.status(400).json({ status: 'error', message: 'Invalid or missing date. Expected YYYY-MM-DD.' });
  }
  if (!/^[A-Z]{3}$/.test(base)) {
    return res.status(400).json({ status: 'error', message: 'Invalid base currency. Expected ISO code like JPY.' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid amount. Expected a positive number.' });
  }
  if (!ratesInput) {
    return res.status(400).json({ status: 'error', message: 'Missing rates object.' });
  }

  const rates = {};
  Object.entries(ratesInput).forEach(([code, value]) => {
    const currency = String(code || '').trim().toUpperCase();
    const rate = Number(value);
    if (!/^[A-Z]{3}$/.test(currency)) {
      return;
    }
    if (!Number.isFinite(rate)) {
      return;
    }
    rates[currency] = rate;
  });

  const currencyCount = Object.keys(rates).length;
  if (currencyCount === 0) {
    return res.status(400).json({ status: 'error', message: 'No valid currency rates provided.' });
  }

  try {
    const record = await ExchangeRate.findOneAndUpdate(
      { base, date },
      { $set: { base, date, amount, rates } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({
      status: 'saved',
      id: record._id,
      base,
      date,
      amount,
      rateCount: currencyCount,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
