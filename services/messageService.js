const fs = require('fs');
const sharp = require('sharp');
const marked = require('marked');
const { chatGPT, chatGPTaudio, chatGPT_beta, chatGPT_o1, chatGPT_Tool, tts, ig, ig2, imageEdit } = require('../utils/ChatGPT');
const { anthropic } = require('../utils/anthropic');
const { groq, groq_vision } = require('../utils/groq');
const { googleAI } = require('../utils/google');
const lmstudio = require('../utils/lmstudio');
const ai = require('../utils/OpenAI_API');
const { z } = require('zod');
const logger = require('../utils/logger');

const { AIModelCards, Chat5Model } = require('../database');

const Title = z.object({
  conversation_title: z.string(),
});

// Message service operations: managing individual messages within a conversation
class MessageService {
  constructor(messageModel, fileMetaModel) {
    this.messageModel = messageModel;
    this.fileMetaModel = fileMetaModel;
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

  async createMessageNew({ userId, content, contentType, category, tags }) {
    // Save the input as a new message to database
    const message = {
      user_id: userId,
      category: category,
      tags: tags,
      contentType,
      content,
      timestamp: new Date(),
      hideFromBot: false,
    };
    const msg = new Chat5Model(message);
    await msg.save();
    return msg;
  }

  async generateAIMessage({conversation}) {
    // Generate a message through AI and save to database *Can possible generate multiple messages if using tools or reasoning
    const model = (await AIModelCards.find({api_model: conversation.metadata.model}))[0];
    // TODO: Only support OpenAi at this stage
    if (model.provider != "OpenAI") return null;
    const messages = await Chat5Model.find({_id: conversation.messages});
    const response_id = await ai.chat(conversation, messages, model);

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

  async toggleHideFromBot({message_id, state}) {
    let message = await Chat5Model.findById(message_id);
    message.hideFromBot = state;
    await message.save();
  }

  async editTextNew({message_id, type, value}) {
    let message = await Chat5Model.findById(message_id);
    message.content[type] = value;
    await message.save();
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
