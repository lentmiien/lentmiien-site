const fs = require('fs');
const path = require('path');
const context = require('./chat5_5context');

module.exports = async function registerChat5_5Handlers({
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
    helpers: {
      ProcessUploadedImage
    },
    TEMP_DIR
  } = context;

  const roomForUser = io.userRoom;
  const roomForConversation = io.conversationRoom;

  function notifyMembers(user, members, event, payload, { excludeCurrentSocket = true } = {}) {
    if (members.indexOf(user) === -1) members.push(user);
    const rooms = members.map(roomForUser);
    if (excludeCurrentSocket) {
      socket.to(rooms).emit(event, payload);
    } else {
      io.to(rooms).emit(event, payload);
    }
  }

  ///////////////////////////////////
  //----- Conversation rooms ------//
  // Join/Leave conversation room  //
  socket.on('chat5-joinConversation', async (data) => {
    socket.join(roomForConversation(data.conversationId));
  });
  socket.on('chat5-leaveConversation', async (data) => {
    socket.leave(roomForConversation(data.conversationId));
  });

  ////////////////////////////
  //----- Upload text ------//
  // Append to conversation //
  socket.on('chat5-append', async (data) => {
    const {conversation_id, prompt, response, settings} = data;
    let id = conversation_id;
    const user_id = userName;

    const setting_params = {
      contextPrompt: settings.context,
      model: settings.model,
      maxMessages: 999,
      maxAudioMessages: 3,
      tools: settings.tools,
      reasoning: settings.reasoning,
      verbosity: settings.verbosity,
      outputFormat: "text",
    };
    const conv_params = {
      title: settings.title,
      category: settings.category,
      tags: settings.tags,
      members: settings.members,
    };

    // If new conversation
    if (id === "NEW") {
      const c = await conversationService.createNewConversation(user_id, setting_params, conv_params);
      id = c._id.toString();
    }

    const convRoom = roomForConversation(id);
  
    // Post to conversation
    if (prompt) {
      const { userMessage, aiMessages } = await conversationService.postToConversationNew({
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
        generateAI: response,
        s: setting_params,
        c: conv_params,
      });

      aiMessages.unshift(userMessage);

      if (conversation_id === "NEW") {
        socket.emit('chat5-messages', {id, messages: aiMessages});
      } else {
        io.to(convRoom).emit('chat5-messages', { id, messages: aiMessages });
      }
      notifyMembers(user_id, settings.members, 'chat5-notice', { id, title: settings.title }, { excludeCurrentSocket: true });
    } else {
      const { aiMessages } = await conversationService.postToConversationNew({
        conversationId: id,
        userId: user_id,
        messageContent: null,
        messageType: null,
        generateAI: response,
        s: setting_params,
        c: conv_params,
      });

      if (conversation_id === "NEW") {
        socket.emit('chat5-messages', {id, messages: aiMessages});
      } else {
        io.to(convRoom).emit('chat5-messages', { id, messages: aiMessages });
      }
      notifyMembers(user_id, settings.members, 'chat5-notice', { id, title: settings.title }, { excludeCurrentSocket: true });
    }

    // Generate a title if not yet set
    if (settings.title === "NEW") {
      const title = await conversationService.generateTitle(id);
      socket.emit('chat5-generatetitle-done', {title});
    }
  });

  ////////////////////////////
  //----- Upload image -----//
  // Append to conversation //
  socket.on('chat5-uploadImage', async (data) => {
    const { conversation_id, name, buffer } = data; // 'buffer' is an ArrayBuffer
    let id = conversation_id;
    const user_id = userName;

    if (!name || !buffer) {
      socket.emit('chat5-uploadError', { message: 'Invalid file data.' });
      return;
    }

    // If new conversation
    if (id === "NEW") {
      const c = await conversationService.createNewConversation(user_id);
      id = c._id.toString();
    }

    // Pre-process and save to appropriate folder
    const uniqueName = `${Date.now()}_${name}`;
    const filePath = path.join(TEMP_DIR, uniqueName);

    // Convert ArrayBuffer to Buffer
    const fileBuffer = Buffer.from(buffer);

    fs.writeFile(filePath, fileBuffer, async (err) => {
      if (err) {
        console.error(`Error saving file ${name}:`, err);
        // Delete created conversation if new, and an error occured
        if (conversation_id === "NEW") {
          await conversationService.deleteNewConversation(id);
        }
        socket.emit('chat5-uploadError', { message: `Failed to upload ${name}` });
      } else {
        console.log(`File saved: ${filePath}`);
        const uploadFile = await ProcessUploadedImage(filePath);
        // Post to conversation
        const { userMessage } = await conversationService.postToConversationNew({
          conversationId: id,
          userId: user_id,
          messageContent: {
            text: null,
            image: uploadFile,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: "Upload image",
            imageQuality: "high",
            toolOutput: null,
          },
          messageType: "image",
          generateAI: false,
        });
        socket.emit('chat5-messages', {id, messages: [userMessage]});
      }
    });
  });

  // Edit message arraay
  socket.on('chat5-editmessagearray-up', async (data) => {
    const { conversation_id, newArray } = data;
    await conversationService.updateMessageArray(conversation_id, newArray);
    socket.emit('chat5-editmessagearray-done');
  });

  // Toggle hide from bot
  socket.on('chat5-togglehidefrombot-up', async (data) => {
    const { message_id, state } = data;
    await messageService.toggleHideFromBot({message_id, state});
    socket.emit('chat5-togglehidefrombot-done');
  });

  // Edit text
  socket.on('chat5-edittext-up', async (data) => {
    await messageService.editTextNew(data);
  });

  // Generate title
  socket.on('chat5-generatetitle-up', async (data) => {
    const { conversation_id } = data;
    const title = await conversationService.generateTitle(conversation_id);
    socket.emit('chat5-generatetitle-done', {title});
  });
};
