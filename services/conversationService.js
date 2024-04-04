// Conversation service operations: managing conversation sessions and summary

/* conversationModel
{
  user_id: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 255 },
  description: { type: String },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  context_prompt: { type: String },
  messages: [{ type: String, required: true, max: 100 }],
}
*/

class ConversationService {
  constructor(conversationModel, messageService) {
    this.conversationModel = conversationModel;
    this.messageService = messageService;
  }

  async getConversationsForUser(user_id) {
    const conversations = await this.conversationModel.find({user_id});
    conversations.reverse();
    return conversations;
  }

  async getConversationsById(conversation_id) {
    return await this.conversationModel.findById(conversation_id);
  }

  async postToConversation(conversation_id, new_images, parameters) {
    let use_vision = false;
    const vision_messages = [];
    const text_messages = [];

    // Set context
    if (parameters.context.length > 0) {
      vision_messages.push({
        role: 'system',
        content: [
          { type: 'text', text: parameters.context }
        ]
      });
      text_messages.push({
        role: 'system',
        content: parameters.context
      });
    }

    // Set previous messages, if not a new conversation
    if (conversation_id != 'new') {
      const conversation = await this.conversationModel.findById(conversation_id);
      const m_id = conversation.messages;
      const prev_messages = await this.messageService.getMessagesByIdArray(m_id, false, parameters);
      // Append messages
      for (let i = 0; i < prev_messages.length; i++) {
        //TODO
      }
    }
  }

  async createConversation(participants) {
    // const conversation = await this.conversationModel.create({
    //   participants,
    //   createdAt: new Date(),
    // });
    // return conversation;
  }

  async updateConversation(conversationId, updateFields) {
    // const conversation = await this.conversationModel.findByIdAndUpdate(
    //   conversationId,
    //   updateFields,
    //   { new: true }
    // );
    // return conversation;
  }

  async summarizeConversation(conversationId) {
    // // Use messageService to retrieve all messages
    // const messages = await this.messageService.getMessages(conversationId);

    // // Summarization logic (which could potentially be complex and involve NLP)
    // const summarizedText = this.summarize(messages); // Mocking the actual summarization
    // return summarizedText;
  }

  loadImageToBase64() {}

  summarize(messages) {
    // // Placeholder for summarizing logic; for now, we return the most recent message
    // if (messages.length === 0) return 'No messages to summarize.';
    // return messages[messages.length - 1].text;
  }
}

module.exports = ConversationService;