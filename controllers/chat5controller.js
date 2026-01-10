const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const { AIModelCards, Chat4Model, Conversation4Model, Chat5Model, Conversation5Model, Chat4KnowledgeModel, FileMetaModel, Chat3TemplateModel, ChatPersonalityModel, ChatResponseTypeModel } = require('../database');
const utils = require('../utils/utils');
const openai = require('../utils/ChatGPT');
const anthropic = require('../utils/anthropic');
const logger = require('../utils/logger');

// Instantiate the services
const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const TemplateService = require('../services/templateService');
const TtsService = require('../services/ttsService');
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);
const ttsService = new TtsService();

function slugify(value, fallbackPrefix = 'preset') {
  if (typeof value !== 'string') {
    return `${fallbackPrefix}-${Date.now()}`;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : `${fallbackPrefix}-${Date.now()}`;
}

async function ensureUniqueSlug(Model, baseValue, fallbackPrefix) {
  const base = (baseValue && baseValue.length > 0) ? baseValue : slugify('', fallbackPrefix);
  let candidate = base;
  let attempt = 1;
  while (await Model.exists({ slug: candidate })) {
    candidate = `${base}-${attempt++}`;
  }
  return candidate;
}

function parseSortOrder(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function parseActiveFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}

let chat_models = [];

async function ensureChatModels() {
  if (Array.isArray(chat_models) && chat_models.length > 0) return chat_models;
  const models = await AIModelCards.find();
  const availableOpenAI = openai.GetOpenAIModels().map(d => d.model);
  chat_models = models.filter(d => (
    (d.provider === 'OpenAI' && availableOpenAI.indexOf(d.api_model) >= 0) ||
    d.provider === 'Local'
  ) && d.model_type === 'chat');
  return chat_models;
}

async function loadTtsVoicesSafe() {
  try {
    return await ttsService.getVoices();
  } catch (error) {
    logger.warning('Unable to refresh TTS voices for chat5', {
      category: 'chat5_tts',
      metadata: { message: error?.message || error },
    });
    return ttsService.getCachedVoices();
  }
}

function extractVisibleText(message) {
  if (!message || typeof message !== 'object' || !message.content) return '';
  const { text, transcript, revisedPrompt, toolOutput } = message.content;
  const candidates = [text, transcript, revisedPrompt, toolOutput];
  for (const entry of candidates) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return entry.trim();
    }
  }
  return '';
}

exports.index = async (req, res) => {
  // Load available OpenAI models
  const models = await AIModelCards.find();
  const availableOpenAI = openai.GetOpenAIModels().map(d => d.model);
  const availableAnthropic = anthropic.GetAnthropicModels().map(d => d.model);
  const usable_models = models.filter(d => (
    (d.provider === "OpenAI" && availableOpenAI.indexOf(d.api_model) >= 0) || 
    (d.provider === "Anthropic" && availableAnthropic.indexOf(d.api_model) >= 0) || 
    d.provider === "Google" || 
    d.provider === "Groq" || 
    (d.provider === "Local" && process.env.DISABLE_LOCAL != "TRUE")) && d.model_type === "chat");
  // Open conversation
  let conversationId = null;
  if (req.query.id && req.query.id.length > 0) {
    conversationId = req.query.id;
  }
  res.render("chat5", {models: usable_models, conversationId});
};

exports.ai_model_cards = async (req, res) => {
  const models = (await AIModelCards.find()).sort((a,b) => {
    if (a.model_type < b.model_type) return -1;
    if (a.model_type > b.model_type) return 1;
    if (a.output_1m_token_cost > b.output_1m_token_cost) return -1;
    if (a.output_1m_token_cost < b.output_1m_token_cost) return 1;
    if (a.input_1m_token_cost > b.input_1m_token_cost) return -1;
    if (a.input_1m_token_cost < b.input_1m_token_cost) return 1;
    if (a.model_name < b.model_name) return -1;
    if (a.model_name > b.model_name) return 1;
    return 0;
  });
  const formDefaults = {
    model_name: '',
    provider: '',
    api_model: '',
  };
  const allowedProviders = ['OpenAI', 'Anthropic', 'Google', 'Groq', 'Local'];
  if (typeof req.query.model === 'string' && req.query.model.trim().length > 0) {
    formDefaults.model_name = req.query.model.trim();
    formDefaults.api_model = req.query.model.trim();
  }
  if (typeof req.query.provider === 'string') {
    const provider = req.query.provider.trim();
    const matchedProvider = allowedProviders.find((value) => value.toLowerCase() === provider.toLowerCase());
    if (matchedProvider) {
      formDefaults.provider = matchedProvider;
    }
  }
  res.render('ai_model_cards', {models, formDefaults});
};

exports.add_model_card = async (req, res) => {
  // Prepare data
  const data = {
    model_name: req.body.model_name,
    provider: req.body.provider,
    api_model: req.body.api_model,
    input_1m_token_cost: parseFloat(req.body.input_1m_token_cost),
    output_1m_token_cost: parseFloat(req.body.output_1m_token_cost),
    model_type: req.body.model_type,
    in_modalities: utils.normalizeInputToArrayOfStrings(req.body.in_modalities),
    out_modalities: utils.normalizeInputToArrayOfStrings(req.body.out_modalities),
    max_tokens: parseInt(req.body.max_tokens),
    max_out_tokens: parseInt(req.body.max_out_tokens),
    added_date: new Date(),
    batch_use: req.body.batch_use != undefined && req.body.batch_use === "on",
    context_type: req.body.context_type
  }

  // Check if identical `provider` + `api_model` exist
  const existing = await AIModelCards.find({provider: req.body.provider, api_model: req.body.api_model});
  if (existing.length === 1) {
    // Exist -> Replace current entry
    existing[0].model_name = data.model_name;
    existing[0].input_1m_token_cost = data.input_1m_token_cost;
    existing[0].output_1m_token_cost = data.output_1m_token_cost;
    existing[0].model_type = data.model_type;
    existing[0].in_modalities = data.in_modalities;
    existing[0].out_modalities = data.out_modalities;
    existing[0].max_tokens = data.max_tokens;
    existing[0].max_out_tokens = data.max_out_tokens;
    existing[0].added_date = data.added_date;
    existing[0].batch_use = data.batch_use;
    existing[0].context_type = data.context_type;
    await existing[0].save();
  } else {
    // Unique entry -> Save as new entry to database
    await new AIModelCards(data).save();
  }

  res.redirect('/chat5/ai_model_cards');
};

exports.viewDraftingPresets = async (req, res) => {
  const [personalities, responseTypes] = await Promise.all([
    ChatPersonalityModel.find().sort({ sortOrder: 1, name: 1 }).lean(),
    ChatResponseTypeModel.find().sort({ sortOrder: 1, label: 1 }).lean(),
  ]);
  res.render('chat5_drafting_presets', { personalities, responseTypes });
};

exports.savePersonalityPreset = async (req, res) => {
  try {
    const { id, name, description, instructions } = req.body;
    const sortOrder = parseSortOrder(req.body.sort_order);
    const isActive = parseActiveFlag(req.body.is_active);
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedInstructions = typeof instructions === 'string' ? instructions.trim() : '';
    if (!trimmedName || !trimmedInstructions) {
      return res.redirect('/chat5/drafting-presets?error=missing-fields');
    }

    if (id) {
      const doc = await ChatPersonalityModel.findById(id);
      if (!doc) {
        return res.redirect('/chat5/drafting-presets?error=not-found');
      }
      doc.name = trimmedName;
      doc.description = typeof description === 'string' ? description.trim() : '';
      doc.instructions = trimmedInstructions;
      doc.sortOrder = sortOrder;
      doc.isActive = isActive;
      await doc.save();
    } else {
      const baseSlug = slugify(trimmedName, 'personality');
      const slug = await ensureUniqueSlug(ChatPersonalityModel, baseSlug, 'personality');
      await ChatPersonalityModel.create({
        name: trimmedName,
        slug,
        description: typeof description === 'string' ? description.trim() : '',
        instructions: trimmedInstructions,
        sortOrder,
        isActive,
      });
    }
    return res.redirect('/chat5/drafting-presets?success=personality');
  } catch (error) {
    logger.error('Failed to save chat personality', { error: error.message });
    return res.redirect('/chat5/drafting-presets?error=server');
  }
};

exports.deletePersonalityPreset = async (req, res) => {
  try {
    await ChatPersonalityModel.findByIdAndDelete(req.params.id);
    return res.redirect('/chat5/drafting-presets?success=personality-deleted');
  } catch (error) {
    logger.error('Failed to delete chat personality', { error: error.message });
    return res.redirect('/chat5/drafting-presets?error=server');
  }
};

exports.saveResponseTypePreset = async (req, res) => {
  try {
    const { id, label, description, instructions } = req.body;
    const sortOrder = parseSortOrder(req.body.sort_order);
    const isActive = parseActiveFlag(req.body.is_active);
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    const trimmedInstructions = typeof instructions === 'string' ? instructions.trim() : '';
    if (!trimmedLabel || !trimmedInstructions) {
      return res.redirect('/chat5/drafting-presets?error=missing-fields');
    }

    if (id) {
      const doc = await ChatResponseTypeModel.findById(id);
      if (!doc) {
        return res.redirect('/chat5/drafting-presets?error=not-found');
      }
      doc.label = trimmedLabel;
      doc.description = typeof description === 'string' ? description.trim() : '';
      doc.instructions = trimmedInstructions;
      doc.sortOrder = sortOrder;
      doc.isActive = isActive;
      await doc.save();
    } else {
      const baseSlug = slugify(trimmedLabel, 'response');
      const slug = await ensureUniqueSlug(ChatResponseTypeModel, baseSlug, 'response');
      await ChatResponseTypeModel.create({
        label: trimmedLabel,
        slug,
        description: typeof description === 'string' ? description.trim() : '',
        instructions: trimmedInstructions,
        sortOrder,
        isActive,
      });
    }
    return res.redirect('/chat5/drafting-presets?success=response-type');
  } catch (error) {
    logger.error('Failed to save chat response type', { error: error.message });
    return res.redirect('/chat5/drafting-presets?error=server');
  }
};

exports.deleteResponseTypePreset = async (req, res) => {
  try {
    await ChatResponseTypeModel.findByIdAndDelete(req.params.id);
    return res.redirect('/chat5/drafting-presets?success=response-type-deleted');
  } catch (error) {
    logger.error('Failed to delete chat response type', { error: error.message });
    return res.redirect('/chat5/drafting-presets?error=server');
  }
};

exports.story_mode = async (req, res) => {
  // Load a chat in "story" mode
  // 1. Fetch message history
  // 2. Extract last image in conversation and use as cover image
  // 3. Extract all audio in conversation and store in an array
  // 4. Display page to user (Cover image + "Chapter#1-n" for each audio file)
  const messages = await conversationService.getMessagesForConversation(req.params.id);
  let image = null;
  const audio = [];
  for (const m of messages) {
    if (m.images && m.images.length > 0 && !image) {
      image = m.images[m.images.length-1].filename;
    }
    if (m.sound && m.sound.length > 0) {
      audio.unshift(m.sound);
    }
  }
  res.render('story_mode', {image, audio});
};

exports.edit_message = async (req, res) => {
  const messageId = req.params.id;
  const message = await messageService.getMessageById(messageId);
  res.render('edit_message', {messageId, message});
};

exports.update_message = async (req, res) => {
  // Save uploaded images
  // Update message with id
  const messageId = req.params.id;
  const category = req.body.category;
  const tags = req.body.tags.split(", ").join(",").split(",");
  const prompt = req.body.prompt;
  const response = req.body.response;
  const images = req.body.images.length > 0 ? req.body.images.split(", ").join(",").split(",") : [];
  const sound = req.body.sound;
  const usage_settings = [];
  const keys = Object.keys(req.body);
  for (const key of keys) {
    if (key.indexOf(".") >= 0 && images.indexOf(key) >= 0) {
      usage_settings.push({
        filename: key,
        use_type: parseInt(req.body[key]),
      });
    }
  }
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }

  await messageService.updateMessage(messageId, category, tags, prompt, response, images, sound, usage_settings, image_paths);

  res.redirect(`/chat5/edit_message/${messageId}`);
};

exports.view_chat5_top = async (req, res) => {
  const user_id = req.user.name;
  // Load available OpenAI models
  const models = await AIModelCards.find();
  const availableOpenAI = openai.GetOpenAIModels().map(d => d.model);
  chat_models = models.filter(d => ((d.provider === "OpenAI" && availableOpenAI.indexOf(d.api_model) >= 0) || d.provider === "Local") && d.model_type === "chat");

  // Get both new and old conversations, and sort from new to old
  const conversations = await conversationService.listUserConversations(user_id);
  conversations.sort((a, b) => {
    if (a.updatedAt > b.updatedAt) return -1;
    if (a.updatedAt < b.updatedAt) return 1;
    return 0;
  });

  // Generate category list, sorted on average date of last 5 entries per category
  const categoryMap = new Map();
  for (const item of conversations) {
    const cat = item.category;
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    const arr = categoryMap.get(cat);
    // Only keep up to 5 newest items
    if (arr.length < 5) {
      arr.push(item);
    }
  }
  const categoryAverages = [];
  for (const [category, catItems] of categoryMap.entries()) {
    // Make sure updatedAt is treated as a Date (or a timestamp)
    const times = catItems.map((item) => new Date(item.updatedAt).getTime());
    const avg = times.reduce((acc, t) => acc + t, 0) / times.length;
    categoryAverages.push({ category, avgUpdatedAt: avg });
  }

  // Sort categories by average updatedAt descending (most recently updated categories first)
  categoryAverages.sort((a, b) => b.avgUpdatedAt - a.avgUpdatedAt);

  // Final result: just the sorted unique categories
  const sortedCategories = categoryAverages.map((e) => e.category);

  // Fetch pending requests
  const pending_conversation_ids = await conversationService.fetchPending();

  res.render("chat5_top", {conversations, sortedCategories, pending_conversation_ids});
};

const DEFAULT_CONVERSATION = {
  _id: "NEW",
  title: "NEW",
  summary: "New conversation",
  category: "Chat5",
  tags: ["chat5"],
  messages: [],
  metadata: {
    contextPrompt: "",
    model: "gpt-5.1-2025-11-13",
    maxMessages: 999,
    maxAudioMessages: 3,
    tools: [],
    reasoning: "medium",
    verbosity: "medium",
    outputFormat: "text",
  },
  members: [],
};

const renderer = new marked.Renderer();
function escapeHtml(str) { return str.replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":"'"}[c])); }
renderer.html = (html) => escapeHtml(html); // raw HTML in markdown becomes text
function looksLikeFullHtmlDocument(s) { return /<!doctype html/i.test(s) || /<html[\s>]/i.test(s) || /<head[\s>]/i.test(s) || /<body[\s>]/i.test(s); }

function renderMarkdownSafe(md) {
  if (looksLikeFullHtmlDocument(md)) {
  md = 'html\n' + md + '\n';
  }

  const html = marked.parse(md, { renderer });

  const clean = sanitizeHtml(html, {
    // Keep only what you want to allow in user content:
    allowedTags: [
      'p','em','strong','blockquote','a','ul','ol','li','pre','code','hr','br',
      'h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td'
    ],
    allowedAttributes: {
      a: ['href','title','target','rel'],
      code: ['class']
    },
    allowedSchemes: ['http','https','mailto'],
    // Important: escape any unexpected tags (e.g., someone typed <script>)
    disallowedTagsMode: 'escape',
    // Optionally normalize links to be safe:
    transformTags: {
      'a': (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' }
      })
    }
  });

  return clean;
}

exports.view_chat5 = async (req, res) => {
  const id = req.params.id;

  let conversation = undefined;
  let messages = undefined;
  let conversationSource = 'conversation5';

  if (id === "NEW") {
    conversation = null;
    messages = [];
    conversationSource = 'unsaved';
  } else {
    const data = await conversationService.loadConversation(id);
    conversation = data.conv;
    messages = data.msg;
    conversationSource = data.source || 'conversation5';
  }

  // Generate HTML from marked content
  messages.forEach(m => {
    if (m.content.text && m.content.text.length > 0) {
      m.content.html = renderMarkdownSafe(m.content.text);
    }
  })

  const [templates, personalities, responseTypes] = await Promise.all([
    templateService.getTemplates(),
    ChatPersonalityModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }),
    ChatResponseTypeModel.find({ isActive: true }).sort({ sortOrder: 1, label: 1 }),
  ]);
  const ttsVoices = await loadTtsVoicesSafe();
  res.render("chat5_chat", {
    conversation: conversation ? conversation : DEFAULT_CONVERSATION,
    messages,
    chat_models,
    templates,
    personalities,
    responseTypes,
    conversationSource,
    ttsVoices,
  });
};

exports.view_chat5_voice = async (req, res) => {
  const id = req.params.id;

  let conversation = undefined;
  let messages = [];
  let conversationSource = 'conversation5';

  if (id === 'NEW') {
    conversation = null;
    conversationSource = 'unsaved';
  } else {
    const data = await conversationService.loadConversation(id);
    conversation = data.conv;
    messages = data.msg;
    conversationSource = data.source || 'conversation5';
  }

  const formattedMessages = Array.isArray(messages) ? messages.map((m) => {
    const msg = typeof m?.toObject === 'function' ? m.toObject({ depopulate: true }) : m;
    if (msg && msg.content && msg.content.text && msg.content.text.length > 0) {
      msg.content.html = renderMarkdownSafe(msg.content.text);
    }
    if (msg && msg._id && typeof msg._id !== 'string') {
      msg._id = msg._id.toString();
    }
    return msg;
  }) : [];

  const visibleMessages = formattedMessages.filter((m) => m && !m.hideFromBot && m.contentType !== 'audio' && extractVisibleText(m).length > 0);
  const recentMessages = visibleMessages.slice(-2);

  const conversationPayload = conversation
    ? (typeof conversation.toObject === 'function' ? conversation.toObject({ depopulate: true }) : conversation)
    : { ...DEFAULT_CONVERSATION, metadata: { ...DEFAULT_CONVERSATION.metadata } };
  if (conversationPayload._id && typeof conversationPayload._id !== 'string') {
    conversationPayload._id = conversationPayload._id.toString();
  }
  if (!conversationPayload.metadata) {
    conversationPayload.metadata = { ...DEFAULT_CONVERSATION.metadata };
  } else {
    conversationPayload.metadata = { ...DEFAULT_CONVERSATION.metadata, ...conversationPayload.metadata };
  }

  const models = await ensureChatModels();
  const ttsVoices = await loadTtsVoicesSafe();

  res.render('chat5_voice', {
    conversation: conversationPayload,
    messages: recentMessages,
    chat_models: models,
    conversationSource,
    ttsVoices,
  });
};

exports.post_chat5 = async (req, res) => {
  let id = req.params.id;
  const user_id = req.user.name;

  // If new conversation
  if (id === "NEW") {
    const c = await conversationService.createNewConversation(user_id);
    id = c._id.toString();
  }

  // Update settings
  const conv = await Conversation5Model.findById(id);
  const tools = utils.normalizeInputToArrayOfStrings(req.body.tools);
  conv.metadata.tools = tools;
  if (req.body.model && req.body.model.length > 0) {
    conv.metadata.model = req.body.model;
  }
  await conv.save();

  // Post to conversation
  await conversationService.postToConversationNew({
    conversationId: id,
    userId: user_id,
    messageContent: {
      text: req.body.prompt,
      image: null,
      audio: null,
      tts: null,
      transcript: null,
      revisedPrompt: null,
      imageQuality: null,
      toolOutput: null,
    },
    messageType: "text",
    generateAI: req.body.generate_ai && req.body.generate_ai === "on" ? true : false,
  });

  const conversation = await Conversation5Model.findById(id);
  const messages = await Chat5Model.find({_id: conversation.messages});

  // Generate HTML from marked content
  messages.forEach(m => {
    if (m.content.text && m.content.text.length > 0) {
      m.content.html = marked.parse(m.content.text);
    }
  })

  const [templates, personalities, responseTypes] = await Promise.all([
    templateService.getTemplates(),
    ChatPersonalityModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }),
    ChatResponseTypeModel.find({ isActive: true }).sort({ sortOrder: 1, label: 1 }),
  ]);
  res.render("chat5_chat", {conversation, messages, chat_models, templates, personalities, responseTypes});
};
