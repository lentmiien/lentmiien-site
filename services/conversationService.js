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

  async getConversationsForUser(user_id) {
    const conversations = await this.conversationModel.find({user_id}).sort({ updated_date: -1 }).exec();
    return conversations;
  }

  async getConversationsById(conversation_id) {
    return await this.conversationModel.findById(conversation_id);
  }

  async getConversationsInGroup(group_id) {
    const conversations = await this.conversationModel.find({group_id}).sort({ updated_date: -1 }).exec();
    return conversations;
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

  async postToConversation(user_id, conversation_id, new_images, parameters) {
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
      const m_id = conversation.messages;
      const prev_messages = await this.messageService.getMessagesByIdArray(m_id, false, parameters);
      // Append messages
      for (let i = 0; i < prev_messages.length; i++) {
        const m = prev_messages[i];
        const content = [{ type: 'text', text: m.prompt }];
        for (let x = 0; x < m.images.length; x++) {
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
    const message_data = await this.messageService.createMessage(use_vision, vision_messages, text_messages, user_id, parameters, images);

    // Summarize conversation
    text_messages.push({
      role: 'assistant',
      content: message_data.db_entry.response,
    });
    const summary = await this.messageService.createMessagesSummary(text_messages, message_data.tokens);

    // Save conversation to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    if (conversation_id === "new") {
      const conversation_entry = {
        user_id,
        group_id: Date.now().toString(),
        title: parameters.title,
        description: summary,
        category: parameters.category,
        tags: tags_array,
        context_prompt: parameters.context,
        knowledge_injects: [],
        messages: [ message_data.db_entry._id.toString() ],
        updated_date: new Date(),
      };
      for (let i = 0; i < parameters.knowledge.length; i++) {
        conversation_entry.knowledge_injects.push({
          knowledge_id: parameters.knowledge[i],
          use_type: parameters[`knowledge_${parameters.knowledge[i]}`],
        });
      }
      const conv_entry = await new this.conversationModel(conversation_entry).save();
      return conv_entry._id.toString();
    } else {
      // update existing DB entry
      const conversation = await this.conversationModel.findById(conversation_id);
      conversation.title = parameters.title;
      conversation.description = summary;
      conversation.category = parameters.category;
      conversation.tags = tags_array;
      conversation.context_prompt = parameters.context;
      conversation.knowledge_injects = [];
      for (let i = 0; i < inject_keys.length; i++) {
        conversation.knowledge_injects.push({
          knowledge_id: inject_keys[i].split("_")[1],
          use_type: parameters[inject_keys[i]],
        });
      }
      conversation.messages.push(message_data.db_entry._id.toString());
      conversation.updated_date = new Date();
      await conversation.save();
      return conversation._id.toString();
    }
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
}

module.exports = ConversationService;