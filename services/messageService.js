const fs = require('fs');
const marked = require('marked');
const { chatGPT, chatGPT_o1, chatGPT_Tool, tts, ig } = require('../utils/ChatGPT');
const { anthropic } = require('../utils/anthropic');
const { groq, groq_vision } = require('../utils/groq');
const { googleAI } = require('../utils/google');

// Message service operations: managing individual messages within a conversation

/* messageModel
{
  user_id: { type: String, required: true, max: 100 },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  prompt: { type: String, required: true },
  response: { type: String, required: true },
  images: [
    {
      filename: { type: String, required: true },
      use_flag: { type: String, required: true, enum: ['high quality', 'low quality', 'do not use'] },
    }
  ],
  sound: { type: String, required: false, max: 255 },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}
*/

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

  async createMessage(use_vision, vision_messages, text_messages, sender, parameters, images, provider='OpenAI') {
    // Send to OpenAI API
    let response;
    if (provider === "OpenAI") response = await chatGPT(vision_messages, 'gpt-4o-2024-05-13');
    if (provider === "OpenAI_latest") response = await chatGPT(vision_messages, 'gpt-4o-2024-08-06');
    if (provider === "OpenAI_mini") response = await chatGPT(vision_messages, 'gpt-4o-mini');
    if (provider === "Anthropic") response = await anthropic(vision_messages, 'claude-3-5-sonnet-20240620');
    if (provider.indexOf("Groq-") === 0) response = await groq(vision_messages, provider.split("Groq-")[1]);
    if (provider.indexOf("GroqV-") === 0) response = await groq_vision(vision_messages, provider.split("GroqV-")[1]);
    if (provider.indexOf("o1-") === 0) response = await chatGPT_o1(vision_messages, provider);
    if (provider.indexOf("Google-") === 0) response = await googleAI(vision_messages, provider.split("Google-")[1]);

    // Save a copy in temporary folder, for debugging
    // fs.writeFileSync(`./tmp_data/${Date.now()}[${provider}].json`, JSON.stringify(response, null, 2));

    // Save to database
    const tags_array = parameters.tags.split(', ').join(',').split(' ').join('_').split(',');
    const chat_message_entry = {
      user_id: sender,
      category: parameters.category,
      tags: tags_array,
      prompt: parameters.prompt,
      response: response.choices[0].message.content,
      images,
      sound: '',
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

  async createMessagesSummary(messages, tokens = 16001) {
    messages.push({
      role: 'user',
      content: 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation.',
    });
    const summary = await chatGPT(messages, 'gpt-4o-2024-05-13');
    return summary.choices[0].message.content;
  }

  async generateImage(messageId, image_prompt, quality = 'hd', size = '1024x1024', img_id = null) {
    // Load DB entry
    const message = await this.messageModel.findById(messageId);
    // Prompt Open AI API to generate image
    const { filename, prompt } = await ig(image_prompt, quality, size, img_id ? img_id : Date.nom());
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

  async generateTTS(messageId, tts_prompt, model = "tts-1", voice = "nova") {
    // Load DB entry
    const message = await this.messageModel.findById(messageId);
    // Prompt Open AI API to generate tts sound file
    const { filename, prompt } = await tts(model, tts_prompt, voice);
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
    let tool_response = await chatGPT_Tool(text_messages, 'gpt-4o-2024-05-13', tools, tool_choice);
    text_messages.push(tool_response.choices[0].message);
    const img_id = Date.now();
    text_messages.push({
      "role":"tool", 
      "tool_call_id":tool_response.choices[0].message.tool_calls[0].id, 
      "name": tool_response.choices[0].message.tool_calls[0].function.name, 
      "content":`{path:"/img/image-${img_id}-.jpg"}`
    });
    // Send to OpenAI API : TOOL DONE
    let response = await chatGPT(text_messages, 'gpt-4o-2024-05-13');

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
}

module.exports = MessageService;