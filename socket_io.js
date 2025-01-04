const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

const MessageService = require('./services/messageService');
const ConversationService = require('./services/conversationService');
const KnowledgeService = require('./services/knowledgeService');
const BatchService = require('./services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, BatchPromptModel, BatchRequestModel, UseraccountModel } = require('./database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

const TEMP_DIR = path.join(__dirname, 'tmp_data');

module.exports = (server, sessionMiddleware) => {
  const io = socketIO(server, {maxHttpBufferSize: 10 * 1024 * 1024});

  // Use the session middleware in Socket.io
  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  // Middleware to check if user is authenticated
  io.use((socket, next) => {
    if (
      socket.request.session &&
      socket.request.session.passport &&
      socket.request.session.passport.user
    ) {
      return next();
    }
    return next(new Error('Unauthorized'));
  });

  // Handle connections
  io.on('connection', async (socket) => {
    const userId = socket.request.session.passport.user;
    const userName = (await UseraccountModel.findOne({ _id: userId })).name;

    // Initialize conversation history and default model for this socket
    socket.conversationTitle = 'Placeholder';
    socket.model = 'gpt-4o-mini';
    socket.conversation_id = "new";
    socket.context = '';
    socket.category = 'Chat5';
    socket.tags = 'chat5';
    socket.images = [];

    console.log(`${userName} connected: ${userId}`);

    /////////////////////////////////
    //----- Load conversation -----//

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
      socket.emit('displayConversationContent', {conversation, messages});
    });

    ////////////////////////
    //----- Settings -----//

    socket.on('userSelectModel', async (model) => {
      socket.model = model;
      console.log(`Switching to model "${model}".`);
    });

    socket.on('userUpdateSettings', async (data) => {
      if (socket.conversation_id && socket.conversation_id != "new" && (
        socket.context != data.context ||
        socket.category != data.category ||
        socket.tags != data.tags
      )) {
        // Updating conversation
        await conversationService.updateConversationSettings(socket.conversation_id, socket.context, socket.category, socket.tags);
        console.log(`New settings: ${JSON.stringify(data, null, 2)}`);
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
          console.error(`Error saving file ${name}:`, err);
          socket.emit('uploadError', { message: `Failed to upload ${name}` });
        } else {
          console.log(`File saved: ${filePath}`);
          socket.images.push(filePath);
          socket.emit('uploadSuccess', { savedImages: socket.images });
        }
      });
    });

    ////////////////////
    //----- Post -----//

    // Handle incoming messages from the client
    socket.on('userMessage', async (userMessage) => {
      const parameters = {
        context: socket.context,
        prompt: userMessage,
        tags: socket.tags,
        title: socket.conversationTitle,
        category: socket.category,
      };
      try {
        const conversation_id = await conversationService.postToConversation(userName, socket.conversation_id, socket.images, parameters, socket.model, "medium", true, [])
        socket.images = [];
        socket.conversation_id = conversation_id;
        const conversation = await conversationService.getConversationsById(conversation_id);
        const message = await messageService.getMessageById(conversation.messages[conversation.messages.length-1]);
        socket.emit('aiResponse', message);
        await batchService.addPromptToBatch(userName, "@SUMMARY", socket.conversation_id, [], {title: socket.conversationTitle}, "gpt-4o-mini");
      } catch (error) {
        console.error('Error processing data:', error);
        socket.emit('error', 'An error occurred while processing your request.');
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
    });
  });
};
