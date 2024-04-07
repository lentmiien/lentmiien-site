const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const KnowledgeService = require('../services/knowledgeService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, Chat3TemplateModel, FileMetaModel } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);

exports.index = async (req, res) => {
  const templates = await templateService.getTemplates();
  const conversations = await conversationService.getConversationsForUser(req.user.name);

  const categories = [];
  conversations.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
  });

  res.render("chat4", { conversations, categories, templates });
};

exports.chat = async (req, res) => {
  const templates = await templateService.getTemplates();
  const conversation = await conversationService.getConversationsById(req.params.id);
  const messages = await messageService.getMessagesByIdArray(conversation.messages);
  
  res.render("chat4_conversation", { conversation, messages, templates });
};

exports.post = async (req, res) => {
  let use_conversation_id = req.params.id;

  // Check if copying is needed
  if ("start_message" in req.body || "end_message" in req.body) {
    use_conversation_id = await conversationService.copyConversation(use_conversation_id, req.body.start_message, req.body.end_message);
  }
  // Post message to conversation
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }
  const conversation_id = await conversationService.postToConversation(req.user.name, use_conversation_id, image_paths, req.body);

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.generate_image = async (req, res) => {
  const conversation_id = req.params.id;
  const in_prompt = req.body.image_prompt;
  const message_id = req.body.image_message_id;
  const quality = req.body.image_quality;
  const size = req.body.image_size;

  await messageService.generateImage(message_id, in_prompt, quality, size);

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.generate_sound = async (req, res) => {
  const conversation_id = req.params.id;
  const prompt = req.body.sound_prompt;
  const message_id = req.body.sound_message_id;
  const model = req.body.sound_model;
  const voice = req.body.sound_voice;

  await messageService.generateTTS(message_id, prompt, model, voice);

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.saveknowledge = async (req, res) => {
  const user_id = req.user.name;
  const other_parameters = null;// TODO: replace with actual functionality

  knowledgeService.createKnowledge(user_id, other_parameters);

  res.send("OK!");// TODO: redirect to newly created knowledge page
};
