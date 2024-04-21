const marked = require('marked');
const { chatGPT, tts, ig } = require('../utils/ChatGPT');

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

  async createMessage(use_vision, vision_messages, text_messages, sender, parameters, images) {
    // Send to OpenAI API
    const response = await chatGPT(vision_messages, 'gpt-4-turbo-2024-04-09');

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

  async createMessagesSummary(messages, tokens) {
    messages.push({
      role: 'user',
      content: 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation.',
    });
    const summary = await chatGPT(messages, tokens < 16000 ? 'gpt-3.5-turbo' : 'gpt-4-turbo-2024-04-09');
    return summary.choices[0].message.content;
  }

  async generateImage(messageId, image_prompt, quality = 'hd', size = '1024x1024') {
    // Load DB entry
    const message = await this.messageModel.findById(messageId);
    // Prompt Open AI API to generate image
    const { filename, prompt } = await ig(image_prompt, quality, size);
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
}

module.exports = MessageService;