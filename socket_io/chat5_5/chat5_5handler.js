const fs = require('fs');
const path = require('path');
const context = require('./chat5_5context');

module.exports = async function registerChat5_5Handlers({
  socket,
  userName
}) {
  const {
    services: {
      messageService,
      conversationService,
      templateService,
      batchService
    },
    TEMP_DIR
  } = context;

  socket.on('chat5-append', async ({conversation_id, prompt}) => {
    let id = conversation_id;
    const user_id = userName;
  
    // If new conversation
    if (id === "NEW") {
      const c = await conversationService.createNewConversation(user_id);
      id = c._id.toString();
    }
  
    // Post to conversation
    const { userMessage } = await conversationService.postToConversationNew({
      conversationId: id,
      userId: user_id,
      messageContent: {
        text: prompt,
        image: null,
        audio: null,
        tts: null,
        transcript: null,
        revisedPrompt: null,
        imageQuality: null,
        toolOutput: null,
      },
      messageType: "text",
      generateAI: false,
    });
  
    socket.emit('chat5-messages', {id, messages: [userMessage]});
  });
};
