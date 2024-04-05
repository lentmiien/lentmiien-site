const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const { Chat4Model, Conversation4Model, Chat3TemplateModel, FileMetaModel } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model);
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
  const quality = "hd";//TODO expose to user [standard / hd]
  const size = "1024x1024";//TODO expose to user [1024x1024 / 1792x1024 / 1024x1792]

  try {
    // Take input and generate OpenAI API request
    // Send API request and wait for response
    // Save file to folder './public/img/{filename}'
    const { filename, prompt } = await ig(in_prompt, quality, size);
    // Save entry in FileMetaModel database
    const entry = {
      filename: filename,
      filetype: "image",
      path: `/img/${filename}`,
      is_url: false,
      prompt: prompt,
      created_date: new Date(),
      other_meta_data: JSON.stringify({ quality, size, source: "OpenAI: DALL·E 3" }),
    };
    await new FileMetaModel(entry).save();
    // Update Chat4 entry with file data
    const message = await Chat4Model.findById(message_id);
    message.images.push({
      filename,
      use_flag: 'do not use'
    });
    await message.save();
    // Reload page
    res.redirect(`/chat4/chat/${conversation_id}`);
  } catch (err) {
    console.log('Failed to generate image: ', err);
    res.send(`<html><body><a href="/">Top</a><br><b>Error processing request</b><pre>${JSON.stringify(err, null, 2)}</pre></body></html>`);
  }
};

exports.generate_sound = (req, res) => {
  const conversation_id = req.params.id;
  const prompt = req.body.sound_prompt;
  const message_id = req.body.sound_message_id;

  console.log(conversation_id, prompt, message_id);

  res.redirect(`/chat4/chat/${req.params.id}`);
};
