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
  const user_id = req.user.name;

  const templates = await templateService.getTemplates();
  const conversations = await conversationService.getConversationsForUser(user_id);
  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);

  const categories = [];
  conversations.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
  });

  res.render("chat4", { conversations, categories, templates, knowledges });
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

exports.knowledgelist = async (req, res) => {
  const user_id = req.user.name;

  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);
  const categories = [];
  knowledges.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
  });

  res.render("knowledge_list", { knowledges, categories });
};

exports.viewknowledge = async (req, res) => {
  const knowledge_id = req.params.id;

  const knowledge = await knowledgeService.getKnowledgesById(knowledge_id);

  res.render("view_knowledge", { knowledge });
};

exports.saveknowledge = async (req, res) => {
  const title = req.body.k_title;
  const originConversationId = req.body.k_conversation_id;
  const contentMarkdown = req.body.k_content;
  const category = req.body.k_category;
  const tags = req.body.k_tags.split(', ').join(',').split(' ').join('_').split(',');
  const input_images = req.body.k_images.split(', ').join(',').split(' ').join('_').split(',');
  const user_id = req.user.name;

  const images = [];
  input_images.forEach(d => {
    if (d.length > 0) images.push(d);
  })
  const k_id = await knowledgeService.createKnowledge(title, originConversationId, contentMarkdown, category, tags, images, user_id);

  res.redirect(`/chat4/viewknowledge/${k_id}`);
};

exports.editknowledge = async (req, res) => {
  const knowledge_id = req.params.id;
  const knowledge = await knowledgeService.getKnowledgesById(knowledge_id);
  const conversation = await conversationService.getConversationsById(knowledge.originConversationId);
  const conversations = await conversationService.getConversationsInGroup(conversation.group_id);
  const messageLookup = [];
  for (let i = 0; i < conversations.length; i++) {
    for (let j = 0; j < conversations[i].messages.length; j++) {
      if (messageLookup.indexOf(conversations[i].messages[j]) === -1) {
        messageLookup.push(conversations[i].messages[j]);
      }
    }
  }
  const messages = await messageService.getMessagesByIdArray(messageLookup);

  res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations, messageLookup, messages});
};

exports.updateknowledge = async (req, res) => {
  const knowledge_id = req.params.id;

  // TODO Do the updating
  console.log(req.body);

  res.redirect(`/chat4/viewknowledge/${knowledge_id}`);
};
