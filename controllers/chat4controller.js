const marked = require('marked');// For formatting blog post entries
const sharp = require('sharp');// For getting image size

const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const KnowledgeService = require('../services/knowledgeService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, Chat3TemplateModel, FileMetaModel, ArticleModel } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);

// Globals
let categories = [];
let tags = [];
let knowledges_categories = [];

exports.index = async (req, res) => {
  const user_id = req.user.name;

  const templates = await templateService.getTemplates();
  const conversations = await conversationService.getConversationsForUser(user_id);
  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);
  const all_messages = await messageService.getMessagesByUserId(user_id);// For appending existing messages to a new conversation

  // Get all categories and tags
  categories = [];
  tags = [];
  const tags_lookup = [];
  conversations.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
    d.tags.forEach(t => {
      const index = tags_lookup.indexOf(t);
      if (index === -1) {
        tags_lookup.push(t);
        tags.push({
          label: t,
          count: 1
        });
      } else {
        tags[index].count++;
      }
    });
  });
  all_messages.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
    d.tags.forEach(t => {
      if (tags_lookup.indexOf(t) === -1) {
        tags_lookup.push(t);
        tags.push({
          label: t,
          count: 1
        });
      }
    });
  });
  tags.sort((a,b) => {
    if (a.count > b.count) return -1;
    if (a.count < b.count) return 1;
    return 0;
  });
  knowledges_categories = [];
  knowledges.forEach(d => {
    if (knowledges_categories.indexOf(d.category) === -1) knowledges_categories.push(d.category);
  });

  res.render("chat4", { conversations, categories, tags, templates, knowledges, knowledges_categories, all_messages });
};

// JSON API endpoint
exports.updateconversation = async (req, res) => {
  res.json({updated_conversation_id: await conversationService.updateConversation(req.params.id, req.body)});
};

exports.chat = async (req, res) => {
  const user_id = req.user.name;

  const conversation = await conversationService.getConversationsById(req.params.id);
  if (!conversation) return res.redirect(`/chat3?chat=${req.params.id}`);// Ensure that app works with transferred data

  const templates = await templateService.getTemplates();
  const group_conversations = await conversationService.getConversationsInGroup(conversation.group_id);
  const copy_conversations = group_conversations.filter(d => d._id.toString() != conversation._id.toString());
  const messages = await messageService.getMessagesByIdArray(conversation.messages);
  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);

  // Knovledge id to index
  const knowledge_id_to_index = {};
  knowledges.forEach((d, i) => knowledge_id_to_index[d._id.toString()] = i);
  const used_knowledge_ids = [];
  conversation.knowledge_injects.forEach(d => used_knowledge_ids.push(d.knowledge_id));
  
  res.render("chat4_conversation", { conversation, categories, tags, messages, templates, knowledges, knowledge_id_to_index, used_knowledge_ids, knowledges_categories, copy_conversations });
};

exports.post = async (req, res) => {
  let use_conversation_id = req.params.id;

  // Check if copying is needed
  if ("start_message" in req.body || "end_message" in req.body) {
    use_conversation_id = await conversationService.copyConversation(use_conversation_id, req.body.start_message, req.body.end_message);
  }
  // Check if creating conversation from existing messages
  if ("append_message_ids" in req.body && req.body.append_message_ids.length > 0) {
    use_conversation_id = await conversationService.generateConversationFromMessages(req.user.name, req.body.append_message_ids.split(","));
  }
  // Post message to conversation
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }
  const conversation_id = await conversationService.postToConversation(req.user.name, use_conversation_id, image_paths, req.body);

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.delete_conversation = async (req, res) => {
  const user_id = req.user.name;
  const id_to_delete = req.params.id;

  // Protection so that if a knowledge entry links to the conversation, then can't delete, show error message instead
  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);
  const locked_ids = [];
  knowledges.forEach(d => locked_ids.push(d.originConversationId));

  const index = locked_ids.indexOf(id_to_delete);
  if (index === -1) {
    await conversationService.deleteConversation(id_to_delete);
    res.redirect('/chat4');
  } else {
    res.render("error_page", {error: `Can't delete conversation [${id_to_delete}], as knowledge entry [${knowledges[index].title}] refers to this conversation.`})
  }
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

exports.generate_custom_message = async (req, res) => {
  const user_id = req.user.name;
  const prompt = req.body.cm_prompt;
  const response = req.body.cm_response;
  const category = req.body.cm_category;

  await messageService.CreateCustomMessage(prompt, response, user_id, category, []);

  res.redirect('/chat4');
};

exports.knowledgelist = async (req, res) => {
  const user_id = req.user.name;

  let knowledges = await knowledgeService.getKnowledgesByUser(user_id);

  // Page can be opened with category in query parameters, in which case only that category will be shown
  if ("category" in req.query) {
    knowledges = knowledges.filter(d => d.category === req.query.category);
  }

  const knowledge_categories = [];
  const knowledge_tags = [];
  const tags_lookup = [];

  knowledges.forEach(d => {
    if (knowledge_categories.indexOf(d.category) === -1) {
      knowledge_categories.push(d.category);
    }
    d.tags.forEach(t => {
      const index = tags_lookup.indexOf(t);
      if (index === -1) {
        tags_lookup.push(t);
        knowledge_tags.push({
          label: t,
          count: 1
        });
      } else {
        knowledge_tags[index].count++;
      }
    });
  });
  knowledge_tags.sort((a,b) => {
    if (a.count > b.count) return -1;
    if (a.count < b.count) return 1;
    return 0;
  });

  res.render("knowledge_list", { knowledges, knowledge_categories, knowledge_tags });
};

async function getImageDimensions(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {width: metadata.width, height: metadata.height};
  } catch (error) {
    console.error('Error processing image:', error);
    return undefined;
  }
}

exports.viewknowledge = async (req, res) => {
  const knowledge_id = req.params.id;

  const knowledge = await knowledgeService.getKnowledgesById(knowledge_id);

  // Update og/twitter title meta tags
  res.locals.og_title = `Lennart's Website - ${knowledge.title}`;
  res.locals.twitter_title = `Lennart's Website - ${knowledge.title}`;
  // If any images attached to knowledge entry, update og/twitter image meta tags to first image
  if (knowledge.images.length > 0) {
    const filename = knowledge.images[0];
    const size = await getImageDimensions(`./public/img/${filename}`);
    if (size) {
      // Get file meta data
      const metadata = await FileMetaModel.find({filename});
      res.locals.og_image = `https://home.lentmiien.com/img/${filename}`;
      res.locals.og_image_width = size.width.toString();
      res.locals.og_image_height = size.height.toString();
      res.locals.twitter_image = `https://home.lentmiien.com/img/${filename}`;
      res.locals.twitter_image_alt = metadata.length > 0 ? metadata[0].prompt : `Image of ${knowledge.title}${filename.indexOf("image-") === 0 ? ", created using OpenAI's' DALL·E image generation" : ""}`;
    }
  }

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
  if (conversation) {
    const conversations = await conversationService.getConversationsInGroup(conversation.group_id);
    const messageLookup = [];
    for (let i = 0; i < conversations.length; i++) {
      for (let j = 0; j < conversations[i].messages.length; j++) {
        if (messageLookup.indexOf(conversations[i].messages[j]) === -1) {
          messageLookup.push(conversations[i].messages[j]);
        }
      }
    }
    const messages = await messageService.getMessagesByIdArray(messageLookup, false);
    messageLookup.reverse();
    
    res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations, messageLookup, messages});
  } else {
    res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations: [], messageLookup: [], messages: []});
  }
};

exports.updateknowledge = async (req, res) => {
  const knowledge_id = req.params.id;
  const title = req.body.k_title;
  const contentMarkdown = req.body.k_content;
  const category = req.body.k_category;
  const tags = req.body.k_tags.split(', ').join(',').split(' ').join('_').split(',');
  const input_images = req.body.k_images.split(', ').join(',').split(' ').join('_').split(',');

  const images = [];
  input_images.forEach(d => {
    if (d.length > 0) images.push(d);
  });
  await knowledgeService.updateKnowledge(knowledge_id, title, contentMarkdown, category, tags, images);

  res.redirect(`/chat4/viewknowledge/${knowledge_id}`);
};

exports.deleteknowledge = async (req, res) => {
  const knowledge_id = req.params.id;
  await knowledgeService.deleteKnovledgeById(knowledge_id);
  res.redirect('/chat4/knowledgelist');
};

exports.postblog = (req, res) => {
  // New entry
  const entry_to_save = new ArticleModel({
    title: req.body.b_title,
    category: req.body.b_category,
    content: marked.parse(req.body.b_content),
    created: new Date(),
    updated: new Date(),
  });

  // Save to database
  entry_to_save.save().then((saved_data) => {
    setTimeout(() => res.redirect(`/blog`), 100);
  });
};

exports.fetch_messages = async (req, res) => {
  const messages = await messageService.getMessagesByIdArray(req.body.ids);
  const output = {};
  messages.forEach(d => {
    output[d._id.toString()] = d.response_html;
  });
  res.json(output);
};
