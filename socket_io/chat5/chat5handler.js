const fs = require('fs');
const path = require('path');
const context = require('./chat5context');
const logger = require('../../utils/logger');

module.exports = async function registerChat5Handlers({
  io,
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

  // ---- INIT per-connection state as before ----
  socket.conversationTitle = 'Placeholder';
  socket.model             = 'gpt-4.1-2025-04-14';
  socket.conversation_id   = "new";
  socket.context           = '';
  socket.category          = 'Chat5';
  socket.tags              = 'chat5';
  socket.images            = [];
  socket.duplicate         = false;
  socket.reasoning         = "medium";
  socket.delete_messages   = [];

  /////////////////////////////////
  //----- Load conversation -----//

  socket.on('loadLast50Coversations', async () => {
    const conversations = await conversationService.get50LastUpdatedConversationsForUser(userName);
    socket.emit('displayConversations', conversations);
  });

  socket.on('loadConversations', async (query) => {
    const conversations = await conversationService.getConversationsForUserQuery(userName, query);
    socket.emit('displayConversations', conversations);
  });

  socket.on('fetchConversation', async (id) => {
    const conversation = await conversationService.getConversationsById(id);
    const messages = (await messageService.getMessagesByIdArray(conversation.messages)).reverse();

    // Setup values on server side
    socket.conversationTitle = conversation.title;
    //socket.model
    if (conversation.default_model && conversation.default_model.length > 0) {
      socket.model = conversation.default_model;
    } else {
      socket.model = 'gpt-4o-mini';
    }
    //socket.conversation_id
    socket.conversation_id = id;
    //socket.context
    socket.context = conversation.context_prompt;
    //socket.category
    socket.category = conversation.category;
    //socket.tags
    socket.tags = conversation.tags.join(",");

    // Return values to user, for user to setup their values
    socket.emit('setID', id);
    socket.emit('displayConversationContent', {conversation, messages});
  });

  ////////////////////////
  //----- Settings -----//

  socket.on('userSelectModel', async (model) => {
    socket.model = model;
    logger.notice(`Switching to model "${model}".`);
  });

  socket.on('userUpdateSettings', async (data) => {
    if (socket.conversation_id && socket.conversation_id != "new" && (
      socket.context != data.context ||
      socket.category != data.category ||
      socket.tags != data.tags
    )) {
      // Updating conversation
      await conversationService.updateConversationSettings(socket.conversation_id, data.context, data.category, data.tags);
      logger.notice(`New settings: ${JSON.stringify(data, null, 2)}`);
    }
    socket.context = data.context
    socket.category = data.category;
    socket.tags = data.tags;
  });

  socket.on('createTitle', async () => {
    const title = await conversationService.aiTitle(socket.conversation_id);
    socket.conversationTitle = title;
    socket.emit('setTitle', title);
  });

  socket.on('toggleDuplicate', (state) => socket.duplicate = state);

  socket.on('setReasoning', (value) => socket.reasoning = value);

  socket.on('toggleDeleteMessage', async (params) => {
    if (params.state) {
      socket.delete_messages.push(params.id);
    } else {
      socket.delete_messages = socket.delete_messages.filter(d => d != params.id);
    }
  });

  socket.on('deleteOneMessage', async (id) => {
    if (socket.conversation_id != "new") {
      await conversationService.deleteOneMessage(socket.conversation_id, id);
      socket.emit('deleteMessagesFromUI', [id]);
    }
  });

  socket.on('SaveTemplate', async (data) => {
    await templateService.createTemplate(data.Title, data.Type, data.Category, data.TemplateText);
  });

  socket.on('sendAsEmail', async (id) => {
    if (socket.conversation_id != "new") {
      await conversationService.emailOneMessage(socket.conversation_id, id);
    }
  });

  /////////////////////////////
  //----- Upload images -----//

  socket.on('uploadImage', (data) => {
    const { name, buffer } = data; // 'buffer' is an ArrayBuffer

    if (!name || !buffer) {
      socket.emit('uploadError', { message: 'Invalid file data.' });
      return;
    }

    const uniqueName = `${Date.now()}_${name}`;
    const filePath = path.join(TEMP_DIR, uniqueName);

    // Convert ArrayBuffer to Buffer
    const fileBuffer = Buffer.from(buffer);

    fs.writeFile(filePath, fileBuffer, (err) => {
      if (err) {
        logger.error(`Error saving file ${name}:`, err);
        socket.emit('uploadError', { message: `Failed to upload ${name}` });
      } else {
        logger.notice(`File saved: ${filePath}`);
        socket.images.push(filePath);
        socket.emit('uploadSuccess', { savedImages: socket.images });
      }
    });
  });

  ////////////////////
  //----- Post -----//

  // Handle incoming messages from the client
  socket.on('userMessage', async (userMessage) => {
    // Refresh variables, in case of re-connection
    socket.context = userMessage.context;
    socket.tags = userMessage.tags;
    socket.conversationTitle = userMessage.conversationTitle;
    socket.category = userMessage.category;
    socket.duplicate = userMessage.duplicate;
    socket.reasoning = userMessage.reasoning;
    socket.conversation_id = userMessage.conversation_id;
    socket.model = userMessage.model;
    socket.images = userMessage.images;
    socket.delete_messages = userMessage.delete_messages;

    const parameters = {
      context: socket.context,
      prompt: userMessage.msg,
      tags: socket.tags,
      title: socket.conversationTitle,
      category: socket.category,
      max: userMessage.max,
    };
    try {
      if (socket.duplicate && socket.conversation_id != "new") {
        socket.conversation_id = await conversationService.copyConversation(socket.conversation_id, null, null);
        socket.emit('setID', socket.conversation_id);
      }
      if (socket.model.indexOf("batch+") === 0) {
        const api_model = socket.model.split("+")[1];
        const conversation_id = await batchService.addPromptToBatch(userName, userMessage.msg, socket.conversation_id, socket.images, parameters, api_model);
        socket.images = [];
        socket.conversation_id = conversation_id;
        socket.emit('setID', socket.conversation_id);
        socket.emit('batchPending', userMessage.msg);
      } else {
        const conversation_id = await conversationService.postToConversation(userName, socket.conversation_id, socket.images, parameters, socket.model, socket.reasoning, false, socket.delete_messages);
        socket.images = [];
        socket.emit('deleteMessagesFromUI', socket.delete_messages);
        socket.delete_messages = [];
        socket.conversation_id = conversation_id;
        const conversation = await conversationService.getConversationsById(conversation_id);
        const message = await messageService.getMessageById(conversation.messages[conversation.messages.length-1]);
        socket.emit('setID', socket.conversation_id);
        socket.emit('aiResponse', message);
        await batchService.addPromptToBatch(userName, "@SUMMARY", socket.conversation_id, [], {title: socket.conversationTitle}, "gpt-4.1-nano");
      }
    } catch (error) {
      logger.error('Error processing data:', error);
      socket.emit('error', 'An error occurred while processing your request.');
    }
  });

  //////////////////////
  //----- Images -----//

  socket.on('generateImage', async (params) => {
    const image_name = await conversationService.generateImage(params);
    socket.emit('imageDone', image_name);
  });

  // categories/tags/templates emits (if you want them here)
  const categories  = await conversationService.getCategories();
  socket.emit('setCategories', categories);

  const tags = await conversationService.getTags();
  socket.emit('setTags', tags);

  const templates = await templateService.getTemplates();
  socket.emit('setTemplates', templates);
};
