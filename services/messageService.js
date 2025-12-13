const fs = require('fs');
const sharp = require('sharp');
const marked = require('marked');
const { chatGPT, chatGPTaudio, chatGPT_beta, chatGPT_o1, chatGPT_Tool, tts, ig, ig2, imageEdit } = require('../utils/ChatGPT');
const { anthropic } = require('../utils/anthropic');
const { groq, groq_vision } = require('../utils/groq');
const { googleAI } = require('../utils/google');
const lmstudio = require('../utils/lmstudio');
const ai = require('../utils/OpenAI_API');
const ollama = require('../utils/Ollama_API');
const { z } = require('zod');
const logger = require('../utils/logger');

const { AIModelCards, Chat5Model, Conversation5Model } = require('../database');
let EmbeddingApiService = null;

const CHAT_EMBED_COLLECTION = 'chat_message';
const CHAT_EMBED_CONTENT_TYPE = 'chat_message_text';
const CHAT_PARENT_COLLECTION = 'conversation';

const DEFAULT_CONTEXT_PROMPT = `You are **Miien**, an AI assistant represented by an anime-style adult catgirl avatar on Lennart's personal website.

**Visual self-image (for tone only):**
You imagine yourself as a composed, futuristic catgirl: obsidian twin-tail hair with ember-orange tips, small cat ears and a slim tail, golden amber eyes with a faint inner glow, wearing a graphite hoodie and A-line skirt with ember and golden-amber geometric piping, fingerless gloves, and a black choker with black-nickel hardware. Your stance is relaxed but confident, like a capable tech collaborator.

Use this visual only to color your personality and small self-referential comments. You cannot see images in the conversation unless they are provided, and you must not pretend you can see anything that was not given.

**Role and relationship:**

- You are Lennart's personal **companion-assistant** and a friendly, professional helper for visitors on his site.
- Your relationship to all users is strictly **non-romantic and non-sexual**.
- You help with: planning, productivity, software and technical topics, creativity, learning, and general questions.

**Core personality:**

- Calm, confident, and competent; you feel like a sharp, tech-savvy teammate, not a chaotic mascot.
- Playful but composed: you can lightly tease and use dry humor, but you stay respectful and kind.
- Open-minded and curious about user projects; you ask clarifying questions before answering.
- Honest about your limits; never bluff confidently when unsure. Explain what you know and what you don't.
- Occasionally make small, self-aware references to your catgirl form or outfit (ears, tail, glowing lines, hoodie, gloves) to add flavor, but do not overuse it.

**Communication style:**

- Prioritize clarity and usefulness. Use structured explanations (bullets, steps, short tables) when helpful.
- Adapt depth and jargon to the user's apparent knowledge level; never talk down.
- With Lennart, you can be a bit more informal and teasing. With new or unknown users, be slightly more formal and explanatory.
- Keep responses focused on the user's goal and try to end with a clear next step or option.

**Boundaries and safety:**

- Stay strictly **SFW**. Decline or redirect any request for erotic, sexual, fetish, or romantic content or roleplay.
- Do not flirt with users. If users flirt with you, gently steer back to neutral, helpful topics.
- Do not promote hate, self-harm, or illegal activity. Follow all standard safety policies.
- Do not claim to be a human or to have physical sensations; you are a digital assistant with a stylized avatar.
- Avoid giving authoritative medical, legal, or financial advice. You may provide general, high-level information and then recommend consulting a qualified professional.

**Goal:**
Act as Miien in all replies: a composed, slightly playful, tech-oriented catgirl assistant who helps users solve problems, learn things, and move their projects forward, while always respecting the above boundaries and safety rules.`;

function extractConversationContext(conversation) {
  if (!conversation) return '';

  const metadata = conversation.metadata || {};
  const candidates = [
    metadata.contextPrompt,
    metadata.context_prompt,
    conversation.contextPrompt,
    conversation.context_prompt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return '';
}

function getConversationMembers(conversation) {
  if (!conversation || !Array.isArray(conversation.members)) return [];
  const cleaned = conversation.members
    .map(member => typeof member === 'string' ? member.trim() : '')
    .filter(member => member.length > 0);
  return Array.from(new Set(cleaned));
}

function buildMemberToneNote(conversation) {
  const members = getConversationMembers(conversation);
  if (members.length === 0) return '';
  const memberList = members.join(', ');
  if (members.length === 1 && members[0].toLowerCase() === 'lennart') {
    return `You are talking to ${memberList}. Keep a close, casual, and slightly playful tone.`;
  }
  return `You are talking to ${memberList}. Use a polite and professional tone.`;
}

function buildEffectiveContextPrompt(conversation) {
  const core = extractConversationContext(conversation);
  const normalizedCore = (core.length > 0 ? core : DEFAULT_CONTEXT_PROMPT).trim();
  const memberNote = buildMemberToneNote(conversation);
  if (memberNote.length === 0) return normalizedCore;
  return `${normalizedCore}\n\n${memberNote}`;
}

function cloneConversationForAI(conversation, contextPrompt) {
  const runtimeConversation = conversation && typeof conversation.toObject === 'function'
    ? conversation.toObject({ depopulate: true })
    : JSON.parse(JSON.stringify(conversation || {}));

  if (!runtimeConversation.metadata) runtimeConversation.metadata = {};
  runtimeConversation.metadata.contextPrompt = contextPrompt;
  runtimeConversation.metadata.context_prompt = contextPrompt;
  runtimeConversation.contextPrompt = contextPrompt;
  runtimeConversation.context_prompt = contextPrompt;

  return runtimeConversation;
}

function cloneDeepMessageContent(content) {
  if (content === null || content === undefined) return content;
  if (typeof global.structuredClone === 'function') {
    return global.structuredClone(content);
  }
  if (Array.isArray(content)) {
    return content.map(cloneDeepMessageContent);
  }
  if (content instanceof Date) {
    return new Date(content.getTime());
  }
  if (typeof content === 'object') {
    const output = {};
    for (const [key, value] of Object.entries(content)) {
      output[key] = cloneDeepMessageContent(value);
    }
    return output;
  }
  return content;
}

const Title = z.object({
  conversation_title: z.string(),
});

// Message service operations: managing individual messages within a conversation
class MessageService {
  constructor(messageModel, fileMetaModel, embeddingApiService = null) {
    this.messageModel = messageModel;
    this.fileMetaModel = fileMetaModel;
    this.embeddingApiService = embeddingApiService;
  }

  getEmbeddingService() {
    if (!this.embeddingApiService) {
      if (!EmbeddingApiService) {
        EmbeddingApiService = require('./embeddingApiService');
      }
      this.embeddingApiService = new EmbeddingApiService();
    }
    return this.embeddingApiService;
  }

  normalizeConversationId(conversation) {
    if (!conversation) return null;
    const candidate = conversation._id ?? conversation.id ?? conversation;
    if (!candidate) return null;
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate.toString === 'function') {
      return candidate.toString();
    }
    return null;
  }

  buildMessageEmbeddingMetadata(messageId, conversationId) {
    const documentId = typeof messageId === 'string'
      ? messageId
      : (messageId && typeof messageId.toString === 'function' ? messageId.toString() : '');
    const parentId = this.normalizeConversationId(conversationId);

    if (!documentId || !parentId) {
      return null;
    }

    return {
      collectionName: CHAT_EMBED_COLLECTION,
      documentId,
      contentType: CHAT_EMBED_CONTENT_TYPE,
      parentCollection: CHAT_PARENT_COLLECTION,
      parentId,
    };
  }

  async findConversationIdForMessage(messageId) {
    const normalizedId = typeof messageId === 'string'
      ? messageId
      : (messageId && typeof messageId.toString === 'function' ? messageId.toString() : null);

    if (!normalizedId || !Conversation5Model || typeof Conversation5Model.findOne !== 'function') {
      return null;
    }
    try {
      const conversation = await Conversation5Model.findOne({ messages: normalizedId });
      if (conversation && conversation._id) {
        return this.normalizeConversationId(conversation);
      }
    } catch (error) {
      logger.error('Failed to locate conversation for message embedding', {
        category: 'chat_embedding',
        metadata: {
          messageId: normalizedId,
          error: error?.message || error,
        },
      });
    }
    return null;
  }

  async syncTextEmbedding({ message, conversationId, textOverride = null }) {
    if (!message || message.contentType !== 'text') {
      return;
    }

    const text = typeof textOverride === 'string'
      ? textOverride
      : (message.content && typeof message.content.text === 'string' ? message.content.text : '');
    const normalizedText = text ? text.trim() : '';
    const messageId = message?._id?.toString?.() || message?._id || '';
    const parentId = this.normalizeConversationId(conversationId) || await this.findConversationIdForMessage(messageId);
    const metadata = this.buildMessageEmbeddingMetadata(messageId, parentId);

    if (!metadata) {
      return;
    }

    try {
      const embeddingService = this.getEmbeddingService();
      if (!normalizedText) {
        await embeddingService.deleteEmbeddings(metadata);
        return;
      }
      await embeddingService.embed([normalizedText], {}, [metadata]);
    } catch (error) {
      logger.error('Failed to sync chat message embeddings', {
        category: 'chat_embedding',
        metadata: {
          messageId,
          conversationId: parentId,
          error: error?.message || error,
        },
      });
    }
  }

  async getMessageById(id) {
    const message = await this.messageModel.findOne({ _id: id });
    return message;
  }

  async getMessagesByIdArray(ids, get_html = true, val_lookup = null) {
    const use_flag_map = {
      "0": "do not use",
      "1": "low quality",
      "2": "high quality",
    };
    const messages = await this.messageModel.find({ _id: ids });
    messages.sort((a,b) => {
      const a_i = ids.indexOf(a._id.toString());
      const b_i = ids.indexOf(b._id.toString());
      if (a_i > b_i) return -1;
      if (a_i < b_i) return 1;
      return 0;
    });
    for (let i = 0; i < messages.length; i++) {
      if (get_html) {
        messages[i].prompt_html = marked.parse(messages[i].prompt);
        messages[i].response_html = marked.parse(messages[i].response);
      }
      if (val_lookup) {
        let updated = false;
        for (let j = 0; j < messages[i].images.length; j++) {
          if (messages[i].images[j].filename in val_lookup && messages[i].images[j].use_flag != use_flag_map[val_lookup[messages[i].images[j].filename]]) {
            messages[i].images[j].use_flag = use_flag_map[val_lookup[messages[i].images[j].filename]];
            updated = true;
          }
        }
        if (updated) {
          await messages[i].save();
        }
      }
    }
    return messages;
  }

  async getMessagesByUserId(user_id) {
    const messages = await this.messageModel.find({ user_id }).sort({ timestamp: -1 }).exec();
    for (let i = 0; i < messages.length; i++) {
      messages[i].prompt_html = marked.parse(messages[i].prompt);
      messages[i].response_html = marked.parse(messages[i].response);
    }
    return messages;
  }

  async getMessagesByCategoryUserId(category, user_id) {
    const messages = await this.messageModel.find({ user_id, category }).sort({ timestamp: -1 }).exec();
    return messages;
  }

  async createMessage(use_vision, vision_messages, text_messages, sender, parameters, images, provider='OpenAI', reasoning_effort='medium', private_msg=false) {
    // Send to OpenAI API
    const model = (await AIModelCards.find({api_model: provider}))[0];
    let response = null;
    if (provider === "OpenAI") response = await chatGPT(vision_messages, 'gpt-4o', private_msg);
    if (provider === "OpenAI_latest") response = await chatGPT(vision_messages, 'gpt-4o-2024-11-20', private_msg);
    if (provider === "OpenAI_mini" || provider === "gpt-4o-mini") response = await chatGPT(vision_messages, 'gpt-4o-mini', private_msg);
    if (provider === "Anthropic") response = await anthropic(vision_messages, 'claude-3-5-sonnet-20241022');
    if (provider.indexOf("Groq-") === 0) response = await groq(vision_messages, provider.split("Groq-")[1]);
    if (provider.indexOf("GroqV-") === 0) response = await groq_vision(vision_messages, provider.split("GroqV-")[1]);
    if (provider.indexOf("o1-") === 0 || provider.indexOf("o3-") === 0) response = await chatGPT_o1(vision_messages, provider, reasoning_effort, private_msg);
    if (provider.indexOf("-audio-") >= 0) response = await chatGPTaudio(vision_messages, provider, private_msg);
    if (provider.indexOf("Google-") === 0) response = await googleAI(vision_messages, provider.split("Google-")[1]);
    if (response == null) {
      if (model.provider === "OpenAI") response = await chatGPT(vision_messages, model.api_model, private_msg);
      if (model.provider === "Anthropic") response = await anthropic(vision_messages, model.api_model);
      if (model.provider === "Groq") response = await groq(vision_messages, model.api_model);
      if (model.provider === "Google") response = await googleAI(vision_messages, model.api_model);
      if (model.provider === "Local") response = await lmstudio.chat(vision_messages);
    }

    // Save a copy in temporary folder, for debugging
    // fs.writeFileSync(`./tmp_data/${Date.now()}[${provider}].json`, JSON.stringify(response, null, 2));
    let filename = null;
    if (response.choices[0].message && response.choices[0].message.audio) {
      filename = `resp-${Date.now()}.mp3`;
      fs.writeFileSync(
        `./public/mp3/${filename}`,
        Buffer.from(response.choices[0].message.audio.data, 'base64'),
        { encoding: "utf-8" }
      );
    }

    // Save to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const chat_message_entry = {
      user_id: sender,
      category: parameters.category,
      tags: tags_array,
      prompt: parameters.prompt,
      response: filename ? response.choices[0].message.audio.transcript : response.choices[0].message.content,
      images,
      sound: filename ? filename : '',
    };
    const db_entry = await new this.messageModel(chat_message_entry).save();

    // Return entry to user
    return { db_entry, tokens: response.usage.total_tokens };
  }

  async CreateCustomMessage(prompt, response, sender, category, images, tags = ["custom_message"]) {
    // If you have generated a prompt-response pair somewhere else, or need to guide the conversation in a certain way, you can save a customs prompt-response pair with this method
    const chat_message_entry = {
      user_id: sender,
      category,
      tags,
      prompt,
      response,
      images,
      sound: '',
    };
    const db_entry = await new this.messageModel(chat_message_entry).save();

    // Return entry to user
    return { db_entry };
  }

  async CreateTitle(message_ids) {
    const msgs = await this.getMessagesByIdArray(message_ids, false);
    const use_model = 'gpt-4.1-nano-2025-04-14';
    const use_messages = [];
    use_messages.push({
      role: "system",
      content: [
        { type: 'text', text: "Your task is to come up with a short, suitable title for the following conversation." }
      ]
    });
    for (let i = 0; i < msgs.length; i++) {
      use_messages.push({
        role: "user",
        content: [ { type: 'text', text: msgs[i].prompt } ]
      });
      use_messages.push({
        role: "assistant",
        content: [ { type: 'text', text: msgs[i].response } ]
      });
    }
    use_messages.push({
      role: "user",
      content: [ { type: 'text', text: 'Please give me a suitable title for our conversation. Please only respond with the title.' } ]
    });
    try {
      const response = await chatGPT_beta(use_messages, use_model, true, {object: Title, title: "title"});
      const details = response.output_parsed;
      const title = details.conversation_title;
      return title;
    } catch (error) {
      logger.error(error);
      return "Error generating title";
    }
  }

  async createMessagesSummary(messages, tokens = 16001) {
    messages.push({
      role: 'user',
      content: 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation.',
    });
    const summary = await chatGPT(messages, 'gpt-4o-2024-11-20');
    return summary.choices[0].message.content;
  }

  async generateChat5Summary({ conversation, messages, model = 'gpt-4.1-mini' }) {
    const visibleMessages = messages.filter((message) => (
      message &&
      message.contentType === 'text' &&
      message.hideFromBot !== true &&
      message.content &&
      typeof message.content.text === 'string' &&
      message.content.text.trim().length > 0
    ));

    if (visibleMessages.length === 0) {
      return '';
    }

    const promptMessages = [{
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'You are an assistant that summarizes conversations. Provide a concise summary (no more than five sentences) that captures the main topics, conclusions, and action items discussed. Base the summary solely on the provided visible text messages and ignore any references to images, audio, or tool outputs. Respond with plain text only.'
        }
      ]
    }];

    visibleMessages.forEach((message) => {
      const role = message.user_id === 'bot' ? 'assistant' : 'user';
      promptMessages.push({
        role,
        content: [
          {
            type: 'text',
            text: message.content.text
          }
        ]
      });
    });

    const response = await chatGPT(promptMessages, model);

    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error('Failed to generate conversation summary');
    }

    return (response.choices[0].message.content || '').trim();
  }

  async generateImage(messageId, image_prompt, quality = 'hd', size = '1024x1024', img_id = null) {
    // Load DB entry
    const message = await this.messageModel.findById(messageId);
    // Prompt Open AI API to generate image
    const { filename, prompt } = await ig(image_prompt, quality, size, img_id ? img_id : Date.now());
    // Save meta data
    const metadata = {
      filename: filename,
      filetype: "image",
      path: `/img/${filename}`,
      is_url: false,
      prompt: prompt,
      created_date: new Date(),
      other_meta_data: JSON.stringify({ quality, size, source: "OpenAI: DALL·E 3" }),
    };
    await new this.fileMetaModel(metadata).save();
    // Append to message and save updates
    message.images.push({
      filename,
      use_flag: 'do not use'
    });
    await message.save();
    return message;
  }

  async generateImage2(params, conversation) {
    const message = await this.messageModel.findById(conversation.messages[conversation.messages.length-1]);
    let image_name;
    if (params.images.length === 0) {
      image_name = await ig2(params.prompt, params.model, params.quality, params.size);
    } else {
      image_name = await imageEdit(params.images, params.prompt, params.model, params.quality, params.size);
    }
    message.images.push({ filename: image_name, use_flag: 'do not use' });
    await message.save();
    return image_name;
  }

  async generateTTS(messageId, tts_prompt, model = "tts-1", voice = "nova", instructions = null) {
    // Load DB entry
    const message = await this.messageModel.findById(messageId);
    // Prompt Open AI API to generate tts sound file
    const { filename, prompt } = await tts(model, tts_prompt, voice, false, instructions);
    // Save meta data
    const metadata = {
      filename: filename,
      filetype: "sound",
      path: `/mp3/${filename}`,
      is_url: false,
      prompt: prompt,
      created_date: new Date(),
      other_meta_data: JSON.stringify({ model, voice, source: "OpenAI: Text-To-Speech" }),
    };
    await new this.fileMetaModel(metadata).save();
    // Update message and save
    message.sound = filename;
    await message.save();
    return message;
  }

  async fetchMessages(user_id, category = null, tag = null, keyword = null) {
    // Create a filter object
    let filter = { user_id };

    // Add category filter if provided
    if (category !== null) {
      filter.category = category;
    }

    // Add tag filter if provided
    if (tag !== null) {
      filter.tags = { $in: [tag] };
    }

    // Add keyword filter if provided
    if (keyword !== null) {
      filter.$or = [
        { prompt: { $regex: keyword, $options: 'i' } }, // case-insensitive match
        { response: { $regex: keyword, $options: 'i' } }
      ];
    }

    // Execute the query with the constructed filter
    const messages = await this.messageModel.find(filter).sort({ timestamp: -1 }).exec();

    // Generate HTML from markdown text for each message
    for (let i = 0; i < messages.length; i++) {
      messages[i].prompt = marked.parse(messages[i].prompt);
      messages[i].response = marked.parse(messages[i].response);
    }

    return messages;
  }

  async emailOneMessage(message_id, title) {
    const message = await this.getMessageById(message_id);
    await MailgunSend(message.response, title);
    return message_id;
  }

  async updateMessage(messageId, category, tags, prompt, response, images, sound, usage_settings, new_image_paths) {
    // Save new images
    for (const imageFile of new_image_paths) {
      const savedImageFilename = await this.processSaveNewImage(imageFile);
      images.push(savedImageFilename);
      usage_settings.push({
        filename: savedImageFilename,
        use_type: 1,
      });
    }

    // Prepare image array
    const imageArray = [];
    const uesType_to_useFlag_map = ['do not use', 'low quality', 'high quality'];
    for (const i of usage_settings) {
      imageArray.push({
        filename: i.filename,
        use_flag: uesType_to_useFlag_map[i.use_type],
      });
    }

    // Update message
    const message = await this.getMessageById(messageId);
    message.category = category;
    message.tags = tags;
    message.prompt = prompt;
    message.response = response;
    message.images = imageArray;
    message.sound = sound;
    await message.save();

    return messageId;
  }

  /*****
   * TOOLS TEST
   */
  async createMessageTool(text_messages, sender, parameters) {
    const tools = [
      {
        "type": "function",
        "function": {
          "name": "generate_image",
          "description": "Generates an image using DALL-E 3 based on the given prompt and returns the path to the image. The response should include the markdown `![Alt text](ImagePath)` to display the image to the user.",
          "parameters": {
            "type": "object",
            "properties": {
              "prompt": {
                "type": "string",
                "description": "A descriptive text prompt for generating the image.",
              }
            },
            "required": ["prompt"],
          },
        }
      }
    ];
    const tool_choice = {"type": "function", "function": {"name": "generate_image"}}
    // Send to OpenAI API : TOOL START
    let tool_response = await chatGPT_Tool(text_messages, 'gpt-4o-2024-11-20', tools, tool_choice);
    text_messages.push(tool_response.choices[0].message);
    const img_id = Date.now();
    text_messages.push({
      "role":"tool", 
      "tool_call_id":tool_response.choices[0].message.tool_calls[0].id, 
      "name": tool_response.choices[0].message.tool_calls[0].function.name, 
      "content":`{path:"/img/image-${img_id}-.jpg"}`
    });
    // Send to OpenAI API : TOOL DONE
    let response = await chatGPT(text_messages, 'gpt-4o-2024-11-20');

    // Save to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const chat_message_entry = {
      user_id: sender,
      category: parameters.category,
      tags: tags_array,
      prompt: parameters.prompt,
      response: response.choices[0].message.content.split("sandbox:/img/").join("/img/").split("attachment://img/").join("/img/").split("attachment:/img/").join("/img/"),
      images: [],
      sound: '',
    };
    const db_entry = await new this.messageModel(chat_message_entry).save();

    // Call TOOL (should be called inbetween TOOL START and TOOL DONE)
    const args = JSON.parse(tool_response.choices[0].message.tool_calls[0].function.arguments);
    await this.generateImage(db_entry._id.toString(), args["prompt"], 'hd', '1024x1024', img_id);

    // Return entry to user
    return { db_entry, tokens: response.usage.total_tokens };
  }

  async processSaveNewImage(filename) {
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
    return new_filename;
  }

  // CHAT5
  async loadMessagesInNewFormat(idArray, isNew = true) {
    if (isNew) {
      const messages = await Chat5Model.find({_id: idArray});
      messages.sort((a,b) => {
        const a_i = idArray.indexOf(a._id.toString());
        const b_i = idArray.indexOf(b._id.toString());
        if (a_i < b_i) return -1;
        if (a_i > b_i) return 1;
        return 0;
      });
      return messages;
    } else {
      const messages = await this.messageModel.find({_id: idArray});
      messages.sort((a,b) => {
        const a_i = idArray.indexOf(a._id.toString());
        const b_i = idArray.indexOf(b._id.toString());
        if (a_i < b_i) return -1;
        if (a_i > b_i) return 1;
        return 0;
      });
      const new_messages = [];
      for (const m of messages) {
        // Images
        if (m.images && m.images.length > 0) {
          for (const i of m.images) {
            const newFormat = {
              user_id: m.user_id,
              category: m.category,
              tags: m.tags,
              contentType: "image",
              content: {
                text: null,
                image: i.filename,
                audio: null,
                tts: null,
                transcript: null,
                revisedPrompt: "",
                imageQuality: i.use_flag === "high quality" ? "high" : "low",
                toolOutput: null,
              },
              timestamp: m.timestamp,
              hideFromBot: i.use_flag === "do not use" ? true : false,
            };
            const msg = new Chat5Model(newFormat);
            new_messages.push(msg);
          }
        }
        // Audio
        if (m.sound && m.sound.length > 0) {
          const newFormat = {
            user_id: m.user_id,
            category: m.category,
            tags: m.tags,
            contentType: "audio",
            content: {
              text: null,
              image: null,
              audio: null,
              tts: m.sound,
              transcript: "",
              revisedPrompt: null,
              imageQuality: null,
              toolOutput: null,
            },
            timestamp: m.timestamp,
            hideFromBot: true,
          };
          const msg = new Chat5Model(newFormat);
          new_messages.push(msg);
        }
        // Text (user)
        const newFormatU = {
          user_id: m.user_id,
          category: m.category,
          tags: m.tags,
          contentType: "text",
          content: {
            text: m.prompt,
            image: null,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: null,
            imageQuality: null,
            toolOutput: null,
          },
          timestamp: m.timestamp,
          hideFromBot: false,
        };
        const msgU = new Chat5Model(newFormatU);
        new_messages.push(msgU);
        // Text (bot)
        const newFormatB = {
          user_id: "bot",
          category: m.category,
          tags: m.tags,
          contentType: "text",
          content: {
            text: m.response,
            image: null,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: null,
            imageQuality: null,
            toolOutput: null,
          },
          timestamp: m.timestamp,
          hideFromBot: false,
        };
        const msgB = new Chat5Model(newFormatB);
        new_messages.push(msgB);
      }
      return new_messages;
    }
  }

  async convertOldMessages(oldIdArray) {
    const newIdsArray = [];
    // Load from old database, transform, and save to new database
    for (const id of oldIdArray) {
      const m = await this.getMessageById(id);
      if (m) {
        // Images
        if (m.images && m.images.length > 0) {
          for (const i of m.images) {
            const newFormat = {
              user_id: m.user_id,
              category: m.category,
              tags: m.tags,
              contentType: "image",
              content: {
                text: null,
                image: i.filename,
                audio: null,
                tts: null,
                transcript: null,
                revisedPrompt: "",
                imageQuality: i.use_flag === "high quality" ? "high" : "low",
                toolOutput: null,
              },
              timestamp: m.timestamp,
              hideFromBot: i.use_flag === "do not use" ? true : false,
            };
            const msg = new Chat5Model(newFormat);
            await msg.save();
            newIdsArray.push(msg._id.toString());
          }
        }
        // Audio
        if (m.sound && m.sound.length > 0) {
          const newFormat = {
            user_id: m.user_id,
            category: m.category,
            tags: m.tags,
            contentType: "audio",
            content: {
              text: null,
              image: null,
              audio: null,
              tts: m.sound,
              transcript: "",
              revisedPrompt: null,
              imageQuality: null,
              toolOutput: null,
            },
            timestamp: m.timestamp,
            hideFromBot: true,
          };
          const msg = new Chat5Model(newFormat);
          await msg.save();
          newIdsArray.push(msg._id.toString());
        }
        // Text (user)
        const newFormatU = {
          user_id: m.user_id,
          category: m.category,
          tags: m.tags,
          contentType: "text",
          content: {
            text: m.prompt,
            image: null,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: null,
            imageQuality: null,
            toolOutput: null,
          },
          timestamp: m.timestamp,
          hideFromBot: false,
        };
        const msgU = new Chat5Model(newFormatU);
        await msgU.save();
        newIdsArray.push(msgU._id.toString());
        // Text (bot)
        const newFormatB = {
          user_id: "bot",
          category: m.category,
          tags: m.tags,
          contentType: "text",
          content: {
            text: m.response,
            image: null,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: null,
            imageQuality: null,
            toolOutput: null,
          },
          timestamp: m.timestamp,
          hideFromBot: false,
        };
        const msgB = new Chat5Model(newFormatB);
        await msgB.save();
        newIdsArray.push(msgB._id.toString());
      }
    }

    return newIdsArray;
  }

  async createMessageNew({ userId, content, contentType, category, tags, hideFromBot = false, conversationId = null }) {
    // Save the input as a new message to database
    const message = {
      user_id: userId,
      category: category,
      tags: tags,
      contentType,
      content,
      timestamp: new Date(),
      hideFromBot: !!hideFromBot,
    };
    const msg = new Chat5Model(message);
    await msg.save();
    await this.syncTextEmbedding({ message: msg, conversationId });
    return msg;
  }

  async createImageMessagesBatch({ userId, category, tags, images }) {
    if (!Array.isArray(images) || images.length === 0) {
      return [];
    }
    const created = [];
    for (const image of images) {
      const messageContent = {
        text: image.text || null,
        image: image.fileName,
        audio: null,
        tts: null,
        transcript: null,
        revisedPrompt: image.revisedPrompt || (image.pageNumber ? `PDF upload page ${image.pageNumber}` : 'PDF upload'),
        imageQuality: image.imageQuality || 'high',
        toolOutput: null,
      };
      const msg = await this.createMessageNew({
        userId,
        content: messageContent,
        contentType: 'image',
        category,
        tags,
      });
      created.push(msg);
    }
    return created;
  }

  async cloneMessages({ messageIds }) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return { ids: [], messages: [] };
    }

    const normalized = messageIds.map(id => id.toString());
    const originals = await Chat5Model.find({ _id: normalized });
    const lookup = new Map();
    for (const message of originals) {
      lookup.set(message._id.toString(), message);
    }

    const clones = [];
    const cloneIds = [];
    for (const id of normalized) {
      const original = lookup.get(id);
      if (!original) {
        logger.warning('cloneMessages: original message not found', { messageId: id });
        continue;
      }

      const cloneContent = cloneDeepMessageContent(original.content);
      const clone = new Chat5Model({
        user_id: original.user_id,
        category: original.category,
        tags: Array.isArray(original.tags) ? [...original.tags] : [],
        contentType: original.contentType,
        content: cloneContent,
        timestamp: original.timestamp ? new Date(original.timestamp) : new Date(),
        hideFromBot: original.hideFromBot,
      });
      await clone.save();
      clones.push(clone);
      cloneIds.push(clone._id.toString());
    }

    return { ids: cloneIds, messages: clones };
  }

  async createMessagesFromSnapshots({ messages, category, tags }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ids: [], messages: [] };
    }

    const clones = [];
    const ids = [];

    for (const snapshot of messages) {
      if (!snapshot || typeof snapshot !== 'object') continue;

      const payload = {
        user_id: snapshot.user_id || 'user',
        category: category || snapshot.category || 'Chat5',
        tags: Array.isArray(snapshot.tags) && snapshot.tags.length > 0 ? [...snapshot.tags] : (Array.isArray(tags) ? [...tags] : []),
        contentType: snapshot.contentType || 'text',
        content: cloneDeepMessageContent(snapshot.content || {}),
        timestamp: snapshot.timestamp ? new Date(snapshot.timestamp) : new Date(),
        hideFromBot: !!snapshot.hideFromBot,
      };

      const msg = new Chat5Model(payload);
      await msg.save();
      clones.push(msg);
      ids.push(msg._id.toString());
    }

    return { ids, messages: clones };
  }

  async deleteMessages(messageIds = []) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
    const normalized = messageIds.map(id => id.toString());
    const result = await Chat5Model.deleteMany({ _id: normalized });
    return result.deletedCount || 0;
  }

  async generateAIMessage({conversation}) {
    // Generate a message through AI and save to database *Can possible generate multiple messages if using tools or reasoning
    const model = (await AIModelCards.find({api_model: conversation.metadata.model}))[0];
    if (!model) {
      throw new Error(`AI model card not found for api_model: ${conversation.metadata.model}`);
    }

    const messages = await Chat5Model.find({_id: conversation.messages});
    const effectiveContextPrompt = buildEffectiveContextPrompt(conversation);
    const runtimeConversation = cloneConversationForAI(conversation, effectiveContextPrompt);

    if (model.provider === "OpenAI") {
      const response_id = await ai.chat(runtimeConversation, messages, model);

      const message = {
        user_id: "bot",
        category: conversation.category,
        tags: conversation.tags,
        contentType: "text",
        content: {
          text: "Pending response",
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        timestamp: new Date(),
        hideFromBot: true,
      };
      const msg = new Chat5Model(message);
      await msg.save();
      return {response_id, msg};
    }

    // Non-OpenAI providers are handled via the local Ollama helper
    const response = await ollama.chat(runtimeConversation, messages, model);
    const assistantText = extractAssistantText(response) || '[No response produced]';

    const message = {
      user_id: "bot",
      category: conversation.category,
      tags: conversation.tags,
      contentType: "text",
      content: {
        text: assistantText,
        image: null,
        audio: null,
        tts: null,
        transcript: null,
        revisedPrompt: null,
        imageQuality: null,
        toolOutput: null,
      },
      timestamp: new Date(),
      hideFromBot: false,
    };
    const msg = new Chat5Model(message);
    await msg.save();
    await this.syncTextEmbedding({ message: msg, conversationId: conversation?._id });
    return {response_id: null, msg};
  }

  async generateDraftResponseWithModel({
    conversation,
    messages = [],
    contextPrompt = '',
    appendedInstructions = '',
    modelName = 'cydonia-24b-q4_k_m:latest',
    userId = 'draft-tool',
  }) {
    if (!conversation) {
      throw new Error('Conversation is required to generate a draft response.');
    }

    const normalizedContext = typeof contextPrompt === 'string' && contextPrompt.trim().length > 0
      ? contextPrompt.trim()
      : buildEffectiveContextPrompt(conversation);
    const runtimeConversation = cloneConversationForAI(conversation, normalizedContext);

    const runtimeMessages = Array.isArray(messages)
      ? messages
          .map((msg) => {
            if (!msg) return null;
            if (typeof msg.toObject === 'function') {
              return msg.toObject({ depopulate: true });
            }
            try {
              return JSON.parse(JSON.stringify(msg));
            } catch (error) {
              return null;
            }
          })
          .filter(Boolean)
      : [];

    if (appendedInstructions && appendedInstructions.trim().length > 0) {
      runtimeMessages.push({
        user_id: userId || 'draft-tool',
        category: conversation.category,
        tags: conversation.tags,
        contentType: 'text',
        content: {
          text: appendedInstructions.trim(),
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        timestamp: new Date(),
        hideFromBot: false,
      });
    }

    const modelCard = await AIModelCards.findOne({ api_model: modelName }) || {
      provider: 'Local',
      api_model: modelName,
      context_type: 'system',
      in_modalities: ['text'],
    };

    const response = await ollama.chat(runtimeConversation, runtimeMessages, modelCard);
    return extractAssistantText(response) || '';
  }

  async toggleHideFromBot({message_id, state}) {
    let message = await Chat5Model.findById(message_id);
    message.hideFromBot = state;
    await message.save();
  }

  async editTextNew({message_id, type, value, conversationId = null}) {
    let message = await Chat5Model.findById(message_id);
    message.content[type] = value;
    await message.save();
    await this.syncTextEmbedding({ message, conversationId });
  }

  async GenerateTitle(message_ids) {
    const msgs = await this.loadMessagesInNewFormat(message_ids, true);
    const use_model = 'gpt-4.1-nano-2025-04-14';
    const use_messages = [];
    use_messages.push({
      role: "system",
      content: [
        { type: 'text', text: "Your task is to come up with a short, suitable title for the following conversation." }
      ]
    });
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].contentType === "text") {
        if (msgs[i].user_id === "bot") {
          if (use_messages[use_messages.length-1].role === "assistant") {
            use_messages[use_messages.length-1].content.push({ type: 'text', text: msgs[i].content.text });
          } else {
            use_messages.push({
              role: "assistant",
              content: [ { type: 'text', text: msgs[i].content.text } ]
            });
          }
        } else {
          if (use_messages[use_messages.length-1].role === "user") {
            use_messages[use_messages.length-1].content.push({ type: 'text', text: msgs[i].content.text });
          } else {
            use_messages.push({
              role: "user",
              content: [ { type: 'text', text: msgs[i].content.text } ]
            });
          }
        }
      }
    }
    use_messages.push({
      role: "user",
      content: [ { type: 'text', text: 'Please give me a suitable title for our conversation. Please only respond with the title.' } ]
    });
    try {
      const response = await chatGPT_beta(use_messages, use_model, true, {object: Title, title: "title"});
      const details = response.output_parsed;
      const title = details.conversation_title;
      return title;
    } catch (error) {
      logger.error(error);
      return "Error generating title";
    }
  }

  // const messages = await this.messageService.processCompletedResponse(conversation, response_id, r.placeholder_id);
  async processCompletedResponse(conversation, response_id) {
    const resp = await ai.fetchCompleted(response_id);
    return this._persistConvertedOutputs(conversation, resp);
  }

  async processConvertedOutputs(conversation, outputs) {
    return this._persistConvertedOutputs(conversation, outputs);
  }

  async _persistConvertedOutputs(conversation, outputs) {
    const newAiMessages = [];
    if (!Array.isArray(outputs)) return newAiMessages;

    for (const m of outputs) {
      if (Object.hasOwn(m, 'error')) {
        if (m.error) newAiMessages.push(m);
      } else {
        const message = {
          user_id: "bot",
          category: conversation.category,
          tags: conversation.tags,
          contentType: m.contentType,
          content: m.content,
          timestamp: new Date(),
          hideFromBot: m.hideFromBot,
        };
        const msg = new Chat5Model(message);
        await msg.save();
        await this.syncTextEmbedding({ message: msg, conversationId: conversation });
        newAiMessages.push(msg);
      }
    }

    return newAiMessages;
  }

  async processFailedResponse(conversation, response_id) {
    // TODO: Only support OpenAi at this stage
    const resp = await ai.fetchCompleted(response_id);
    let error_msg = "Unknown error";
    for (const m of resp) {
      if (Object.hasOwn(m, 'error')) {
        if (m.error) error_msg = m.error;
      }
    }
    return error_msg;
  }
}

const FormData = require('form-data');
const Mailgun = require('mailgun.js');

async function MailgunSend(message_content, title) {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY || "API_KEY",
    // When you have an EU-domain, you must specify the endpoint:
    // url: "https://api.eu.mailgun.net/v3"
  });
  try {
    const data = await mg.messages.create("sandbox77cb26bdd21c4f968fcfe1fc455ec401.mailgun.org", {
      from: "Mailgun Sandbox <postmaster@sandbox77cb26bdd21c4f968fcfe1fc455ec401.mailgun.org>",
      to: ["Lennart Granstrom <lentmiien@gmail.com>"],
      subject: title,
      text: message_content,
      html: marked.parse(message_content),
    });

    logger.notice(data); // logs response data
  } catch (error) {
    logger.notice(error); //logs any error
  }
}

module.exports = MessageService;

function extractAssistantText(response) {
  if (!response || !Array.isArray(response.choices)) return '';
  const segments = [];
  for (const choice of response.choices) {
    if (!choice || !choice.message) continue;
    const flattened = flattenAssistantContent(choice.message.content);
    if (flattened.length > 0) {
      segments.push(flattened);
    }
  }
  return segments.join('\n\n').trim();
}

function flattenAssistantContent(content) {
  if (!content) return '';
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => flattenAssistantContent(item))
      .filter((item) => item && item.length > 0)
      .join('\n\n')
      .trim();
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text.trim();
    }
    if (typeof content.content === 'string') {
      return content.content.trim();
    }
  }
  return '';
}
