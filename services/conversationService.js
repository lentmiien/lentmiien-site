const fs = require('fs');
const sharp = require('sharp');

// Conversation service operations: managing conversation sessions and summary

/* conversationModel
{
  user_id: { type: String, required: true, max: 100 },
  group_id: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 255 },
  description: { type: String },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  context_prompt: { type: String },
  knowledge_injects: [
    {
      knowledge_id: { type: String, required: true },
      use_type: { type: String, required: true, enum: ['context', 'reference', 'example'] },
    }
  ],
  messages: [{ type: String, required: true, max: 100 }],
  updated_date: {
    type: Date,
    default: Date.now,
  },
}
*/

class ConversationService {
  constructor(conversationModel, messageService, knowledgeService) {
    this.conversationModel = conversationModel;
    this.messageService = messageService;
    this.knowledgeService = knowledgeService;
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

  async updateConversation(conversation_id, parameters) {
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const conversation = await this.conversationModel.findById(conversation_id);
    conversation.title = parameters.title;
    conversation.category = parameters.category;
    conversation.tags = tags_array;
    conversation.context_prompt = parameters.context;
    conversation.updated_date = new Date();
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

  async generateMessageArrayForConversation(conversation_id, for_summary = false, use_context = true) {
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
          role: 'system',
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
            role: 'system',
            content: [
              { type: 'text', text: context }
            ]
          });
        }
      }
    }

    // Set old messages
    const prev_messages = await this.messageService.getMessagesByIdArray(conversation.messages, false);
    // Append messages
    for (let i = 0; i < prev_messages.length; i++) {
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
      const m_id = conversation.messages.filter(d => delete_messages.indexOf(d) === -1);
      const prev_messages = await this.messageService.getMessagesByIdArray(m_id, false, parameters);
      // Append messages
      for (let i = 0; i < prev_messages.length; i++) {
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
      let msg = conversation.messages.filter(d => delete_messages.indexOf(d) === -1);
      msg.push(message_data.db_entry._id.toString());
      conversation.messages = msg;
      conversation.updated_date = new Date();
      await conversation.save();
      return conversation._id.toString();
    }
  }

  async askCategory(user_id, new_images, parameters, provider="OpenAI", max_count=10, private_msg=false) {
    if (new_images.length > 0) {
      console.warning("Images not supported in `askCategory(...)`, and is ignored.")
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
}

module.exports = ConversationService;
