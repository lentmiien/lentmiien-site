const marked = require('marked');// For formatting blog post entries
const sharp = require('sharp');// For getting image size
const fs = require('fs').promises;
const logger = require('../utils/logger');

const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const TemplateService = require('../services/templateService');
const KnowledgeService = require('../services/knowledgeService');
const EmbeddingApiService = require('../services/embeddingApiService');
const AgentService = require('../services/agentService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, Chat3TemplateModel, FileMetaModel, ArticleModel, AgentModel, BatchPromptModel, BatchRequestModel } = require('../database');
const { whisper, GetOpenAIModels } = require('../utils/ChatGPT');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const embeddingApiService = new EmbeddingApiService();
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel, embeddingApiService);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const templateService = new TemplateService(Chat3TemplateModel);
const agentService = new AgentService(AgentModel, conversationService, messageService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

// Globals
let categories = [];
let tags = [];
let knowledges_categories = [];

exports.index = async (req, res) => {
  const user_id = req.user.name;

  const templates = await templateService.getTemplates();
  const conversations = await conversationService.getConversationsForUser(user_id, {categories:["OCR"]});
  const knowledges = await knowledgeService.getKnowledgesByUser(user_id);
  const all_messages = [];//await messageService.getMessagesByUserId(user_id);// Removed due to large amount of data slowing down the page
  const agents = await agentService.getAgentAll();
  const inBatch = await batchService.getPromptConversationIds();

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
    d.batchCount = (d.batchCount || 0) + (inBatch.indexOf(d._id.toString()) >= 0 ? 1 : 0);
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

  const OpenAIModels = GetOpenAIModels();
  res.render("chat4", { conversations, categories, tags, templates, knowledges, knowledges_categories, all_messages, agents, OpenAIModels });
};

// JSON API endpoint
exports.updateconversation = async (req, res) => {
  res.json({updated_conversation_id: await conversationService.updateConversation(req.params.id, req.body)});
};

exports.doneconversation = async (req, res) => {
  res.json({updated_conversation_id: await conversationService.doneConversation(req.params.id)});
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
  const agents = await agentService.getAgentAll();

  // Knovledge id to index
  const knowledge_id_to_index = {};
  knowledges.forEach((d, i) => knowledge_id_to_index[d._id.toString()] = i);
  const used_knowledge_ids = [];
  conversation.knowledge_injects.forEach(d => used_knowledge_ids.push(d.knowledge_id));
  
  const OpenAIModels = GetOpenAIModels();
  res.render("chat4_conversation", { conversation, categories, tags, messages, templates, knowledges, knowledge_id_to_index, used_knowledge_ids, knowledges_categories, copy_conversations, agents, OpenAIModels });
};

function normalizeInput(input) {
  if (Array.isArray(input)) {
      // If the input is already an array, return it as-is
      return input;
  } else if (typeof input === 'string') {
      // If the input is a single string, wrap it in an array
      return [input];
  } else if (input === undefined) {
      // If the input is undefined, return an empty array
      return [];
  } else {
      // Optional: Handle unexpected input types
      throw new Error('Invalid input type. Expected an array, a string, or undefined.');
  }
}

exports.post = async (req, res) => {
  const user_id = req.user.name;
  let use_conversation_id = req.params.id;
  const reasoning_effort = req.body.reasoning_effort;
  const private_msg = req.body.private_msg === "on";
  const delete_messages = normalizeInput(req.body.del_message);// Array of message ids to remove from conversation

  // Check if copying is needed
  if ("start_message" in req.body || "end_message" in req.body) {
    use_conversation_id = await conversationService.copyConversation(use_conversation_id, req.body.start_message, req.body.end_message);
  }
  // Check if creating conversation from existing messages
  if ("append_message_ids" in req.body && req.body.append_message_ids.length > 0) {
    use_conversation_id = await conversationService.generateConversationFromMessages(user_id, req.body.append_message_ids.split(","));
  }
  // Post message to conversation
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }
  const conversation_id = await conversationService.postToConversation(user_id, use_conversation_id, image_paths, req.body, req.body.provider, reasoning_effort, private_msg, delete_messages);

  // Add summary request to batch process
  await batchService.addPromptToBatch({
    userId: user_id,
    conversationId,
    model: 'gpt-4.1-nano',
    title: req.body.title,
    taskType: 'summary',
  });

  res.redirect(`/chat4/chat/${conversation_id}`);
};

exports.ask_category = async (req, res) => {
  const user_id = req.user.name;
  const private_msg = req.body.private_msg === "on";

  // Post message to conversation
  const image_paths = [];
  for (let i = 0; i < req.files.length; i++) {
    image_paths.push(req.files[i].destination + req.files[i].filename);
  }
  const conversation_id = await conversationService.askCategory(user_id, image_paths, req.body, req.body.provider, parseInt(req.body.max_count), private_msg);

  // Add summary request to batch process
  await batchService.addPromptToBatch({
    userId: user_id,
    conversationId,
    model: 'gpt-4.1-nano',
    title: req.body.title,
    taskType: 'summary',
  });

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
  const instructions = req.body.sound_instructions;
  const message_id = req.body.sound_message_id;
  const model = req.body.sound_model;
  const voice = req.body.sound_voice;

  await messageService.generateTTS(message_id, prompt, model, voice, instructions);

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
    if (a.label > b.label) return 1;
    if (a.label < b.label) return -1;
    return 0;
  });

  res.render("knowledge_list", { knowledges, knowledge_categories, knowledge_tags });
};

exports.embed_all_knowledge = async (req, res) => {
  const user_id = req.user.name;

  try {
    const summary = await knowledgeService.embedAllKnowledges(user_id);
    res.json({
      ok: true,
      totalCount: summary.totalCount,
      embeddedCount: summary.embeddedCount,
      failedCount: summary.failed.length,
      failed: summary.failed,
    });
  } catch (error) {
    logger.error('Failed to embed knowledge entries', {
      category: 'knowledge',
      metadata: { user_id, message: error?.message || error },
    });
    res.status(500).json({ ok: false, error: 'Unable to embed knowledge entries right now.' });
  }
};

async function getImageDimensions(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {width: metadata.width, height: metadata.height};
  } catch (error) {
    logger.error('Error processing image:', error);
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
  const tags = req.body.k_tags.toLowerCase().split(', ').join(',').split(' ').join('_').split(',');
  const input_images = req.body.k_images.split(', ').join(',').split(' ').join('_').split(',');
  const user_id = req.user.name;

  const images = [];
  input_images.forEach(d => {
    if (d.length > 0) images.push(d);
  })
  const k_id = await knowledgeService.createKnowledge(title, originConversationId, contentMarkdown, category, tags, images, user_id);

  res.redirect(`/chat4/viewknowledge/${k_id}`);
};

exports.createknowledgefromchat = async (req, res) => {
  const knowledge_id = "new";
  const knowledge = {
    title: "new",
    createdDate: new Date(),
    updatedDate: new Date(),
    originConversationId: req.params.id,
    originType: 'chat4',
    contentMarkdown: "",
    category: "new",
    tags: ["new"],
    images: [],
    user_id: req.user.name,
  };
  const conversation = await conversationService.getConversationsById(req.params.id);
  if (conversation) {
    knowledge.title = conversation.title;
    knowledge.category = conversation.category;
    knowledge.tags = conversation.tags;
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
    // Try chat5 format
    try {
      const { conv, msg } = await conversationService.loadConversation(req.params.id);
      if (conv) {
        // Mark as chat5-origin
        knowledge.originType = 'chat5';
        knowledge.title = conv.title;
        knowledge.category = conv.category;
        knowledge.tags = conv.tags;

        // Filter to only text and image content and transform to chat4-like for view
        const filtered = msg.filter(m => m.contentType === 'text' || m.contentType === 'image');
        const transformed = [];
        let current = null;
        const pushCurrent = () => {
          if (current && (current.prompt.length > 0 || current.response.length > 0 || current.images.length > 0 || (current.sound && current.sound.length > 0))) {
            transformed.push(current);
          }
          current = null;
        };
        for (const m of filtered) {
          if (m.contentType === 'text') {
            if (m.user_id === 'bot') {
              if (!current) current = { prompt: '', response: '', images: [], sound: '' };
              if (current.response && current.response.length > 0) {
                pushCurrent();
                current = { prompt: '', response: '', images: [], sound: '' };
              }
              current.response = (current.response ? current.response + '\n' : '') + (m.content.text || '');
            } else {
              if (current && (current.prompt.length > 0 || current.response.length > 0 || current.images.length > 0)) {
                pushCurrent();
              }
              current = { prompt: m.content.text || '', response: '', images: [], sound: '' };
            }
          } else if (m.contentType === 'image') {
            const img = {
              filename: m.content.image,
              use_flag: m.hideFromBot ? 'do not use' : (m.content.imageQuality === 'high' ? 'high quality' : 'low quality'),
            };
            if (!current) current = { prompt: '', response: '', images: [img], sound: '' };
            else current.images.push(img);
          }
        }
        pushCurrent();

        // Build a minimal conversation wrapper as expected by the view
        const messageLookup = transformed.map((_, i) => `chat5-${i}`);
        const conversations = [{
          _id: conv._id,
          messages: messageLookup,
        }];

        res.render("edit_knowledge", { id: knowledge_id, knowledge, conversations, messageLookup, messages: transformed });
      } else {
        res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations: [], messageLookup: [], messages: []});
      }
    } catch (e) {
      res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations: [], messageLookup: [], messages: []});
    }
  }
};

exports.editknowledge = async (req, res) => {
  const knowledge_id = req.params.id;
  const knowledge = await knowledgeService.getKnowledgesById(knowledge_id);
  if (knowledge.originType === 'chat5') {
    // Load chat5 content
    try {
      const { conv, msg } = await conversationService.loadConversation(knowledge.originConversationId);
      if (conv) {
        // Filter to only text and image and transform
        const filtered = msg.filter(m => m.contentType === 'text' || m.contentType === 'image');
        const transformed = [];
        let current = null;
        const pushCurrent = () => {
          if (current && (current.prompt.length > 0 || current.response.length > 0 || current.images.length > 0 || (current.sound && current.sound.length > 0))) {
            transformed.push(current);
          }
          current = null;
        };
        for (const m of filtered) {
          if (m.contentType === 'text') {
            if (m.user_id === 'bot') {
              if (!current) current = { prompt: '', response: '', images: [], sound: '' };
              if (current.response && current.response.length > 0) {
                pushCurrent();
                current = { prompt: '', response: '', images: [], sound: '' };
              }
              current.response = (current.response ? current.response + '\n' : '') + (m.content.text || '');
            } else {
              if (current && (current.prompt.length > 0 || current.response.length > 0 || current.images.length > 0)) {
                pushCurrent();
              }
              current = { prompt: m.content.text || '', response: '', images: [], sound: '' };
            }
          } else if (m.contentType === 'image') {
            const img = {
              filename: m.content.image,
              use_flag: m.hideFromBot ? 'do not use' : (m.content.imageQuality === 'high' ? 'high quality' : 'low quality'),
            };
            if (!current) current = { prompt: '', response: '', images: [img], sound: '' };
            else current.images.push(img);
          }
        }
        pushCurrent();

        const messageLookup = transformed.map((_, i) => `chat5-${i}`);
        const conversations = [{ _id: conv._id, messages: messageLookup }];

        res.render("edit_knowledge", { id: knowledge_id, knowledge, conversations, messageLookup, messages: transformed });
      } else {
        res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations: [], messageLookup: [], messages: []});
      }
    } catch (e) {
      res.render("edit_knowledge", {id: knowledge_id, knowledge, conversations: [], messageLookup: [], messages: []});
    }
  } else {
    // Default: chat4 content
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
  }
};

exports.updateknowledge = async (req, res) => {
  let knowledge_id = req.params.id;
  const title = req.body.k_title;
  const originConversationId = req.body.k_originConversationId;
  const originType = req.body.k_originType ? req.body.k_originType : 'chat4';
  const contentMarkdown = req.body.k_content;
  const category = req.body.k_category;
  const tags = req.body.k_tags.toLowerCase().split(', ').join(',').split(' ').join('_').split(',');
  const input_images = req.body.k_images.split(', ').join(',').split(' ').join('_').split(',');
  const user_id = req.user.name;

  const images = [];
  input_images.forEach(d => {
    if (d.length > 0) images.push(d);
  });
  if (knowledge_id === "new") {
    knowledge_id = await knowledgeService.createKnowledge(title, originConversationId, contentMarkdown, category, tags, images, user_id, originType);
  } else {
    await knowledgeService.updateKnowledge(knowledge_id, title, contentMarkdown, category, tags, images);
  }

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

exports.prompt_assist = async (req, res) => {
  const user_id = req.user.name;
  const parameters = {
    tags: "prompt_assist",
    category: req.body.category,
    prompt: req.body.messages[req.body.messages.length-1].content[0].text,
  }
  const resp = await messageService.createMessage(true, req.body.messages, null, user_id, parameters, []);
  res.json({response: resp.db_entry.response});
};

exports.create_agent = async (req, res) => {
  const name = req.body.ca_name;
  const description = req.body.ca_description;
  const context = req.body.ca_context;
  const start_memory = req.body.ca_start_memory;
  await agentService.createAgent(name, description, context, start_memory);
  res.redirect('/chat4');
};

exports.teach_agent = async (req, res) => {
  // teachAgent(agent_id, messages, user_id, category)
  const agent_id = req.body.ca_agent_id;
  const messages = req.body.messages;
  const user_id = req.user.name;
  const category = req.body.category;
  const response = await agentService.teachAgent(agent_id, messages, user_id, category);
  res.json({response});
};

exports.ask_agent = async (req, res) => {
  // askAgent(agent_id, messages, user_id, category)
  const conversation_id = req.body.conversation_id;
  const agent_id = req.body.ca_agent_id;
  const messages = req.body.messages;
  const user_id = req.user.name;
  const category = req.body.category;
  const response = await agentService.askAgent(conversation_id, agent_id, messages, user_id, category);
  res.json({response});
};

const batch_model_list = {
  "OpenAI_latest": "gpt-4o-2024-11-20",
  "OpenAI_mini": "gpt-4o-mini",
  "OpenAI": "gpt-4o",
  "Anthropic": "claude-3-5-sonnet-20241022",
  "o1-preview-2024-09-12": "o1-preview-2024-09-12",
  "o1-mini-2024-09-12": "o1-mini-2024-09-12",
};

// Batch requests
exports.batch_prompt = async (req, res) => {
  if (req.body.provider in batch_model_list) {
    // Get image file paths
    const image_paths = [];
    for (let i = 0; i < req.files.length; i++) {
      image_paths.push(req.files[i].destination + req.files[i].filename);
    }
    
    await batchService.addPromptToBatch(req.user.name, req.body.prompt, req.params.id, image_paths, req.body, batch_model_list[req.body.provider]);
    
    res.redirect('/chat4/batch_status');
  } else {
    res.send(`<h1>Selected model (${req.body.provider}) invalid for batch requests</h1><b>Prompt</b><br><pre>${req.body.prompt}</pre>`);
  }
};

exports.batch_status = async (req, res) => {
  // Check status of prompts in batch processing
  // Check if any batches are ready in OpenAI's API, in which case download results and save to batch database
  // Button: Start batch process
  // Button: Import completed prompts to chat database
  const status = await batchService.getAll();

  res.render('batch_status', status);
};

exports.batch_start = async (req, res) => {
  const processed = await batchService.triggerBatchRequest();
  res.json(processed);
};

exports.batch_update = async (req, res) => {
  // Check for status on batch request
  const status = await batchService.checkBatchStatus(req.params.id);
  res.json(status);
};

exports.batch_import = async (req, res) => {
  // Take all completed prompts, that has not yet been imported and import responses in chat database
  const status = await batchService.processBatchResponses();
  res.json(status);
};

exports.batch_prompt_delete = async (req, res) => {
  const id = req.params.id;
  await batchService.deletePromptById(id);
  res.redirect('/chat4/batch_status');
};

exports.redact_page = async (req, res) => {
  const message = await messageService.getMessageById(req.params.id);
  res.render("redact_page", {message, conversation_id: req.query.conversation});
}

// Fixes GitHub issue #2: Redaction
exports.redact_post = async (req, res) => {
  try {
    const { promptLines, responseLines, redactImages, redactAudio } = req.body;
    const message = await messageService.getMessageById(req.params.id);
    // Prompt
    if (promptLines && promptLines.length) {
      const lines_array = Array.isArray(promptLines) ? promptLines : [promptLines];
      const lines = message.prompt.split('\n');
      lines_array.forEach((index) => {
        const i = parseInt(index);
        lines[i] = '(redacted)  ';
      });
      message.prompt = lines.join('\n');
    }
    // Response
    if (responseLines && responseLines.length) {
      const lines_array = Array.isArray(responseLines) ? responseLines : [responseLines];
      const lines = message.response.split('\n');
      lines_array.forEach((index) => {
        const i = parseInt(index);
        lines[i] = '(redacted)  ';
      });
      message.response = lines.join('\n');
    }
    // Images [image-1716544082239-.jpg
    if (redactImages && redactImages.length) {
      const redacted_images = [];
      const lines_array = Array.isArray(redactImages) ? redactImages : [redactImages];
      lines_array.forEach((index) => {
        const i = parseInt(index);
        redacted_images.push(message.images[i].filename);
        message.images[i].filename = "image-1716544082239-.jpg";
        message.images[i].use_flag = "do not use";
      });
      // Delete redacted images
      for (let i = 0; i < redacted_images.length; i++) {
        if (redacted_images[i] != "image-1716544082239-.jpg") {
          await fs.unlink(`./public/img/${redacted_images[i]}`);
        }
      }
    }
    // Audio [sound-1716878864152-.mp3]
    if ('redactAudio' in req.body) {
      // Delete redacted sound
      if (message.sound != "sound-1716878864152-.mp3") {
        await fs.unlink(`./public/mp3/${message.sound}`);
        message.sound = "sound-1716878864152-.mp3";
      }
    }
    await message.save();
    res.redirect(`/chat4/chat/${req.body.conversation_id}`);
  } catch (error) {
    logger.notice(error);
    res.redirect(`/chat4/redact/${req.params.id}`);
  }
}

// Fetch messages API
// Previously the functionality to append previous messages was disabled due to instabillity issues with the amount of data being loaded, with this new API, only the necessary data will be loaded when the user needs it, solving the problem, and re-introducing the functionality to append previous messages to conversations
exports.fetch_messages = async (req, res) => {
  const user_id = req.user.name;
  const category = req.query.category;
  const tag = req.query.tag;
  const keyword = req.query.keyword;

  const messages = await messageService.fetchMessages(user_id, category ? category : null, tag ? tag : null, keyword ? keyword : null);

  res.json(messages);
};

exports.generateTagsForRecipe = async (req, res) => {
  const user_id = req.user.name;
  const title = req.body.title;
  const content = req.body.content;
  const messages = [];
  const recipe = `# ${title}\n\n${content}`;

  // "67d62f9e0a6afb9d5f73215e" - System message
  // "67d62fb80a6afb9d5f732160" - Chat template: replace "[PASTE YOUR RECIPE HERE]" with actual recipe
  const k = await templateService.getTemplatesByIdArray(["67d62f9e0a6afb9d5f73215e", "67d62fb80a6afb9d5f732160"]);
  let systemTemplate = "";
  let messageTemplate = "";
  for (let i = 0; i < k.length; i++) {
    if (k[i]._id.toString() === "67d62f9e0a6afb9d5f73215e") {
      systemTemplate = k[i].TemplateText;
    }
    if (k[i]._id.toString() === "67d62fb80a6afb9d5f732160") {
      messageTemplate = k[i].TemplateText;
    }
  }
  const user_prompt = messageTemplate.split("[PASTE YOUR RECIPE HERE]").join(recipe);

  messages.push({
    role: 'system',
    content: systemTemplate,
  });
  messages.push({
    role: 'user',
    content: user_prompt,
  });

  const response = await messageService.createMessage(null, messages, null, user_id, {tags:"tagger", category:"Tagger", prompt:user_prompt}, [], "o3-mini-2025-01-31", "low", false);
  res.json(response.db_entry);
};

exports.templates_top = async (req, res) => {
  const templates = await templateService.getTemplates();
  res.render("templates_top", {templates});
};

exports.templates_edit = async (req, res) => {
  const templateId = req.body.id === "new" ? null : req.body.id;
  const title = req.body.title;
  const type = req.body.type;
  const category = req.body.category;
  const text = req.body.text;

  if (templateId) {
    await templateService.updateTemplate(templateId, title, type, category, text);
  } else {
    await templateService.createTemplate(title, type, category, text);
  }

  res.redirect("/chat4/templates");
};

exports.templates_delete = async (req, res) => {
  const templateId = req.body.id_to_delete;

  if (templateId && templateId.length > 0) {
    await templateService.deleteTemplateById(templateId);
  }

  res.redirect("/chat4/templates");
};

/*****
 * TOOLS TEST
 */
exports.generate_image_tool = async (req, res) => {
  const user_id = req.user.name;
  const conversation_id = req.params.id;
  await conversationService.postToConversationTool(user_id, conversation_id, req.body)
  res.redirect(`/chat4/chat/${conversation_id}`);
};

/*****
 * Whisper TEST
 */
exports.voice_recorder_upload = async (req, res) => {
  const text = await whisper(`./${req.file.path}`);
  res.send(text);
};
