const fs = require('fs');
const sharp = require('sharp');
const logger = require('../utils/logger');

const { Conversation5Model, PendingRequests } = require('../database');

// Conversation5Model.metadata
const DEFAULT_SETTINGS = {
  contextPrompt: "",
  model: "gpt-5-2025-08-07",
  maxMessages: 999,
  maxAudioMessages: 3,
  tools: [],
  reasoning: "medium",
  verbosity: "medium",
  outputFormat: "text",
};

// Default conversation properties
const DEFAULT_PROPERTY = {
  title: "NEW",
  category: "Chat5",
  tags: [ "chat5" ],
  members: [],
};

// Conversation service operations: managing conversation sessions and summary
class ConversationService {
  constructor(conversationModel, messageService, knowledgeService) {
    this.conversationModel = conversationModel;
    this.messageService = messageService;
    this.knowledgeService = knowledgeService;

    this.categoryList = [];
    this.tagList = [];
  }

  async generateCategoryList() {
    const conversations = await this.conversationModel.find();
    for (let i = 0; i < conversations.length; i++) {
      if (this.categoryList.indexOf(conversations[i].category) === -1) {
        this.categoryList.push(conversations[i].category);
      }
    }
    this.categoryList.sort();
  }

  async getCategories() {
    if (this.categoryList.length === 0) {
      await this.generateCategoryList();
    }
    return this.categoryList;
  }

  async generateTagList() {
    const conversations = await this.conversationModel.find();
    for (let i = 0; i < conversations.length; i++) {
      if (conversations[i].tags) {
        for (let j = 0; j < conversations[i].tags.length; j++) {
          if (this.tagList.indexOf(conversations[i].tags[j]) === -1) {
            this.tagList.push(conversations[i].tags[j]);
          }
        }
      }
    }
    this.tagList.sort();
  }

  async getTags() {
    if (this.tagList.length === 0) {
      await this.generateTagList();
    }
    return this.tagList;
  }

  async getMessagesForConversation(id) {
    const conversation = await this.conversationModel.findById(id);
    const messages = await this.messageService.getMessagesByIdArray(conversation.messages, false);
    return messages;
  }

  async getConversationsForUser(user_id, params=null) {
    const conversations = await this.conversationModel.find({user_id}).sort({ updated_date: -1 }).exec();
    if (params) {
      const _2week_ = new Date(Date.now() - (1000*60*60*24*14));
      return conversations.filter(d => {
        if (params.categories.indexOf(d.category) >= 0) {
          if (d.updated_date > _2week_) return true;
          else return false;
        } else {
          return true;
        }
      });
    } else {
      return conversations;
    }
  }

  async get50LastUpdatedConversationsForUser(user_id) {
    const find_query = {
      user_id
    };

    const conversations = await this.conversationModel.find(find_query).sort({ updated_date: -1 }).exec();

    return conversations.filter((d, i) => i < 50);
  }

  async getConversationsForUserQuery(user_id, query) {
    const find_query = {
      user_id
    };
    if (query.category.length > 0) find_query.category = query.category;

    const conversations = await this.conversationModel.find(find_query).sort({ updated_date: -1 }).exec();

    if (query.tags.length > 0) {
      return conversations.filter(d => d.tags.includes(query.tags));
    } else {
      return conversations;
    }
  }

  async getInRange(user_id, start, end) {
    const s_parts = start.split('-').map(d => parseInt(d));
    const e_parts = end.split('-').map(d => parseInt(d));
    const s_date = new Date(s_parts[0], s_parts[1]-1, s_parts[2], 0, 0, 0, 0);
    const e_date = new Date(e_parts[0], e_parts[1]-1, e_parts[2], 23, 59, 59, 999);
    const allconversations = await this.getConversationsForUser(user_id);
    const conversations = allconversations.filter(d => d.updated_date >= s_date && d.updated_date <= e_date);
    // Generate output data
    const output = [];
    for (let i = 0; i < conversations.length; i++) {
      const entry = {
        _id: conversations[i]._id.toString(),
        title: conversations[i].title,
        category: conversations[i].category,
        tags: conversations[i].tags,
        messages: [],
        updated_date: conversations[i].updated_date
      };
      const messages = await this.messageService.getMessagesByIdArray(conversations[i].messages);
      conversations[i].messages = [];
      for (let j = messages.length-1; j >= 0; j--) {
        entry.messages.push({
          role: "user",
          text: messages[j].prompt,
          html: messages[j].prompt_html,
          images: []
        });
        if ('images' in messages[j] && messages[j].images && messages[j].images.length > 0) {
          messages[j].images.forEach(img => entry.messages[entry.messages.length-1].images.push(img.filename));
        }
        entry.messages.push({
          role: "assistant",
          text: messages[j].response,
          html: messages[j].response_html,
          images: []
        });
      }
      output.push(entry);
    }
    return output;
  }

  async getConversationsById(conversation_id) {
    return await this.conversationModel.findById(conversation_id);
  }

  async getConversationsInGroup(group_id) {
    const conversations = await this.conversationModel.find({group_id}).sort({ updated_date: -1 }).exec();
    return conversations;
  }

  async getCategoryTagsForConversationsById(conversation_id) {
    const conversation = await this.conversationModel.findById(conversation_id);
    return {category: conversation.category, tags: conversation.tags};
  }

  async createEmptyConversation(user_id) {
    const conversation_entry = {
      user_id,
      group_id: Date.now().toString(),
      title: "placeholder",
      description: "placeholder",
      category: "placeholder",
      tags: "placeholder",
      context_prompt: "placeholder",
      knowledge_injects: [],
      messages: [],
      updated_date: new Date(),
      default_model: "gpt-4o-mini",
    };
    const conv_entry = await new this.conversationModel(conversation_entry).save();
    return conv_entry._id.toString();
  }

  async copyConversation(conversation_id, start_message_id, end_message_id) {
    // Fetch original conversation
    const original_conversation = await this.conversationModel.findById(conversation_id);

    // Create copy
    const conversation_entry = {
      user_id: original_conversation.user_id,
      group_id: original_conversation.group_id,
      title: original_conversation.title,
      description: original_conversation.description,
      category: original_conversation.category,
      tags: original_conversation.tags,
      context_prompt: original_conversation.context_prompt,
      knowledge_injects: [],
      messages: [],
      updated_date: new Date(),
      default_model: original_conversation.default_model || "gpt-4o-mini",
    };

    for (let i = 0; i < original_conversation.knowledge_injects.length; i++) {
      conversation_entry.knowledge_injects.push({
        knowledge_id: original_conversation.knowledge_injects[i].knowledge_id,
        use_type: original_conversation.knowledge_injects[i].use_type
      });
    }

    // Copy the required message ids
    let include_message = start_message_id ? false : true;
    for (let i = 0; i < original_conversation.messages.length; i++) {
      if (original_conversation.messages[i] === start_message_id) include_message = true;
      if (include_message) conversation_entry.messages.push(original_conversation.messages[i]);
      if (original_conversation.messages[i] === end_message_id) include_message = false;
    }

    // Save new entry to database
    const conv_entry = await new this.conversationModel(conversation_entry).save();

    // Return id of new entry
    return conv_entry._id.toString();
  }

  async generateConversationFromMessages(user_id, message_id_array) {
    const conversation_entry = {
      user_id,
      group_id: Date.now().toString(),
      title: "placeholder",
      description: "placeholder",
      category: "placeholder",
      tags: "placeholder",
      context_prompt: "placeholder",
      knowledge_injects: [],
      messages: message_id_array,
      updated_date: new Date(),
      default_model: "gpt-4o-mini",
    };
    const conv_entry = await new this.conversationModel(conversation_entry).save();
    return conv_entry._id.toString();
  }

  async createConversationFromMessagesArray(user_id, title, messagesArray, context, model, category, tags) {
    // Generate messages
    const message_id_array = [];
    for (let i = 0; i < messagesArray.length; i += 2) {
      message_id_array.push((await this.messageService.CreateCustomMessage(messagesArray[i].content, messagesArray[i+1].content, user_id, category, [], [tags])).db_entry._id.toString());
    }
    // Generate conversation
    const conversation_entry = {
      user_id,
      group_id: Date.now().toString(),
      title,
      description: "placeholder",
      category,
      tags: [tags],
      context_prompt: context,
      knowledge_injects: [],
      messages: message_id_array,
      updated_date: new Date(),
      default_model: model,
    };
    const conv_entry = await new this.conversationModel(conversation_entry).save();
    return conv_entry._id.toString();
  }

  async appendCustomMessageToConversation(user_id, conversation_id, user_msg, assistant_msg, model) {
    const conversation = await this.conversationModel.findById(conversation_id);
    conversation.messages.push((await this.messageService.CreateCustomMessage(user_msg, assistant_msg, user_id, conversation.category, [], conversation.tags)).db_entry._id.toString());
    conversation.updated_date = new Date();
    conversation.default_model = model;
    await conversation.save();
  }

  async updateConversationSettings(conversation_id, context, category, tags) {
    const tags_array = tags.split(', ').join(',').split(' ').join('_').split(',');
    const conversation = await this.conversationModel.findById(conversation_id);
    conversation.context_prompt = context;
    conversation.category = category;
    conversation.tags = tags_array;
    await conversation.save();
  }

  async updateConversation(conversation_id, parameters, model = null) {
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const conversation = await this.conversationModel.findById(conversation_id);
    conversation.title = parameters.title;
    conversation.category = parameters.category;
    conversation.tags = tags_array;
    conversation.context_prompt = parameters.context;
    conversation.updated_date = new Date();
    if (model) conversation.default_model = model;
    await conversation.save();
    return conversation._id.toString();
  }

  async doneConversation(conversation_id) {
    const conversation = await this.conversationModel.findById(conversation_id);
    if (conversation.title.indexOf("[Done]") === -1) {
      conversation.title = "[Done] " + conversation.title;
    }
    await conversation.save();
    return conversation._id.toString();
  }

  async updateSummary(conversation_id, summary) {
    const conversation = await this.conversationModel.findById(conversation_id);
    if (conversation) {
      conversation.description = summary;
      await conversation.save();
      return conversation._id.toString();
    } else {
      return null;
    }
  }

  async deleteOneMessage(conversation_id, message_id) {
    const conversation = await this.conversationModel.findById(conversation_id);
    if (conversation) {
      conversation.messages = conversation.messages.filter(d => d != message_id);
      await conversation.save();
    }
    return conversation_id;
  }

  async emailOneMessage(conversation_id, message_id) {
    const conversation = await this.conversationModel.findById(conversation_id);
    await this.messageService.emailOneMessage(message_id, conversation.title);
    return conversation_id;
  }

  async generateMessageArrayForConversation(conversation_id, for_summary = false, use_context = true, context_role = 'system') {
    const messages = [];
    const inject_prompt_lookup = {
      context: "This is some additional context:",
      reference: "Use as reference for guiding your answer:",
      example: "This is an example of the type of output I want:",
    };
    const conversation = await this.conversationModel.findById(conversation_id);

    // Return `null` if conversation has been deleted
    if (!conversation) return null;

    // Set context
    if (use_context) {
      if (for_summary) {
        messages.push({
          role: context_role,
          content: [
            { type: 'text', text: "Hello ChatGPT, during this session, we will be discussing various topics. At the end of our conversation, I will ask you for a summary. This summary should provide a clear and concise overview of the key points and main ideas discussed, without necessarily preserving the original order. The aim is to make the summary easy and quick to read so that anyone can grasp the content of our conversation without needing to read everything. Feel free to rearrange the content for better clarity and coherence. When I am ready for the summary, I will use a specific prompt to request it." }
          ]
        });
      } else {
        let context = conversation.context_prompt;
        if (conversation.knowledge_injects && conversation.knowledge_injects.length > 0) {
          const ids_array = conversation.knowledge_injects.map(d => d.knowledge_id);
          const knowledges = await this.knowledgeService.getKnowledgesByIdArray(ids_array);
          const knowledge_lookup = [];
          knowledges.forEach(d => knowledge_lookup.push(d._id.toString()));
          for (let i = 0; i < conversation.knowledge_injects.length; i++) {
            // Extend context with knowledge
            const use_type = conversation.knowledge_injects[i].use_type;
            const title = knowledges[knowledge_lookup.indexOf(conversation.knowledge_injects[i].knowledge_id)].title;
            const text_content = knowledges[knowledge_lookup.indexOf(conversation.knowledge_injects[i].knowledge_id)].contentMarkdown;

            context += `\n\n---\n\n**${inject_prompt_lookup[use_type]}**\n\n## ${title}\n\n${text_content}\n\n---`;
          }
        }
        if (context.length > 0) {
          messages.push({
            role: context_role,
            content: [
              { type: 'text', text: context }
            ]
          });
        }
      }
    }

    // Set old messages
    const prev_messages = await this.messageService.getMessagesByIdArray(conversation.messages.reverse(), false);
    // Append messages
    const start_i = conversation.max_messages && conversation.max_messages > 0 ? prev_messages.length - conversation.max_messages : 0;
    for (let i = start_i > 0 ? start_i : 0; i < prev_messages.length; i++) {
      const m = prev_messages[i];
      const content = [{ type: 'text', text: m.prompt }];
      for (let x = 0; x < m.images.length && for_summary === false; x++) {
        if (m.images[x].use_flag != 'do not use') {
          const b64 = this.loadImageToBase64(m.images[x].filename);
          content.push({
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${b64}`,
              detail: `${m.images[x].use_flag === 'high quality' ? 'high' : 'low'}`
            }
          });
        }
      }
      // User prompt
      messages.push({
        role: 'user',
        content
      });
      // Assistant response
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: m.response },
        ]
      });
    }

    return messages;
  }

  async postToConversation(user_id, conversation_id, new_images, parameters, provider="OpenAI", reasoning_effort="medium", private_msg=false, delete_messages=[]) {
    let use_vision = false;
    const vision_messages = [];
    const text_messages = [];
    const inject_prompt_lookup = {
      context: "This is some additional context:",
      reference: "Use as reference for guiding your answer:",
      example: "This is an example of the type of output I want:",
    };

    // Set context
    let context = parameters.context;
    if ("knowledge" in parameters && parameters.knowledge.length > 0) {
      if (!Array.isArray(parameters.knowledge)) {
        // Convert input to an array with the input as its single element
        parameters.knowledge = [parameters.knowledge];
      }
      const knowledges = await this.knowledgeService.getKnowledgesByIdArray(parameters.knowledge);
      const knowledge_lookup = [];
      knowledges.forEach(d => knowledge_lookup.push(d._id.toString()));
      for (let i = 0; i < parameters.knowledge.length; i++) {
        // Extend context with knowledge
        const use_type = parameters[`knowledge_${parameters.knowledge[i]}`];
        const title = knowledges[knowledge_lookup.indexOf(parameters.knowledge[i])].title;
        const text_content = knowledges[knowledge_lookup.indexOf(parameters.knowledge[i])].contentMarkdown;

        context += `\n\n---\n\n**${inject_prompt_lookup[use_type]}**\n\n## ${title}\n\n${text_content}\n\n---`;
      }
    }
    if (context.length > 0) {
      vision_messages.push({
        role: 'system',
        content: [
          { type: 'text', text: context }
        ]
      });
      text_messages.push({
        role: 'system',
        content: context
      });
    }

    // Set previous messages, if not a new conversation
    if (conversation_id != 'new') {
      const conversation = await this.conversationModel.findById(conversation_id);
      const m_id = conversation.messages.filter(d => delete_messages.indexOf(d) === -1).reverse();
      const prev_messages = await this.messageService.getMessagesByIdArray(m_id, false, parameters);
      // Append messages
      const start_i = parameters.max && parameters.max > 0 ? prev_messages.length - parameters.max : 0;
      for (let i = start_i > 0 ? start_i : 0; i < prev_messages.length; i++) {
        const m = prev_messages[i];
        const content = [{ type: 'text', text: m.prompt }];
        for (let x = 0; x < m.images.length; x++) {
          if (m.images[x].filename in parameters) {
            if (parameters[m.images[x].filename] != '0') {
              use_vision = true;
              const b64 = this.loadImageToBase64(m.images[x].filename);
              content.push({
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${b64}`,
                  detail: `${parameters[m.images[x].filename] === '2' ? 'high' : 'low'}`
                }
              });
            }
          } else {
            if (m.images[x].use_flag != 'do not use') {
              use_vision = true;
              const b64 = this.loadImageToBase64(m.images[x].filename);
              content.push({
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${b64}`,
                  detail: `${m.images[x].use_flag === 'high quality' ? 'high' : 'low'}`
                }
              });
            }
          }
        }
        // User prompt
        vision_messages.push({
          role: 'user',
          content
        });
        text_messages.push({
          role: 'user',
          content: m.prompt
        });
        // Assistant response
        vision_messages.push({
          role: 'assistant',
          content: [
            { type: 'text', text: m.response },
          ]
        });
        text_messages.push({
          role: 'assistant',
          content: m.response,
        });
      }
    }

    // Append input prompt
    vision_messages.push({
      role: 'user',
      content: [
        { type: 'text', text: parameters.prompt }
      ]
    });
    text_messages.push({
      role: 'user',
      content: parameters.prompt,
    });
    // Process input images
    const images = [];
    for (let i = 0; i < new_images.length; i++) {
      use_vision = true;
      const image_data = await this.loadProcessNewImageToBase64(new_images[i]);
      images.push({
        filename: image_data.new_filename,
        use_flag: 'high quality'
      });
      vision_messages[vision_messages.length - 1].content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${image_data.b64_img}`,
        }
      });
    }

    // Create new message
    const message_data = await this.messageService.createMessage(use_vision, vision_messages, text_messages, user_id, parameters, images, provider, reasoning_effort, private_msg);

    // Save conversation to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    if (conversation_id === "new") {
      const conversation_entry = {
        user_id,
        group_id: Date.now().toString(),
        title: parameters.title,
        description: '[pending]',
        category: parameters.category,
        tags: tags_array,
        context_prompt: parameters.context,
        knowledge_injects: [],
        messages: [ message_data.db_entry._id.toString() ],
        updated_date: new Date(),
        default_model: provider,
        max_messages: parameters.max ? parameters.max : 0,
      };
      if ("knowledge" in parameters) {
        for (let i = 0; i < parameters.knowledge.length; i++) {
          conversation_entry.knowledge_injects.push({
            knowledge_id: parameters.knowledge[i],
            use_type: parameters[`knowledge_${parameters.knowledge[i]}`],
          });
        }
      }
      const conv_entry = await new this.conversationModel(conversation_entry).save();
      return conv_entry._id.toString();
    } else {
      // update existing DB entry
      const conversation = await this.conversationModel.findById(conversation_id);
      conversation.title = parameters.title;
      conversation.description = '[pending update] ' + conversation.description;
      conversation.category = parameters.category;
      conversation.tags = tags_array;
      conversation.context_prompt = parameters.context;
      conversation.knowledge_injects = [];
      conversation.max_messages = parameters.max ? parameters.max : 0;
      if ("knowledge" in parameters) {
        for (let i = 0; i < parameters.knowledge.length; i++) {
          conversation.knowledge_injects.push({
            knowledge_id: parameters.knowledge[i],
            use_type: parameters[`knowledge_${parameters.knowledge[i]}`],
          });
        }
      }
      let msg = conversation.messages.filter(d => delete_messages.indexOf(d) === -1);
      msg.push(message_data.db_entry._id.toString());
      conversation.messages = msg;
      conversation.updated_date = new Date();
      conversation.default_model = provider;
      await conversation.save();
      return conversation._id.toString();
    }
  }

  async askCategory(user_id, new_images, parameters, provider="OpenAI", max_count=10, private_msg=false) {
    if (new_images.length > 0) {
      logger.warning("Images not supported in `askCategory(...)`, and is ignored.")
    }

    const messages = [];
    const context = parameters.context;
    if (context.length > 0) {
      messages.push({
        role: 'system',
        content: [
          { type: 'text', text: context }
        ]
      });
    }

    // Fetch messages
    const category_message = await this.messageService.getMessagesByCategoryUserId(parameters.category, user_id);

    // Generate input prompt
    let prompt = `Based on this content, please answer the following prompt:\n\n${parameters.prompt}`;
    for (let i = 0; i < category_message.length && i < max_count; i++) {
      prompt = `${category_message[i].response}\n\n---\n\n${prompt}`;
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt }
      ]
    });
    // Process input images
    const images = [];
    // NOT SUPPORTED HERE

    // Generate response
    parameters.category = `Category: ${parameters.category}`;
    parameters.prompt = prompt;
    const message_data = await this.messageService.createMessage(false, messages, messages, user_id, parameters, images, provider, private_msg);

    // Return conversation ID
    // Save conversation to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const conversation_entry = {
      user_id,
      group_id: Date.now().toString(),
      title: parameters.title,
      description: '[pending]',
      category: parameters.category,
      tags: tags_array,
      context_prompt: parameters.context,
      knowledge_injects: [],
      messages: [ message_data.db_entry._id.toString() ],
      updated_date: new Date(),
      default_model: provider,
    };
    const conv_entry = await new this.conversationModel(conversation_entry).save();
    return conv_entry._id.toString();
  }

  async appendMessageToConversation(conversation_id, message_id_to_add, summary = true) {
    const conversation = await this.conversationModel.findById(conversation_id);
    conversation.messages.push(message_id_to_add);

    if (summary) {
      // Generate a new summary
      const messages = await this.messageService.getMessagesByIdArray(conversation.messages);
      const api_messages = [];
      api_messages.push({
        role: 'system',
        content: [
          { type: 'text', text: conversation.context_prompt }
        ]
      });
      messages.forEach(m => {
        api_messages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.prompt }
          ]
        });
        api_messages.push({
          role: 'assistant',
          content: [
            { type: 'text', text: m.response }
          ]
        });
      });
      const summary = await this.messageService.createMessagesSummary(api_messages);
      conversation.description = summary;
    }

    conversation.updated_date = new Date();
    await conversation.save();
    return conversation._id.toString();
  }

  async generateImage(params) {
    const conversation = await this.conversationModel.findById(params.id);
    const image_name = await this.messageService.generateImage2(params, conversation);
    return image_name;
  }

  /**
   * Create an AI generated title for conversation and update database
   * @param {*} id 
   */
  async aiTitle(id) {
    const conversation = await this.conversationModel.findById(id);
    const title = await this.messageService.CreateTitle(conversation.messages);
    conversation.title = title;
    await conversation.save();
    return title;
  }

  async deleteConversation(id) {
    return await this.conversationModel.deleteOne({_id: id});
  }

  loadImageToBase64(filename) {
    const img_buffer = fs.readFileSync(`./public/img/${filename}`);
    const b64_img = Buffer.from(img_buffer).toString('base64');
    return b64_img;
  }

  async loadProcessNewImageToBase64(filename) {
    const file_data = fs.readFileSync(filename);
    const img_data = await sharp(file_data);
    const metadata = await img_data.metadata();
    let short_side = metadata.width < metadata.height ? metadata.width : metadata.height;
    let long_side = metadata.width > metadata.height ? metadata.width : metadata.height;
    let scale = 1;
    if (short_side > 768 || long_side > 2048) {
      if (768 / short_side < scale) scale = 768 / short_side;
      if (2048 / long_side < scale) scale = 2048 / long_side;
    }
    const scale_img = await img_data.resize({ width: Math.round(metadata.width * scale) });
    const img_buffer = await scale_img.jpeg().toBuffer();
    const new_filename = `UP-${Date.now()}.jpg`;
    fs.writeFileSync(`./public/img/${new_filename}`, img_buffer);
    const b64_img = Buffer.from(img_buffer).toString('base64');
    return { new_filename, b64_img };
  }

  /*****
   * TOOLS TEST
   */
  async postToConversationTool(user_id, conversation_id, parameters) {
    const text_messages = [];

    // Set context
    let context = parameters.context;
    if (context.length > 0) {
      text_messages.push({
        role: 'system',
        content: context
      });
    }

    // Set previous messages, if not a new conversation
    if (conversation_id != 'new') {
      const conversation = await this.conversationModel.findById(conversation_id);
      const m_id = conversation.messages;
      const prev_messages = await this.messageService.getMessagesByIdArray(m_id, false, parameters);
      // Append messages
      for (let i = 0; i < prev_messages.length; i++) {
        const m = prev_messages[i];
        text_messages.push({
          role: 'user',
          content: m.prompt
        });
        // Assistant response
        text_messages.push({
          role: 'assistant',
          content: m.response,
        });
      }
    }

    // Append input prompt
    text_messages.push({
      role: 'user',
      content: parameters.prompt,
    });

    // Create new message
    const message_data = await this.messageService.createMessageTool(text_messages, user_id, parameters);

    // Save conversation to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    if (conversation_id === "new") {
      const conversation_entry = {
        user_id,
        group_id: Date.now().toString(),
        title: parameters.title,
        description: '[pending]',
        category: parameters.category,
        tags: tags_array,
        context_prompt: parameters.context,
        knowledge_injects: [],
        messages: [ message_data.db_entry._id.toString() ],
        updated_date: new Date(),
      };
      if ("knowledge" in parameters) {
        for (let i = 0; i < parameters.knowledge.length; i++) {
          conversation_entry.knowledge_injects.push({
            knowledge_id: parameters.knowledge[i],
            use_type: parameters[`knowledge_${parameters.knowledge[i]}`],
          });
        }
      }
      const conv_entry = await new this.conversationModel(conversation_entry).save();
      return conv_entry._id.toString();
    } else {
      // update existing DB entry
      const conversation = await this.conversationModel.findById(conversation_id);
      conversation.title = parameters.title;
      conversation.description = '[pending update] ' + conversation.description;
      conversation.category = parameters.category;
      conversation.tags = tags_array;
      conversation.context_prompt = parameters.context;
      conversation.knowledge_injects = [];
      if ("knowledge" in parameters) {
        for (let i = 0; i < parameters.knowledge.length; i++) {
          conversation.knowledge_injects.push({
            knowledge_id: parameters.knowledge[i],
            use_type: parameters[`knowledge_${parameters.knowledge[i]}`],
          });
        }
      }
      conversation.messages.push(message_data.db_entry._id.toString());
      conversation.updated_date = new Date();
      await conversation.save();
      return conversation._id.toString();
    }
  }

  // CHAT5
  // CHAT5
  // CHAT5
  // CHAT5
  // CHAT5
  async createNewConversation(userId, settings = DEFAULT_SETTINGS, conv_property = DEFAULT_PROPERTY) {
    const memberList = Array.isArray(conv_property.members) ? [...conv_property.members] : [];
    if (memberList.indexOf(userId) === -1) memberList.push(userId);

    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
    };

    const tags = Array.isArray(conv_property.tags)
      ? [...conv_property.tags]
      : (typeof conv_property.tags === 'string' && conv_property.tags.length > 0
        ? [conv_property.tags]
        : [...DEFAULT_PROPERTY.tags]);

    const conv = new Conversation5Model({
      title: conv_property.title || DEFAULT_PROPERTY.title,
      summary: conv_property.summary || '',
      category: conv_property.category || DEFAULT_PROPERTY.category,
      tags,
      metadata: mergedSettings,
      members: memberList.filter(d => typeof d === 'string' && d.length > 0),
      messages: []
    });
    await conv.save();
    return conv;
  }

  async findOrCreateEmptyConversation({ userId, settings = {}, properties = {} } = {}) {
    const normalizedUser = String(userId);
    let conversation = await Conversation5Model.findOne({
      members: normalizedUser,
      messages: { $size: 0 }
    });

    let shouldSave = false;
    if (conversation) {
      const metadataUpdates = Object.keys(settings || {});
      if (metadataUpdates.length > 0) {
        conversation.metadata = {
          ...DEFAULT_SETTINGS,
          ...(conversation.metadata || {}),
          ...settings,
        };
        shouldSave = true;
      }
      const propertyUpdates = Object.keys(properties || {});
      if (propertyUpdates.length > 0) {
        if (properties.title && properties.title.trim().length > 0) {
          conversation.title = properties.title.trim();
          shouldSave = true;
        }
        if (properties.category && properties.category.trim().length > 0) {
          conversation.category = properties.category.trim();
          shouldSave = true;
        }
        if (Array.isArray(properties.tags)) {
          const cleanedTags = [...new Set(properties.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim()))];
          if (cleanedTags.length > 0) {
            conversation.tags = cleanedTags;
            shouldSave = true;
          }
        }
        if (Array.isArray(properties.members)) {
          const members = [...new Set(properties.members.concat([normalizedUser]).filter(m => typeof m === 'string' && m.length > 0))];
          conversation.members = members;
          shouldSave = true;
        }
      }

      if (!conversation.members.includes(normalizedUser)) {
        conversation.members.push(normalizedUser);
        shouldSave = true;
      }

      if (shouldSave) {
        conversation.updatedAt = new Date();
        await conversation.save();
      }
      return conversation;
    }

    const mergedProps = {
      ...DEFAULT_PROPERTY,
      ...(properties || {}),
      members: Array.isArray(properties.members) ? [...properties.members] : [],
    };

    return this.createNewConversation(userId, { ...DEFAULT_SETTINGS, ...settings }, mergedProps);
  }

  async copyConversationToChat5({ sourceConversationId, userId, deepCopy = false }) {
    const normalizedId = String(sourceConversationId);
    let sourceConversation = await Conversation5Model.findById(normalizedId);
    const normalizedUser = String(userId);

    if (!sourceConversation) {
      const legacyConversation = await this.conversationModel.findById(normalizedId);
      if (!legacyConversation) {
        throw new Error('Conversation not found');
      }

      const convertedConversation = this.convertOldConversation(legacyConversation);
      const newMessageIds = await this.messageService.convertOldMessages(convertedConversation.messages);
      const memberSet = new Set([...(convertedConversation.members || []), normalizedUser]);

      const newConversation = new Conversation5Model({
        title: convertedConversation.title,
        summary: convertedConversation.summary,
        category: convertedConversation.category,
        tags: Array.isArray(convertedConversation.tags) ? [...convertedConversation.tags] : [],
        metadata: convertedConversation.metadata,
        members: [...memberSet].filter(Boolean),
        messages: newMessageIds,
      });

      await newConversation.save();
      const messages = await this.messageService.loadMessagesInNewFormat(newConversation.messages, true);
      return { conversation: newConversation, messages, source: 'chat4', deepCopied: true };
    }

    const sourceMetadata = {
      ...DEFAULT_SETTINGS,
      ...(sourceConversation.metadata || {}),
    };
    const memberSet = new Set([...(sourceConversation.members || []), normalizedUser]);

    let messageIds = [];
    if (deepCopy) {
      const { ids } = await this.messageService.cloneMessages({ messageIds: sourceConversation.messages });
      messageIds = ids;
    } else {
      messageIds = [...sourceConversation.messages];
    }

    const newConversation = new Conversation5Model({
      title: sourceConversation.title,
      summary: sourceConversation.summary,
      category: sourceConversation.category,
      tags: Array.isArray(sourceConversation.tags) ? [...sourceConversation.tags] : [],
      metadata: sourceMetadata,
      members: [...memberSet].filter(Boolean),
      messages: messageIds,
    });

    await newConversation.save();
    const messages = await this.messageService.loadMessagesInNewFormat(newConversation.messages, true);
    return { conversation: newConversation, messages, source: 'chat5', deepCopied: !!deepCopy };
  }

  async appendMessages(conversationId, messageIds = []) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return await Conversation5Model.findById(conversationId);
    }

    const conversation = await Conversation5Model.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found in chat5 database. Please convert or copy it before appending messages.');
    }

    conversation.messages.push(...messageIds.map(id => id.toString()));
    conversation.updatedAt = new Date();
    await conversation.save();
    return conversation;
  }

  async loadConversation(conversationId) {
    const conv = await Conversation5Model.findById(conversationId);
    if (conv) {
      const msg = await this.messageService.loadMessagesInNewFormat(conv.messages, true);
      return {conv, msg, source: 'conversation5'};
    }

    // Try old database
    const oldConv = await this.conversationModel.findById(conversationId);
    if (oldConv) {
      const convertedConv = this.convertOldConversation(oldConv);
      convertedConv._id = conversationId;
      const msg = await this.messageService.loadMessagesInNewFormat(oldConv.messages, false);
      return {conv: convertedConv, msg, source: 'conversation4'};
    }

    throw new Error("Conversation not found");
  }

  convertOldConversation(conversation) {
    const newFormat = {
      title: conversation.title,
      summary: conversation.description,
      category: conversation.category,
      tags: conversation.tags,
      messages: conversation.messages,
      metadata: {
        contextPrompt: conversation.context_prompt,
        model: conversation.default_model ? conversation.default_model : "gpt-4.1-2025-04-14",
        maxMessages: conversation.max_messages ? conversation.max_messages : 999,
        maxAudioMessages: 3,
        tools: [],
        reasoning: "medium",
        outputFormat: "text",
      },
      members: [conversation.user_id],
    };
    const conv = new Conversation5Model(newFormat);
    return conv;
  }

  async postToConversationNew({conversationId, userId, messageContent, messageType, generateAI=false, s, c}) {
    let conversation = await Conversation5Model.findById(conversationId);

    if (!conversation) {
      const oldConv = await this.conversationModel.findById(conversationId);
      if (oldConv) {
        conversation = this.convertOldConversation(oldConv);
        conversation.messages = await this.messageService.convertOldMessages(conversation.messages);
        await conversation.save(); // Conversation persisted now!
      } else {
        throw new Error("Conversation not found");
      }
    }

    // Update settings
    if (s) {
      conversation.metadata.contextPrompt = s.contextPrompt;
      conversation.metadata.model = s.model;
      conversation.metadata.maxMessages = s.maxMessages;
      conversation.metadata.maxAudioMessages = s.maxAudioMessages;
      conversation.metadata.tools = s.tools;
      conversation.metadata.reasoning = s.reasoning;
      conversation.metadata.verbosity = s.verbosity;
      conversation.metadata.outputFormat = s.outputFormat;
    }
    if (c) {
      const members = c.members;
      if (members.indexOf(userId) === -1) members.push(userId);
      conversation.title = c.title;
      conversation.category = c.category;
      conversation.tags = c.tags;
      conversation.members = members.filter(d => d.length > 0);
    }

    // Add user message(s)
    let userMessage = null;
    const userMessages = [];
    const messageContentArray = Array.isArray(messageContent)
      ? messageContent.filter(Boolean)
      : (messageContent ? [messageContent] : []);
    const messageTypeArray = Array.isArray(messageType) ? messageType : [messageType];

    if (messageContentArray.length > 0) {
      const allImages = messageTypeArray.every(type => type === 'image');
      if (allImages && Array.isArray(messageContent)) {
        const createdImages = await this.messageService.createImageMessagesBatch({
          userId,
          category: conversation.category,
          tags: conversation.tags,
          images: messageContentArray,
        });
        for (const msg of createdImages) {
          conversation.messages.push(msg._id.toString());
          userMessages.push(msg);
        }
      } else {
        for (let i = 0; i < messageContentArray.length; i++) {
          const content = messageContentArray[i];
          const type = messageTypeArray[i] || messageTypeArray[0] || 'text';
          const msg = await this.messageService.createMessageNew({
            userId,
            content,
            contentType: type,
            category: conversation.category,
            tags: conversation.tags,
          });
          conversation.messages.push(msg._id.toString());
          userMessages.push(msg);
        }
      }
      userMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
    }

    // Generate AI response
    let aiMessages = [];
      if (generateAI) {
        const {response_id, msg} = await this.messageService.generateAIMessage({conversation});
        let placeholder_id = null;
        if (msg) {
          placeholder_id = msg._id.toString();
          conversation.messages.push(placeholder_id);
          aiMessages.push(msg);
        }

        if (response_id && placeholder_id) {
          // Save pending request
          const pending_req = {
            response_id,
            conversation_id: conversation._id.toString(),
            placeholder_id,
          };
          const pr = new PendingRequests(pending_req);
          await pr.save();
        }
      }

    // Save changes
    conversation.updatedAt = new Date();
    await conversation.save();

    return { conversation, userMessage, userMessages, aiMessages };
  }

  async updateSettings(conversationId, settingsUpdates) {
    let conversation = await Conversation5Model.findById(conversationId);

    if (!conversation) {
      const oldConv = await this.conversationModel.findById(conversationId);
      if (oldConv) {
        conversation = this.convertOldConversation(oldConv);
        conversation.messages = this.messageService.convertOldMessages(conversation.messages);
        await conversation.save();
      } else {
        throw new Error("Conversation not found");
      }
    }

    conversation.metadata = {...conversation.metadata, ...settingsUpdates};
    conversation.updatedAt = new Date();
    await conversation.save();
    return conversation;
  }

  async updateConversationDetails(conversationId, updates) {
    const conversation = await Conversation5Model.findById(conversationId);
    if (!conversation) return null;

    const sanitizeArray = (value) => {
      if (!Array.isArray(value)) return [];
      return [...new Set(value.map(v => (typeof v === 'string' ? v.trim() : '')).filter(v => v.length > 0))];
    };

    if (typeof updates.title === 'string') {
      conversation.title = updates.title.trim() || conversation.title;
    }
    if (typeof updates.category === 'string' && updates.category.trim().length > 0) {
      conversation.category = updates.category.trim();
    }
    if (Array.isArray(updates.tags)) {
      const cleanedTags = sanitizeArray(updates.tags);
      conversation.tags = cleanedTags;
    }
    if (Array.isArray(updates.members)) {
      conversation.members = sanitizeArray(updates.members);
    }
    if (typeof updates.summary === 'string') {
      conversation.summary = updates.summary.trim();
    }

    const meta = conversation.metadata || {};
    if (typeof updates.contextPrompt === 'string') {
      meta.contextPrompt = updates.contextPrompt;
    }
    if (typeof updates.model === 'string' && updates.model.trim().length > 0) {
      meta.model = updates.model.trim();
    }
    if (typeof updates.reasoning === 'string' && updates.reasoning.trim().length > 0) {
      meta.reasoning = updates.reasoning.trim();
    }
    if (typeof updates.verbosity === 'string' && updates.verbosity.trim().length > 0) {
      meta.verbosity = updates.verbosity.trim();
    }
    if (typeof updates.maxMessages !== 'undefined') {
      const parsed = parseInt(updates.maxMessages, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        meta.maxMessages = parsed;
      }
    }
    if (Array.isArray(updates.tools)) {
      meta.tools = sanitizeArray(updates.tools);
    }

    conversation.metadata = meta;
    conversation.updatedAt = new Date();
    await conversation.save();
    return conversation;
  }

  async updateMessageArray(conversationId, newArray) {
    let conversation = await Conversation5Model.findById(conversationId);
    conversation.messages = newArray;
    await conversation.save();
  }

  async generateTitle(conversationId) {
    let conversation = await Conversation5Model.findById(conversationId);
    const title = await this.messageService.GenerateTitle(conversation.messages);
    conversation.title = title;
    await conversation.save();
    return title;
  }

  async generateSummaryNew(conversationId) {
    const conversation = await Conversation5Model.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found in conversation5 database');
    }

    const messages = await this.messageService.loadMessagesInNewFormat(conversation.messages, true);
    const summary = await this.messageService.generateChat5Summary({ conversation, messages });
    conversation.summary = summary;
    conversation.updatedAt = new Date();
    await conversation.save();

    return summary;
  }

  async listUserConversations(userId) {
    const newConvs = await Conversation5Model.find({members: userId});
    const oldConvs = await this.conversationModel.find({user_id: userId});

    // Minimal conversation
    const oldConvsConverted = oldConvs.map(conv => {
      return {
        _id: conv._id,
        title: conv.title,
        updatedAt: conv.updated_date,
        category: conv.category,
        old: true,
      };
    });

    return [...newConvs, ...oldConvsConverted];
  }

  async fetchPending() {
    const p = await PendingRequests.find({});
    const msg_ids = [];
    for (let i = 0; i < p.length; i++) {
      msg_ids.push(p.conversation_id);
    }
    return msg_ids;
  }

  // {conversation, messages, placeholder_id} = processCompletedResponse(response_id);
  async processCompletedResponse(response_id) {
    const pending = await PendingRequests.findOne({response_id});

    if (!pending) {
      logger.warning('No pending request found for completed response', { response_id });
      return null;
    }

    const conversation = await Conversation5Model.findById(pending.conversation_id);

    if (!conversation) {
      logger.warning('Conversation not found for completed response', { response_id, conversation_id: pending.conversation_id });
      await PendingRequests.deleteOne({_id: pending._id});
      return { conversation: null, messages: [], placeholder_id: pending.placeholder_id };
    }

    const messages = await this.messageService.processCompletedResponse(conversation, response_id);

    conversation.messages = conversation.messages.filter(d => d != pending.placeholder_id);
    for (const m of messages) {
      if (!m.error) {
        conversation.messages.push(m._id.toString());
      }
    }

    await conversation.save();
    await PendingRequests.deleteOne({_id: pending._id});

    return { conversation, messages, placeholder_id: pending.placeholder_id };
  }

  async processFailedResponse(response_id) {
    const pending = await PendingRequests.findOne({response_id});

    if (!pending) {
      logger.warning('No pending request found for failed response', { response_id });
      return 'No pending request found for failed response';
    }

    const conversation = await Conversation5Model.findById(pending.conversation_id);

    if (!conversation) {
      logger.warning('Conversation not found for failed response', { response_id, conversation_id: pending.conversation_id });
      await PendingRequests.deleteOne({_id: pending._id});
      return 'Conversation not found for failed response';
    }

    const error_msg = await this.messageService.processFailedResponse(conversation, response_id);

    conversation.messages = conversation.messages.filter(d => d != pending.placeholder_id);

    await conversation.save();
    await PendingRequests.deleteOne({_id: pending._id});

    return error_msg;
  }

  async deleteNewConversation(id) {
    await Conversation5Model.deleteOne({_id: id});
  }
}

module.exports = ConversationService;
