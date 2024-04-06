const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const { Chat4Model, Conversation4Model, Chat3TemplateModel, FileMetaModel } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const conversationService = new ConversationService(Conversation4Model, messageService);
const templateService = new TemplateService(Chat3TemplateModel);

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const marked = require('marked');
const { chatGPT, embedding, GetModels, tts, ig } = require('../utils/ChatGPT');

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
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }
  const conversation_id = await conversationService.postToConversation(req.user.name, req.params.id, image_paths, req.body);
  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.generate_image = async (req, res) => {
  const conversation_id = req.params.id;
  const in_prompt = req.body.image_prompt;
  const message_id = req.body.image_message_id;
  const quality = req.body.image_quality;
  const size = req.body.image_size;

  const message = await messageService.generateImage(message_id, in_prompt, quality, size);

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.generate_sound = async (req, res) => {
  const conversation_id = req.params.id;
  const prompt = req.body.sound_prompt;
  const message_id = req.body.sound_message_id;
  const model = req.body.sound_model;
  const voice = req.body.sound_voice;

  const message = await messageService.generateTTS(message_id, prompt, model, voice);

  res.redirect(`/chat4/chat/${conversation_id}`);
};