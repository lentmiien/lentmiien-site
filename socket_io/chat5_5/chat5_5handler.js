const fs = require('fs');
const path = require('path');
const context = require('./chat5_5context');
const logger = require('../../utils/logger');

module.exports = async function registerChat5_5Handlers({
  io,
  socket,
  userName
}) {
  const {
    models: {
      Conversation5Model,
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

  function notifyMembers(user, members, event, payload, { excludeCurrentSocket = true } = {}) {
    if (members.indexOf(user) === -1) members.push(user);
    const rooms = members.map(roomForUser);
    if (excludeCurrentSocket) {
      socket.to(rooms).emit(event, payload);
    } else {
      io.to(rooms).emit(event, payload);
    }
  }

  const HISTORY_DEFAULT_DAYS = 30;
  const HISTORY_DEFAULT_LIMIT = 100;
  const HISTORY_MAX_LIMIT = 500;

  function ensureDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
      const asDate = new Date(value);
      return Number.isNaN(asDate.getTime()) ? null : asDate;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const direct = new Date(trimmed);
      if (!Number.isNaN(direct.getTime())) return direct;
      const parts = trimmed.split('-').map(part => parseInt(part, 10));
      if (parts.length === 3 && parts.every(part => !Number.isNaN(part))) {
        const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }
    return null;
  }

  function ensureISOString(value) {
    const d = ensureDate(value);
    return d ? d.toISOString() : null;
  }

  function formatAsYMD(value) {
    const d = ensureDate(value);
    if (!d) return null;
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function clampLimit(value) {
    if (value === null || value === undefined) return HISTORY_DEFAULT_LIMIT;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return HISTORY_DEFAULT_LIMIT;
    return Math.min(Math.floor(num), HISTORY_MAX_LIMIT);
  }

  function parseTagsValue(value) {
    if (Array.isArray(value)) {
      const cleaned = value.map(v => (typeof v === 'string' ? v.trim() : '')).filter(v => v.length > 0);
      return [...new Set(cleaned)];
    }
    if (typeof value === 'string') {
      const parts = value.split(',').map(part => part.trim()).filter(part => part.length > 0);
      return [...new Set(parts)];
    }
    return [];
  }

  function computeCategoryOrder(conversations) {
    const map = new Map();
    for (const conv of conversations) {
      const ts = typeof conv.updatedAtMs === 'number' ? conv.updatedAtMs : null;
      if (ts === null) continue;
      const category = conv.category && typeof conv.category === 'string' && conv.category.length > 0 ? conv.category : 'Uncategorized';
      if (!map.has(category)) {
        map.set(category, []);
      }
      const arr = map.get(category);
      if (arr.length < 5) {
        arr.push(ts);
      }
    }
    const entries = [];
    for (const [category, tsList] of map.entries()) {
      if (!tsList.length) continue;
      const avg = tsList.reduce((sum, ts) => sum + ts, 0) / tsList.length;
      entries.push({ category, avg });
    }
    entries.sort((a, b) => b.avg - a.avg);
    return entries.map(entry => entry.category);
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
  socket.on('chat5-history-range', async (payload = {}, ack) => {
    const request = (payload && typeof payload === 'object') ? payload : {};
    const now = new Date();
    let endDate = ensureDate(request.end) || now;
    let startDate = ensureDate(request.start);
    if (!startDate) {
      startDate = new Date(endDate.getTime() - HISTORY_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    }
    if (startDate > endDate) {
      const tmp = startDate;
      startDate = endDate;
      endDate = tmp;
    }
    const includeMessages = request.includeMessages === true;
    const includeLegacy = request.includeLegacy !== false;
    const matchIdsOnly = request.matchIdsOnly === true;
    const limit = clampLimit(request.limit);
    const conversationIds = Array.isArray(request.conversationIds)
      ? request.conversationIds.map(id => (id ? id.toString() : '')).filter(id => id.length > 0)
      : [];
    const conversationIdSet = new Set(conversationIds);

    try {
      const newQuery = { members: userName };
      if (conversationIds.length > 0) {
        newQuery._id = { $in: conversationIds };
      }
      if (!matchIdsOnly) {
        newQuery.updatedAt = { $gte: startDate, $lte: endDate };
      }

      const modernDocs = await Conversation5Model.find(newQuery).sort({ updatedAt: -1 }).exec();
      const modernFormatted = [];
      for (const doc of modernDocs) {
        const raw = doc.toObject();
        const updated = ensureDate(raw.updatedAt) || ensureDate(raw.createdAt) || new Date();
        const createdAt = ensureISOString(raw.createdAt);
        const metadata = raw.metadata ? JSON.parse(JSON.stringify(raw.metadata)) : {};
        const tags = parseTagsValue(raw.tags);
        const members = Array.isArray(raw.members) ? raw.members.map(m => (typeof m === 'string' ? m : '')).filter(m => m.length > 0) : [];
        const messageIds = Array.isArray(raw.messages) ? raw.messages.map(id => id.toString()) : [];
        const conversation = {
          id: raw._id.toString(),
          title: raw.title,
          summary: raw.summary || '',
          category: raw.category || null,
          tags,
          metadata,
          members,
          messageIds,
          messageCount: messageIds.length,
          updatedAt: updated.toISOString(),
          updatedAtMs: updated.getTime(),
          createdAt,
          source: 'conversation5',
        };
        if (includeMessages && messageIds.length > 0) {
          const messages = await messageService.loadMessagesInNewFormat(messageIds, true);
          conversation.messages = messages.map((msg) => {
            const timestamp = ensureDate(msg.timestamp);
            return {
              id: msg._id.toString(),
              role: msg.user_id === 'bot' ? 'assistant' : 'user',
              type: msg.contentType,
              content: {
                text: msg.content ? msg.content.text || null : null,
                image: msg.content ? msg.content.image || null : null,
                audio: msg.content ? msg.content.audio || null : null,
                tts: msg.content ? msg.content.tts || null : null,
                transcript: msg.content ? msg.content.transcript || null : null,
                revisedPrompt: msg.content ? msg.content.revisedPrompt || null : null,
                imageQuality: msg.content ? msg.content.imageQuality || null : null,
                toolOutput: msg.content ? msg.content.toolOutput || null : null,
              },
              timestamp: timestamp ? timestamp.toISOString() : null,
              timestampMs: timestamp ? timestamp.getTime() : null,
              hideFromBot: !!msg.hideFromBot,
            };
          });
        }
        modernFormatted.push(conversation);
      }

      let legacyFormatted = [];
      if (includeLegacy) {
        const startStr = formatAsYMD(startDate);
        const endStr = formatAsYMD(endDate);
        let legacyEntries = await conversationService.getInRange(userName, startStr, endStr);
        if (!Array.isArray(legacyEntries)) {
          legacyEntries = [];
        }
        if (conversationIds.length > 0) {
          legacyEntries = legacyEntries.filter(entry => conversationIdSet.has(entry._id.toString()));
        }
        legacyFormatted = legacyEntries.map((entry) => {
          const updated = ensureDate(entry.updated_date) || new Date();
          const tags = parseTagsValue(entry.tags);
          const response = {
            id: entry._id.toString(),
            title: entry.title,
            summary: entry.summary || '',
            category: entry.category || null,
            tags,
            metadata: null,
            members: [],
            messageIds: [],
            messageCount: Array.isArray(entry.messages) ? entry.messages.length : 0,
            updatedAt: updated.toISOString(),
            updatedAtMs: updated.getTime(),
            createdAt: null,
            source: 'conversation4',
            legacy: true,
          };
          if (includeMessages && Array.isArray(entry.messages)) {
            response.messages = entry.messages.map((msg, index) => ({
              id: `${entry._id}-${index}`,
              role: msg.role || 'user',
              type: 'text',
              content: {
                text: msg.text || null,
                html: msg.html || null,
                images: Array.isArray(msg.images) ? msg.images : [],
              },
              timestamp: null,
              timestampMs: null,
              hideFromBot: false,
            }));
          }
          return response;
        });
      }

      const combinedAll = [...modernFormatted, ...legacyFormatted].sort((a, b) => {
        const aTs = typeof a.updatedAtMs === 'number' ? a.updatedAtMs : 0;
        const bTs = typeof b.updatedAtMs === 'number' ? b.updatedAtMs : 0;
        return bTs - aTs;
      });

      const totalMatches = combinedAll.length;
      const categories = computeCategoryOrder(combinedAll);
      let trimmed = combinedAll;
      let hasMore = false;
      if (combinedAll.length > limit) {
        trimmed = combinedAll.slice(0, limit);
        hasMore = true;
      }

      const pendingConversationIds = await conversationService.fetchPending();
      const responsePayload = {
        ok: true,
        conversations: trimmed,
        meta: {
          total: totalMatches,
          hasMore,
          limit,
          nextCursor: hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1].updatedAt : null,
          start: ensureISOString(startDate),
          end: ensureISOString(endDate),
          includeMessages,
          includeLegacy,
          matchIdsOnly,
          pendingConversationIds,
          categoryOrder: categories,
          counts: {
            modern: modernFormatted.length,
            legacy: legacyFormatted.length,
          },
        },
      };

      if (typeof ack === 'function') {
        ack(responsePayload);
      } else {
        socket.emit('chat5-history-range:result', responsePayload);
      }
    } catch (error) {
      logger.error('chat5-history-range failed', error);
      const errPayload = {
        ok: false,
        message: 'Failed to load conversation history.',
        details: error.message,
      };
      if (typeof ack === 'function') {
        ack(errPayload);
      } else {
        socket.emit('chat5-history-range:error', errPayload);
      }
    }
  });

  socket.on('chat5-append', async (data) => {
    const {conversation_id, prompt, response, settings} = data;
    let id = conversation_id;
    const user_id = userName;

    const parsedMaxMessages = parseInt(settings.maxMessages, 10);
    const effectiveMaxMessages = Number.isNaN(parsedMaxMessages) || parsedMaxMessages <= 0 ? 999 : parsedMaxMessages;

    const setting_params = {
      contextPrompt: settings.context,
      model: settings.model,
      maxMessages: effectiveMaxMessages,
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
      io.to(convRoom).emit('chat5-generatetitle-done', {title});
    }
  });

  socket.on('chat5-batch', async (data) => {
    const { conversation_id, prompt, includePrompt, settings } = data;
    let id = conversation_id;
    const user_id = userName;

    const parsedMaxMessages = parseInt(settings.maxMessages, 10);
    const effectiveMaxMessages = Number.isNaN(parsedMaxMessages) || parsedMaxMessages <= 0 ? 999 : parsedMaxMessages;

    const setting_params = {
      contextPrompt: settings.context,
      model: settings.model,
      maxMessages: effectiveMaxMessages,
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

    try {
      if (id === "NEW") {
        const c = await conversationService.createNewConversation(user_id, setting_params, conv_params);
        id = c._id.toString();
      }

      const convRoom = roomForConversation(id);

      const { userMessage } = await conversationService.postToConversationNew({
        conversationId: id,
        userId: user_id,
        messageContent: includePrompt ? {
          text: prompt,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        } : null,
        messageType: includePrompt ? "text" : null,
        generateAI: false,
        s: setting_params,
        c: conv_params,
      });

      const conversation = await Conversation5Model.findById(id);
      if (!conversation) {
        socket.emit('chat5-batch-error', { message: 'Conversation not found while queuing batch request.' });
        return;
      }

      const placeholder = await messageService.createMessageNew({
        userId: "bot",
        contentType: "text",
        content: {
          text: "Pending batch response",
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
        userId: user_id,
        conversationId: id,
        messageId: placeholder._id.toString(),
        model: settings.model,
        title: settings.title,
        taskType: 'response',
      });

      const packets = [];
      if (userMessage) packets.unshift(userMessage);
      packets.push(placeholder);

      if (conversation_id === "NEW") {
        socket.emit('chat5-messages', { id, messages: packets });
      } else {
        io.to(convRoom).emit('chat5-messages', { id, messages: packets });
      }

      notifyMembers(user_id, settings.members, 'chat5-notice', { id, title: settings.title }, { excludeCurrentSocket: true });
    } catch (error) {
      logger.error('Failed to queue batch request', error);
      socket.emit('chat5-batch-error', { message: 'Unable to queue batch request.' });
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

    const convRoom = roomForConversation(id);

    // Pre-process and save to appropriate folder
    const uniqueName = `${Date.now()}_${name}`;
    const filePath = path.join(TEMP_DIR, uniqueName);

    // Convert ArrayBuffer to Buffer
    const fileBuffer = Buffer.from(buffer);

    fs.writeFile(filePath, fileBuffer, async (err) => {
      if (err) {
        logger.error(`Error saving file ${name}:`, err);
        // Delete created conversation if new, and an error occured
        if (conversation_id === "NEW") {
          await conversationService.deleteNewConversation(id);
        }
        socket.emit('chat5-uploadError', { message: `Failed to upload ${name}` });
      } else {
        logger.notice(`File saved: ${filePath}`);
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

        if (conversation_id === "NEW") {
          socket.emit('chat5-messages', {id, messages: [userMessage]});
        } else {
          io.to(convRoom).emit('chat5-messages', { id, messages: [userMessage] });
        }
        notifyMembers(user_id, [], 'chat5-notice', { id, title: "New Image" }, { excludeCurrentSocket: true });
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
    const convRoom = roomForConversation(conversation_id);
    io.to(convRoom).emit('chat5-generatetitle-done', {title});
  });

  // Update conversation settings
  socket.on('chat5-updateConversation', async (data, ack) => {
    const { conversation_id, updates } = data;
    try {
      const conversation = await conversationService.updateConversationDetails(conversation_id, updates);
      if (!conversation) {
        const message = 'Conversation settings can only be updated for chat5 entries.';
        if (typeof ack === 'function') ack({ ok: false, message });
        return;
      }

      const convRoom = roomForConversation(conversation_id);
      const payload = {
        conversationId: conversation_id,
        title: conversation.title,
        category: conversation.category,
        tags: conversation.tags,
        members: conversation.members,
        metadata: conversation.metadata,
        summary: conversation.summary,
      };

      io.to(convRoom).emit('chat5-conversation-settings-updated', payload);
      if (typeof ack === 'function') ack({ ok: true, conversation: payload });
    } catch (error) {
      logger.error('Failed to update chat5 conversation settings', error);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to update conversation settings.' });
    }
  });

  // Generate summary
  socket.on('chat5-generatesummary-up', async (data) => {
    const { conversation_id } = data;
    try {
      const summary = await conversationService.generateSummaryNew(conversation_id);
      const convRoom = roomForConversation(conversation_id);
      io.to(convRoom).emit('chat5-generatesummary-done', { summary });
    } catch (error) {
      logger.error('Failed to generate chat5 conversation summary', error);
      socket.emit('chat5-generatesummary-error', { message: 'Unable to generate summary. Please try again later.' });
    }
  });

  // Save current content as a template (with ack)
  socket.on('chat5-savetemplate', async (data, ack) => {
    try {
      await templateService.createTemplate(data.Title, data.Type, data.Category, data.TemplateText);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      logger.error('Failed to save template:', err);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to save template' });
    }
  });
};
