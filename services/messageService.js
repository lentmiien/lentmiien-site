const marked = require('marked');

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
  constructor(messageModel) {
    this.messageModel = messageModel;
  }

  async getMessagesByIdArray(ids) {
    const messages = await this.messageModel.find({ _id: ids });
    messages.sort((a,b) => {
      const a_i = ids.indexOf(a._id.toString());
      const b_i = ids.indexOf(b._id.toString());
      if (a_i > b_i) return -1;
      if (a_i < b_i) return 1;
      return 0;
    });
    for (let i = 0; i < messages.length; i++) {
      messages[i].prompt_html = marked.parse(messages[i].prompt);
      messages[i].response_html = marked.parse(messages[i].response);
    }
    return messages;
  }

  async createMessage(conversationId, text, sender) {
    // const message = await this.messageModel.create({
    //   conversationId,
    //   text,
    //   sender,
    //   createdAt: new Date(),
    // });
    // return message;
  }

  async updateMessage(messageId, newText) {
    // const message = await this.messageModel.findByIdAndUpdate(
    //   messageId,
    //   { text: newText },
    //   { new: true }
    // );
    // return message;
  }
}

module.exports = MessageService;