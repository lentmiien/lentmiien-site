const fs = require('fs');
const path = require('path');
const context = require('./chat5_6context');
const logger = require('../../utils/logger');

function toPlain(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true, versionKey: false });
  }
  if (Array.isArray(doc)) return doc.map(toPlain);
  if (typeof doc === 'object') {
    return { ...doc };
  }
  return doc;
}

function toClientMessage(message) {
  const plain = toPlain(message);
  if (!plain) return plain;
  if (plain._id && typeof plain._id !== 'string') plain._id = plain._id.toString();
  if (plain.id && typeof plain.id !== 'string') plain.id = plain.id.toString();
  return plain;
}

function toClientConversation(conversation) {
  const plain = toPlain(conversation);
  if (!plain) return plain;
  if (plain._id && typeof plain._id !== 'string') plain._id = plain._id.toString();
  if (!plain.members) plain.members = [];
  return plain;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  return str.length > 0 ? str : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(lower)) return true;
    if (['false', 'no', '0'].includes(lower)) return false;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return fallback;
    return value !== 0;
  }
  return fallback;
}

function cloneDeep(value) {
  if (value === null || value === undefined) return value;
  if (typeof global.structuredClone === 'function') return global.structuredClone(value);
  if (Array.isArray(value)) return value.map(cloneDeep);
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'object') {
    const output = {};
    for (const [key, val] of Object.entries(value)) {
      output[key] = cloneDeep(val);
    }
    return output;
  }
  return value;
}

module.exports = async function registerChat5_6Handlers({
  io,
  socket,
  userName
}) {
  const {
    models: {
      Conversation5Model,
      AIModelCards
    },
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

  function emitError(eventName, message, extra = {}) {
    const payload = {
      event: eventName,
      message,
      ...extra
    };
    socket.emit('chat5_6-error', payload);
  }

  function notifyMembers(user, members, event, payload, { excludeCurrentSocket = true } = {}) {
    if (!Array.isArray(members) || members.length === 0) return;
    const uniqueMembers = [...new Set(members.filter(Boolean).concat([user]))];
    const rooms = uniqueMembers.map(roomForUser);
    if (excludeCurrentSocket) {
      socket.to(rooms).emit(event, payload);
    } else {
      io.to(rooms).emit(event, payload);
    }
  }

  async function ensureConversationRoom(conversationId) {
    if (!conversationId) return;
    const convRoom = roomForConversation(conversationId);
    const sockets = await io.in(convRoom).fetchSockets();
    const alreadyJoined = sockets.some(s => s.id === socket.id);
    if (!alreadyJoined) {
      await socket.join(convRoom);
    }
    return convRoom;
  }

  async function broadcastMessages(conversationId, messages, { includeSelf = true } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const payload = { id: conversationId, messages: messages.map(toClientMessage) };
    const convRoom = roomForConversation(conversationId);
    if (includeSelf) {
      io.to(convRoom).emit('chat5_6-messages', payload);
    } else {
      socket.to(convRoom).emit('chat5_6-messages', payload);
      socket.emit('chat5_6-messages', payload);
    }
  }

  async function fetchConversationSnapshot(conversationId) {
    const { conv, msg, source } = await conversationService.loadConversation(conversationId);
    return {
      conversation: toClientConversation(conv),
      messages: msg.map(toClientMessage),
      source,
      readOnly: source !== 'conversation5'
    };
  }

  socket.on('chat5_6-joinConversation', async (raw) => {
    try {
      const conversationId = normalizeString(raw);
      if (!conversationId) {
        emitError('chat5_6-joinConversation', 'conversationId is required.');
        return;
      }
      await ensureConversationRoom(conversationId);
      socket.emit('chat5_6-joined', { conversationId });
    } catch (error) {
      logger.error('chat5_6-joinConversation failed', error);
      emitError('chat5_6-joinConversation', 'Unable to join conversation.', { details: error.message });
    }
  });

  socket.on('chat5_6-leaveConversation', async (raw) => {
    try {
      const conversationId = normalizeString(raw);
      if (!conversationId) {
        emitError('chat5_6-leaveConversation', 'conversationId is required.');
        return;
      }
      await socket.leave(roomForConversation(conversationId));
      socket.emit('chat5_6-left', { conversationId });
    } catch (error) {
      logger.error('chat5_6-leaveConversation failed', error);
      emitError('chat5_6-leaveConversation', 'Unable to leave conversation.', { details: error.message });
    }
  });

  socket.on('chat5_6-fetchConversation', async (raw, ack) => {
    const eventName = 'chat5_6-fetchConversation';
    try {
      const conversationId = normalizeString(raw);
      if (!conversationId) {
        throw new Error('conversationId is required.');
      }
      const snapshot = await fetchConversationSnapshot(conversationId);
      if (typeof ack === 'function') {
        ack({ ok: true, ...snapshot });
      } else {
        socket.emit(eventName + ':result', snapshot);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to fetch conversation.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-createConversation', async (raw = {}, ack) => {
    const eventName = 'chat5_6-createConversation';
    try {
      if (!isPlainObject(raw)) {
        throw new Error('Payload must be an object.');
      }
      const settings = isPlainObject(raw.settings) ? raw.settings : {};
      const properties = isPlainObject(raw.properties) ? raw.properties : {};

      const conversation = await conversationService.findOrCreateEmptyConversation({
        userId: userName,
        settings,
        properties,
      });

      await ensureConversationRoom(conversation._id.toString());
      const payload = {
        conversation: toClientConversation(conversation),
        reused: conversation.messages.length === 0,
      };
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to create conversation.', details);
      }
    }
  });

  socket.on('chat5_6-copyConversation', async (raw = {}, ack) => {
    const eventName = 'chat5_6-copyConversation';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const sourceConversationId = normalizeString(raw.sourceConversationId);
      const deepCopy = normalizeBoolean(raw.deepCopy, false);
      if (!sourceConversationId) {
        throw new Error('sourceConversationId is required.');
      }

      const { conversation, messages, source, deepCopied } = await conversationService.copyConversationToChat5({
        sourceConversationId,
        userId: userName,
        deepCopy,
      });

      await ensureConversationRoom(conversation._id.toString());
      const payload = {
        conversation: toClientConversation(conversation),
        messages: messages.map(toClientMessage),
        source,
        deepCopied,
      };

      notifyMembers(userName, conversation.members, 'chat5_6-notice', {
        type: 'copied',
        conversationId: conversation._id.toString(),
        title: conversation.title,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to copy conversation.', details);
      }
    }
  });

  socket.on('chat5_6-updateSettings', async (raw = {}, ack) => {
    const eventName = 'chat5_6-updateSettings';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');

      const metadataUpdates = isPlainObject(raw.settings) ? raw.settings : null;
      const detailUpdates = isPlainObject(raw.details) ? raw.details : null;

      let conversation = null;
      if (metadataUpdates) {
        conversation = await conversationService.updateSettings(conversationId, metadataUpdates);
      }
      if (detailUpdates) {
        conversation = await conversationService.updateConversationDetails(conversationId, detailUpdates);
      }
      if (!conversation) {
        conversation = await Conversation5Model.findById(conversationId);
      }

      if (!conversation) throw new Error('Conversation not found.');

      const payload = { conversation: toClientConversation(conversation) };
      io.to(roomForConversation(conversationId)).emit('chat5_6-conversationUpdated', payload);

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to update settings.', details);
      }
    }
  });

  socket.on('chat5_6-listModels', async (_, ack) => {
    const eventName = 'chat5_6-listModels';
    try {
      const docs = await AIModelCards.find({
        provider: 'OpenAI',
        model_type: 'chat'
      }).sort({ model_name: 1 }).lean();

      const models = docs.map(doc => ({
        id: doc._id.toString(),
        name: doc.model_name,
        apiModel: doc.api_model,
        maxTokens: doc.max_tokens,
        maxOutputTokens: doc.max_out_tokens,
        batch: doc.batch_use,
        inputCostPer1M: doc.input_1m_token_cost,
        outputCostPer1M: doc.output_1m_token_cost,
        inModalities: doc.in_modalities,
        outModalities: doc.out_modalities,
        contextType: doc.context_type,
      }));

      const payload = { models };
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to list models.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-appendMessage', async (raw = {}, ack) => {
    const eventName = 'chat5_6-appendMessage';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      let conversationId = normalizeString(raw.conversationId);
      const text = normalizeString(raw.text);

      if (!text) throw new Error('text is required.');

      let created = false;
      if (!conversationId || conversationId.toUpperCase() === 'NEW') {
        const conversation = await conversationService.createNewConversation(userName);
        conversationId = conversation._id.toString();
        created = true;
      }

      await ensureConversationRoom(conversationId);

      const { conversation, userMessage } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
        messageContent: {
          text,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        messageType: 'text',
        generateAI: false,
      });

      if (userMessage) {
        const messages = [userMessage];
        await broadcastMessages(conversationId, messages, { includeSelf: true });
      }

      const payload = {
        conversationId,
        created,
        messageId: userMessage ? userMessage._id.toString() : null,
      };

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }

      notifyMembers(userName, conversation.members, 'chat5_6-notice', {
        type: 'user-message',
        conversationId,
        title: conversation.title,
      });
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to append message.', details);
      }
    }
  });

  socket.on('chat5_6-appendImage', async (raw = {}, ack) => {
    const eventName = 'chat5_6-appendImage';
    let tempFilePath = null;
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      let conversationId = normalizeString(raw.conversationId);
      const fileName = normalizeString(raw.name || raw.fileName);

      if (!fileName) throw new Error('Image file name is required.');

      let created = false;
      if (!conversationId || conversationId.toUpperCase() === 'NEW') {
        const conversation = await conversationService.createNewConversation(userName);
        conversationId = conversation._id.toString();
        created = true;
      }

      await ensureConversationRoom(conversationId);

      let uploadFile = null;
      const bufferInput = raw.buffer ?? raw.data ?? null;

      if (!bufferInput) {
        const targetPath = path.join('public', 'img', fileName);
        if (!fs.existsSync(targetPath)) {
          throw new Error('Referenced image does not exist.');
        }
        uploadFile = fileName;
      } else {
        let fileBuffer = null;
        if (Buffer.isBuffer(bufferInput)) {
          fileBuffer = bufferInput;
        } else if (bufferInput instanceof ArrayBuffer) {
          fileBuffer = Buffer.from(new Uint8Array(bufferInput));
        } else if (ArrayBuffer.isView(bufferInput)) {
          fileBuffer = Buffer.from(bufferInput.buffer, bufferInput.byteOffset, bufferInput.byteLength);
        } else if (typeof bufferInput === 'string') {
          fileBuffer = Buffer.from(bufferInput, 'base64');
        } else {
          throw new Error('Unsupported buffer format.');
        }

        if (!fileBuffer || fileBuffer.length === 0) throw new Error('Invalid image data.');

        const uniqueName = `${Date.now()}`;
        tempFilePath = path.join(TEMP_DIR, uniqueName);
        await fs.promises.writeFile(tempFilePath, fileBuffer);
        uploadFile = await ProcessUploadedImage(tempFilePath);
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          logger.warning('Unable to cleanup temp image file', cleanupError);
        }
      }

      const { conversation, userMessage } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
        messageContent: {
          text: null,
          image: uploadFile,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: 'Upload image',
          imageQuality: 'high',
          toolOutput: null,
        },
        messageType: 'image',
        generateAI: false,
      });

      if (userMessage) {
        await broadcastMessages(conversationId, [userMessage], { includeSelf: true });
      }

      const payload = {
        conversationId,
        created,
        fileName: uploadFile,
        messageId: userMessage ? userMessage._id.toString() : null,
      };

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }

      notifyMembers(userName, conversation.members, 'chat5_6-notice', {
        type: 'user-image',
        conversationId,
        title: conversation.title,
      });
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (tempFilePath) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          logger.warning('Unable to cleanup temp image after failure', cleanupError);
        }
      }
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to append image.', details);
      }
    }
  });

  socket.on('chat5_6-requestAIResponse', async (raw = {}, ack) => {
    const eventName = 'chat5_6-requestAIResponse';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');

      await ensureConversationRoom(conversationId);
      const { conversation, aiMessages } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
        messageContent: null,
        messageType: null,
        generateAI: true,
      });

      if (aiMessages && aiMessages.length) {
        await broadcastMessages(conversationId, aiMessages, { includeSelf: true });
      }

      const payload = {
        conversationId,
        placeholderIds: aiMessages ? aiMessages.map(m => m._id.toString()) : [],
      };
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }

      notifyMembers(userName, conversation.members, 'chat5_6-notice', {
        type: 'ai-request',
        conversationId,
        title: conversation.title,
      });
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to request AI response.', details);
      }
    }
  });

  socket.on('chat5_6-requestAIBatch', async (raw = {}, ack) => {
    const eventName = 'chat5_6-requestAIBatch';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      let conversationId = normalizeString(raw.conversationId);
      const prompt = typeof raw.prompt === 'string' ? raw.prompt : null;

      if (!conversationId || conversationId.toUpperCase() === 'NEW') {
        const conversation = await conversationService.createNewConversation(userName);
        conversationId = conversation._id.toString();
      }

      await ensureConversationRoom(conversationId);

      let userMessage = null;
      if (prompt && prompt.trim().length > 0) {
        const result = await conversationService.postToConversationNew({
          conversationId,
          userId: userName,
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
          messageType: 'text',
          generateAI: false,
        });
        userMessage = result.userMessage;
      }

      const conversation = await Conversation5Model.findById(conversationId);
      if (!conversation) throw new Error('Conversation not found.');

      const placeholder = await messageService.createMessageNew({
        userId: 'bot',
        contentType: 'text',
        content: {
          text: 'Pending batch response',
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        category: conversation.category,
        tags: conversation.tags,
      });

      conversation.messages.push(placeholder._id.toString());
      conversation.updatedAt = new Date();
      await conversation.save();

      await batchService.addPromptToBatch({
        userId: userName,
        conversationId,
        messageId: placeholder._id.toString(),
        model: conversation.metadata?.model,
        title: conversation.title,
        taskType: 'response',
      });

      const packets = [];
      if (userMessage) packets.push(userMessage);
      packets.push(placeholder);
      await broadcastMessages(conversationId, packets, { includeSelf: true });

      const payload = {
        conversationId,
        placeholderId: placeholder._id.toString(),
      };
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }

      notifyMembers(userName, conversation.members, 'chat5_6-notice', {
        type: 'ai-batch',
        conversationId,
        title: conversation.title,
      });
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to queue batch response.', details);
      }
    }
  });

  socket.on('chat5_6-generateTitle', async (raw = {}, ack) => {
    const eventName = 'chat5_6-generateTitle';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');
      const title = await conversationService.generateTitle(conversationId);
      io.to(roomForConversation(conversationId)).emit('chat5_6-titleGenerated', { conversationId, title });
      if (typeof ack === 'function') {
        ack({ ok: true, conversationId, title });
      } else {
        socket.emit(eventName + ':done', { conversationId, title });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to generate title.', details);
      }
    }
  });

  socket.on('chat5_6-generateSummary', async (raw = {}, ack) => {
    const eventName = 'chat5_6-generateSummary';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');

      const summary = await conversationService.generateSummaryNew(conversationId);
      io.to(roomForConversation(conversationId)).emit('chat5_6-summaryGenerated', { conversationId, summary });

      if (typeof ack === 'function') {
        ack({ ok: true, conversationId, summary });
      } else {
        socket.emit(eventName + ':done', { conversationId, summary });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to generate summary.', details);
      }
    }
  });

  socket.on('chat5_6-updateMessageArray', async (raw = {}, ack) => {
    const eventName = 'chat5_6-updateMessageArray';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      const messages = Array.isArray(raw.messages) ? raw.messages.map(id => id.toString()) : null;
      if (!conversationId) throw new Error('conversationId is required.');
      if (!messages) throw new Error('messages array is required.');

      await conversationService.updateMessageArray(conversationId, messages);
      const payload = { conversationId, length: messages.length };
      io.to(roomForConversation(conversationId)).emit('chat5_6-messageArrayUpdated', payload);

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to update message order.', details);
      }
    }
  });

  socket.on('chat5_6-toggleHideFromBot', async (raw = {}, ack) => {
    const eventName = 'chat5_6-toggleHideFromBot';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const messageId = normalizeString(raw.messageId);
      const state = normalizeBoolean(raw.state, false);
      if (!messageId) throw new Error('messageId is required.');

      await messageService.toggleHideFromBot({ message_id: messageId, state });
      const payload = { messageId, state };
      socket.emit(eventName + ':done', payload);
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to update hide state.', details);
      }
    }
  });

  socket.on('chat5_6-editMessageText', async (raw = {}, ack) => {
    const eventName = 'chat5_6-editMessageText';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const messageId = normalizeString(raw.messageId);
      const editType = normalizeString(raw.type);
      const value = typeof raw.value === 'string' ? raw.value : null;
      if (!messageId) throw new Error('messageId is required.');
      if (!editType) throw new Error('type is required.');
      if (value === null) throw new Error('value is required.');

      await messageService.editTextNew({ message_id: messageId, type: editType, value });
      const payload = { messageId, type: editType, value };
      socket.emit(eventName + ':done', payload);
      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      const details = { message: error.message };
      if (typeof ack === 'function') {
        ack({ ok: false, ...details });
      } else {
        emitError(eventName, 'Unable to edit message.', details);
      }
    }
  });

  socket.on('chat5_6-template-list', async (_, ack) => {
    const eventName = 'chat5_6-template-list';
    try {
      const ids = await templateService.listChat5TemplateIds();
      if (typeof ack === 'function') {
        ack({ ok: true, templates: ids });
      } else {
        socket.emit(eventName + ':done', { templates: ids });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to list templates.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-template-add', async (raw = {}, ack) => {
    const eventName = 'chat5_6-template-add';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');

      const result = await templateService.addChat5Template(conversationId, { refresh: true });
      if (typeof ack === 'function') {
        ack({ ok: true, template: result.template, record: result.record });
      } else {
        socket.emit(eventName + ':done', result);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to add template.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-template-remove', async (raw = {}, ack) => {
    const eventName = 'chat5_6-template-remove';
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');
      const conversationId = normalizeString(raw.conversationId);
      if (!conversationId) throw new Error('conversationId is required.');
      const result = await templateService.removeChat5Template(conversationId);
      if (typeof ack === 'function') {
        ack({ ok: true, ...result });
      } else {
        socket.emit(eventName + ':done', result);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to remove template.', { details: error.message });
      }
    }
  });
  socket.on('chat5_6-template-fetch', async (raw = {}, ack) => {
    const eventName = 'chat5_6-template-fetch';
    try {
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const template = await templateService.getChat5Template(raw.trim(), { refresh: false });
        if (typeof ack === 'function') {
          ack({ ok: true, template });
        } else {
          socket.emit(eventName + ':done', { template });
        }
        return;
      }

      if (isPlainObject(raw) && raw.conversationId) {
        const refresh = normalizeBoolean(raw.refresh, false);
        const template = await templateService.getChat5Template(raw.conversationId, { refresh });
        if (typeof ack === 'function') {
          ack({ ok: true, template });
        } else {
          socket.emit(eventName + ':done', { template });
        }
        return;
      }

      const refreshAll = isPlainObject(raw) ? normalizeBoolean(raw.refresh, false) : false;
      const templates = await templateService.fetchChat5Templates({ refresh: refreshAll });
      if (typeof ack === 'function') {
        ack({ ok: true, templates });
      } else {
        socket.emit(eventName + ':done', { templates });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to fetch templates.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-template-refresh', async (raw = {}, ack) => {
    const eventName = 'chat5_6-template-refresh';
    try {
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const template = await templateService.refreshChat5Template(raw.trim());
        if (typeof ack === 'function') {
          ack({ ok: true, template });
        } else {
          socket.emit(eventName + ':done', { template });
        }
        return;
      }

      if (isPlainObject(raw) && raw.conversationId) {
        const template = await templateService.refreshChat5Template(raw.conversationId);
        if (typeof ack === 'function') {
          ack({ ok: true, template });
        } else {
          socket.emit(eventName + ':done', { template });
        }
        return;
      }

      const templates = await templateService.refreshAllChat5Templates();
      if (typeof ack === 'function') {
        ack({ ok: true, templates });
      } else {
        socket.emit(eventName + ':done', { templates });
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to refresh templates.', { details: error.message });
      }
    }
  });

  socket.on('chat5_6-template-apply', async (raw = {}, ack) => {
    const eventName = 'chat5_6-template-apply';
    const createdMessageIds = [];
    try {
      if (!isPlainObject(raw)) throw new Error('Payload must be an object.');

      const templateId = normalizeString(raw.templateId || raw.templateConversationId);
      const conversationId = normalizeString(raw.conversationId);
      const mode = normalizeString(raw.mode || raw.action || 'update');
      const options = isPlainObject(raw.options) ? raw.options : {};
      const refresh = normalizeBoolean(raw.refresh, false);

      if (!templateId) throw new Error('templateId is required.');
      if (!conversationId) throw new Error('conversationId is required.');

      const template = await templateService.getChat5Template(templateId, { refresh });
      if (!template) throw new Error('Template not found.');

      const conversation = await Conversation5Model.findById(conversationId);
      if (!conversation) throw new Error('Conversation not found.');

      await ensureConversationRoom(conversationId);

      const appendMessages = normalizeBoolean(options.appendMessages ?? options.appendTemplateMessages, false);
      const applyContext = normalizeBoolean(options.applyContext ?? options.setTemplateContext, false);
      const applySettings = normalizeBoolean(options.applySettings ?? options.setTemplateSettings, false);

      const revertable = mode === 'postOnly';
      const originalState = revertable ? {
        metadata: cloneDeep(conversation.metadata),
        messages: [...conversation.messages],
        summary: conversation.summary,
        title: conversation.title,
        category: conversation.category,
        tags: [...(conversation.tags || [])],
      } : null;

      const appendedMessages = [];
      if (appendMessages) {
        if (template.source === 'chat5') {
          const templateMessageIds = Array.isArray(template.conversation && template.conversation.messages)
            ? template.conversation.messages
            : [];
          if (templateMessageIds.length > 0) {
            const { ids, messages } = await messageService.cloneMessages({ messageIds: templateMessageIds });
            appendedMessages.push(...messages);
            createdMessageIds.push(...ids);
            await conversationService.appendMessages(conversationId, ids);
          }
        } else {
          const { ids, messages } = await messageService.createMessagesFromSnapshots({
            messages: template.messages || [],
            category: conversation.category,
            tags: conversation.tags,
          });
          appendedMessages.push(...messages);
          createdMessageIds.push(...ids);
          await conversationService.appendMessages(conversationId, ids);
        }
      }

      if (applyContext) {
        const templateContext = template.conversation && template.conversation.metadata
          ? template.conversation.metadata.contextPrompt || ''
          : '';
        if (templateContext && templateContext.length > 0) {
          const existing = conversation.metadata && conversation.metadata.contextPrompt
            ? conversation.metadata.contextPrompt
            : '';
          const merged = existing.length > 0 ? existing + '\n\n' + templateContext : templateContext;
          await conversationService.updateSettings(conversationId, { contextPrompt: merged });
        }
      }

      if (applySettings) {
        const meta = template.conversation && template.conversation.metadata
          ? template.conversation.metadata
          : {};
        await conversationService.updateSettings(conversationId, meta);
        const detailUpdates = {};
        if (template.conversation && template.conversation.category) detailUpdates.category = template.conversation.category;
        if (template.conversation && Array.isArray(template.conversation.tags)) detailUpdates.tags = template.conversation.tags;
        if (Object.keys(detailUpdates).length > 0) {
          await conversationService.updateConversationDetails(conversationId, detailUpdates);
        }
      }

      const emittedMessages = appendedMessages.map(toClientMessage);
      let aiMessages = [];
      if (mode === 'post' || mode === 'postOnly') {
        const result = await conversationService.postToConversationNew({
          conversationId,
          userId: userName,
          messageContent: null,
          messageType: null,
          generateAI: true,
        });
        aiMessages = result.aiMessages || [];
        emittedMessages.push(...aiMessages.map(toClientMessage));
      }

      if (emittedMessages.length > 0) {
        await broadcastMessages(conversationId, emittedMessages, { includeSelf: true });
      }

      if (revertable && originalState) {
        const placeholderIds = aiMessages.map(m => m._id.toString());
        const filtered = originalState.messages.filter(id => !placeholderIds.includes(id));
        conversation.messages = filtered;
        conversation.metadata = originalState.metadata;
        conversation.summary = originalState.summary;
        conversation.title = originalState.title;
        conversation.category = originalState.category;
        conversation.tags = originalState.tags;
        conversation.updatedAt = new Date();
        await conversation.save();

        if (createdMessageIds.length > 0) {
          await messageService.deleteMessages(createdMessageIds);
          createdMessageIds.length = 0;
        }
      }

      const payload = {
        conversationId,
        templateId,
        mode,
        appendedCount: appendedMessages.length,
        placeholderCount: aiMessages.length,
      };

      if (typeof ack === 'function') {
        ack({ ok: true, ...payload });
      } else {
        socket.emit(eventName + ':done', payload);
      }
    } catch (error) {
      logger.error(eventName + ' failed', error);
      if (createdMessageIds.length > 0) {
        try {
          await messageService.deleteMessages(createdMessageIds);
        } catch (cleanupError) {
          logger.warning('Unable to clean up cloned template messages after failure', cleanupError);
        }
      }
      if (typeof ack === 'function') {
        ack({ ok: false, message: error.message });
      } else {
        emitError(eventName, 'Unable to apply template.', { details: error.message });
      }
    }
  });
};
