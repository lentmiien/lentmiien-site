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
      ChatPersonalityModel,
      ChatResponseTypeModel,
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
    const list = Array.isArray(members) ? [...members] : [];
    if (list.indexOf(user) === -1) list.push(user);
    const rooms = list.map(roomForUser);
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

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function pushAdjustment(adjustments, field, message, severity = 'warning') {
    adjustments.push({ field, message, severity });
  }

  function normalizeStringOption(value, fallback, field, adjustments, { allowEmpty = false } = {}) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0 && !allowEmpty) {
        pushAdjustment(adjustments, field, `Empty string provided; using default (${fallback || 'empty string'}).`, 'info');
        return fallback;
      }
      return trimmed;
    }
    if (value === undefined) {
      pushAdjustment(adjustments, field, `Missing value; using default (${fallback || 'empty string'}).`, 'info');
      return fallback;
    }
    if (value === null) {
      pushAdjustment(adjustments, field, `Null provided; using default (${fallback || 'empty string'}).`, 'warning');
      return fallback;
    }
    pushAdjustment(adjustments, field, `Unsupported type "${typeof value}"; using default (${fallback || 'empty string'}).`, 'warning');
    return fallback;
  }

  function normalizePositiveIntOption(value, fallback, field, adjustments) {
    if (value === undefined || value === null || value === '') {
      pushAdjustment(adjustments, field, `Missing value; using default (${fallback}).`, 'info');
      return fallback;
    }
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      pushAdjustment(adjustments, field, `Invalid number "${value}"; using default (${fallback}).`, 'warning');
      return fallback;
    }
    return parsed;
  }

  function normalizeArrayOfStringsOption(value, field, adjustments) {
    if (value === undefined) return [];
    let list = [];
    if (Array.isArray(value)) {
      list = value;
    } else if (typeof value === 'string') {
      list = value.split(/[,\\s]+/);
      pushAdjustment(adjustments, field, 'Converted string input to list by splitting on commas/whitespace.', 'info');
    } else {
      pushAdjustment(adjustments, field, `Unsupported type "${typeof value}"; defaulting to empty array.`, 'warning');
      return [];
    }
    const cleaned = list
      .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(entry => entry.length > 0);
    if (cleaned.length < list.length) {
      pushAdjustment(adjustments, field, 'Removed blank or invalid entries.', 'warning');
    }
    return [...new Set(cleaned)];
  }

  function respondWithError(baseEvent, message, { ack, details, adjustments } = {}) {
    const payload = { ok: false, message };
    if (details) payload.details = details;
    if (adjustments && adjustments.length > 0) payload.adjustments = adjustments;
    if (typeof ack === 'function') {
      ack(payload);
    } else if (baseEvent) {
      socket.emit(`${baseEvent}:error`, payload);
    } else {
      socket.emit('chat5-error', payload);
    }
  }

  function emitAdjustments(baseEvent, adjustments, extra = {}) {
    if (!baseEvent || !Array.isArray(adjustments) || adjustments.length === 0) return;
    socket.emit(`${baseEvent}:adjustments`, { adjustments, ...extra });
  }

  function sanitizeChatSettings(rawSettings, adjustments) {
    let settings = rawSettings;
    if (!isPlainObject(settings)) {
      pushAdjustment(adjustments, 'settings', 'Settings missing or not an object; using defaults.', 'warning');
      settings = {};
    }
    const maxMessages = normalizePositiveIntOption(settings.maxMessages, 999, 'settings.maxMessages', adjustments);
    const contextPrompt = normalizeStringOption(settings.context, '', 'settings.context', adjustments, { allowEmpty: true });
    const model = normalizeStringOption(settings.model, 'gpt-5-2025-08-07', 'settings.model', adjustments);
    const reasoning = normalizeStringOption(settings.reasoning, 'medium', 'settings.reasoning', adjustments);
    const verbosity = normalizeStringOption(settings.verbosity, 'medium', 'settings.verbosity', adjustments);
    const outputFormat = normalizeStringOption(settings.outputFormat, 'text', 'settings.outputFormat', adjustments);
    const title = normalizeStringOption(settings.title, 'NEW', 'settings.title', adjustments);
    const category = normalizeStringOption(settings.category, 'Chat5', 'settings.category', adjustments);
    let tags = normalizeArrayOfStringsOption(settings.tags, 'settings.tags', adjustments);
    if (tags.length === 0) {
      tags = ['chat5'];
      pushAdjustment(adjustments, 'settings.tags', 'Tags missing; defaulted to ["chat5"].', 'info');
    }
    let members = normalizeArrayOfStringsOption(settings.members, 'settings.members', adjustments);
    if (members.length === 0) {
      pushAdjustment(adjustments, 'settings.members', 'Members missing; defaulted to requester.', 'info');
    }
    const tools = normalizeArrayOfStringsOption(settings.tools, 'settings.tools', adjustments);

    return {
      settingParams: {
        contextPrompt,
        model,
        maxMessages,
        maxAudioMessages: 3,
        tools,
        reasoning,
        verbosity,
        outputFormat,
      },
      conversationParams: {
        title,
        category,
        tags,
        members,
      },
    };
  }

  function normalizeBooleanOption(value, defaultValue, field, adjustments) {
    if (value === undefined) {
      pushAdjustment(adjustments, field, `Missing value; using default (${defaultValue}).`, 'info');
      return defaultValue;
    }
    if (value === null) {
      pushAdjustment(adjustments, field, `Null provided; using default (${defaultValue}).`, 'warning');
      return defaultValue;
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      pushAdjustment(adjustments, field, `Unrecognised string "${value}"; using default (${defaultValue}).`, 'warning');
      return defaultValue;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    pushAdjustment(adjustments, field, `Unsupported value type "${typeof value}"; using default (${defaultValue}).`, 'warning');
    return defaultValue;
  }

  function normalizeLimitOption(value, adjustments) {
    if (value === undefined) {
      pushAdjustment(adjustments, 'limit', `Missing limit; using default (${HISTORY_DEFAULT_LIMIT}).`, 'info');
      return HISTORY_DEFAULT_LIMIT;
    }
    if (value === null || value === '') {
      pushAdjustment(adjustments, 'limit', `Empty limit; using default (${HISTORY_DEFAULT_LIMIT}).`, 'warning');
      return HISTORY_DEFAULT_LIMIT;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      pushAdjustment(adjustments, 'limit', `Invalid limit "${value}"; using default (${HISTORY_DEFAULT_LIMIT}).`, 'warning');
      return HISTORY_DEFAULT_LIMIT;
    }
    if (numeric > HISTORY_MAX_LIMIT) {
      pushAdjustment(adjustments, 'limit', `Limit ${numeric} exceeds max ${HISTORY_MAX_LIMIT}; capping value.`, 'warning');
    }
    return clampLimit(numeric);
  }

  function normalizeConversationIds(value, adjustments) {
    if (value === undefined) {
      pushAdjustment(adjustments, 'conversationIds', 'No conversationIds provided; using full search.', 'info');
      return [];
    }
    let list = [];
    if (Array.isArray(value)) {
      list = value;
    } else if (typeof value === 'string') {
      list = value.split(/[,\\s]+/);
      pushAdjustment(adjustments, 'conversationIds', 'Parsed conversationIds from string input.', 'info');
    } else {
      pushAdjustment(adjustments, 'conversationIds', `Unsupported conversationIds type "${typeof value}"; ignoring filter.`, 'warning');
      return [];
    }
    const cleaned = [];
    for (const entry of list) {
      if (entry === null || entry === undefined) continue;
      const trimmed = entry.toString().trim();
      if (trimmed.length === 0) continue;
      cleaned.push(trimmed);
    }
    if (cleaned.length === 0 && list.length > 0) {
      pushAdjustment(adjustments, 'conversationIds', 'Conversation ID filter contained only empty values; ignoring filter.', 'warning');
    }
    if (cleaned.length < list.length) {
      pushAdjustment(adjustments, 'conversationIds', 'Some conversation IDs were blank or invalid and have been removed.', 'warning');
    }
    return [...new Set(cleaned)];
  }

  ///////////////////////////////////
  //----- Conversation rooms ------//
  // Join/Leave conversation room  //
  socket.on('chat5-joinConversation', async (raw) => {
    const eventName = 'chat5-joinConversation';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for joinConversation.');
        return;
      }
      const conversationId = normalizeStringOption(raw.conversationId, '', 'conversationId', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'Conversation ID is required to join.', { adjustments });
        return;
      }
      socket.join(roomForConversation(conversationId));
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to join conversation room', error);
      respondWithError(eventName, 'Failed to join conversation.', { details: error.message, adjustments });
    }
  });
  socket.on('chat5-leaveConversation', async (raw) => {
    const eventName = 'chat5-leaveConversation';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for leaveConversation.');
        return;
      }
      const conversationId = normalizeStringOption(raw.conversationId, '', 'conversationId', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'Conversation ID is required to leave.', { adjustments });
        return;
      }
      socket.leave(roomForConversation(conversationId));
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to leave conversation room', error);
      respondWithError(eventName, 'Failed to leave conversation.', { details: error.message, adjustments });
    }
  });

  ////////////////////////////
  //----- Upload text ------//
  // Append to conversation //
  socket.on('chat5-history-range', async (payload = {}, ack) => {
    const request = (payload && typeof payload === 'object') ? payload : {};
    const adjustments = [];
    const now = new Date();
    let endDate = ensureDate(request.end);
    if (!endDate) {
      if (request.end !== undefined) {
        pushAdjustment(adjustments, 'end', 'End date was invalid; using current time.', 'warning');
      } else {
        pushAdjustment(adjustments, 'end', 'End date missing; using current time.', 'info');
      }
      endDate = now;
    }
    let startDate = ensureDate(request.start);
    if (!startDate) {
      if (request.start !== undefined) {
        pushAdjustment(adjustments, 'start', `Start date was invalid; using ${HISTORY_DEFAULT_DAYS}-day look-back window.`, 'warning');
      } else {
        pushAdjustment(adjustments, 'start', `Start date missing; using ${HISTORY_DEFAULT_DAYS}-day look-back window.`, 'info');
      }
      startDate = new Date(endDate.getTime() - HISTORY_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    }
    if (startDate > endDate) {
      const tmp = startDate;
      startDate = endDate;
      endDate = tmp;
      pushAdjustment(adjustments, 'start', 'Start date was after end date; values swapped.', 'warning');
    }
    const includeMessages = normalizeBooleanOption(request.includeMessages, false, 'includeMessages', adjustments);
    const includeLegacy = normalizeBooleanOption(request.includeLegacy, true, 'includeLegacy', adjustments);
    const matchIdsOnly = normalizeBooleanOption(request.matchIdsOnly, false, 'matchIdsOnly', adjustments);
    const limit = normalizeLimitOption(request.limit, adjustments);
    const conversationIds = normalizeConversationIds(request.conversationIds, adjustments);
    const conversationIdSet = new Set(conversationIds);

    if (matchIdsOnly && conversationIds.length === 0) {
      pushAdjustment(adjustments, 'matchIdsOnly', 'matchIdsOnly requested but no conversationIds supplied; falling back to range search.', 'warning');
    }

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
          adjustments,
          sanitizedRequest: {
            start: ensureISOString(startDate),
            end: ensureISOString(endDate),
            includeMessages,
            includeLegacy,
            matchIdsOnly,
            limit,
            conversationIds,
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
        adjustments,
      };
      if (typeof ack === 'function') {
        ack(errPayload);
      } else {
        socket.emit('chat5-history-range:error', errPayload);
      }
    }
  });

  socket.on('chat5-append', async (raw) => {
    const eventName = 'chat5-append';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for append.');
        return;
      }

      let conversationId = normalizeStringOption(raw.conversation_id, 'NEW', 'conversation_id', adjustments);
      if (conversationId.toUpperCase() === 'NEW') {
        if (conversationId !== 'NEW') {
          pushAdjustment(adjustments, 'conversation_id', 'Normalised conversation ID to "NEW".', 'info');
        }
        conversationId = 'NEW';
      }

      let prompt = '';
      if (raw.prompt === undefined || raw.prompt === null) {
        prompt = '';
      } else if (typeof raw.prompt === 'string') {
        prompt = raw.prompt;
      } else {
        pushAdjustment(adjustments, 'prompt', 'Prompt must be a string; ignoring provided value.', 'warning');
      }
      const hasPrompt = prompt.trim().length > 0;

      const generateResponse = normalizeBooleanOption(raw.response, false, 'response', adjustments);
      const { settingParams, conversationParams } = sanitizeChatSettings(raw.settings, adjustments);
      conversationParams.members = [...new Set([...conversationParams.members, userName])];

      let createdNewConversation = false;
      if (conversationId === 'NEW') {
        const created = await conversationService.createNewConversation(userName, settingParams, conversationParams);
        conversationId = created._id.toString();
        createdNewConversation = true;
      }

      const convRoom = roomForConversation(conversationId);
      const messageContent = hasPrompt ? {
        text: prompt,
        image: null,
        audio: null,
        tts: null,
        transcript: null,
        revisedPrompt: null,
        imageQuality: null,
        toolOutput: null,
      } : null;

      const { userMessage, aiMessages = [] } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
        messageContent,
        messageType: hasPrompt ? "text" : null,
        generateAI: generateResponse,
        s: settingParams,
        c: conversationParams,
      });

      const outgoing = [];
      if (userMessage) outgoing.push(userMessage);
      if (Array.isArray(aiMessages) && aiMessages.length > 0) outgoing.push(...aiMessages);

      if (outgoing.length > 0) {
        if (createdNewConversation) {
          socket.emit('chat5-messages', { id: conversationId, messages: outgoing });
        } else {
          io.to(convRoom).emit('chat5-messages', { id: conversationId, messages: outgoing });
        }
      }

      notifyMembers(userName, conversationParams.members, 'chat5-notice', { id: conversationId, title: conversationParams.title }, { excludeCurrentSocket: true });

      if (conversationParams.title === 'NEW') {
        const title = await conversationService.generateTitle(conversationId);
        io.to(convRoom).emit('chat5-generatetitle-done', { title });
      }

      emitAdjustments(eventName, adjustments, { conversationId, createdNewConversation });
    } catch (error) {
      logger.error('Failed to append chat5 message', error);
      respondWithError(eventName, 'Failed to append message to conversation.', { details: error.message, adjustments });
    }
  });

  socket.on('chat5-draftprompt', async (raw, ack) => {
    const eventName = 'chat5-draftprompt';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for draft prompt.', { ack });
        return;
      }

      const conversationId = normalizeStringOption(raw.conversationId || raw.conversation_id, '', 'conversationId', adjustments);
      if (!conversationId || conversationId === 'NEW') {
        respondWithError(eventName, 'Drafting requires an existing conversation.', { ack, adjustments });
        return;
      }

      const personalityId = normalizeStringOption(raw.personalityId, '', 'personalityId', adjustments);
      const responseTypeId = normalizeStringOption(raw.responseTypeId, '', 'responseTypeId', adjustments);
      if (!personalityId || !responseTypeId) {
        respondWithError(eventName, 'Please select a personality and response type.', { ack, adjustments });
        return;
      }

      const [personality, responseType] = await Promise.all([
        ChatPersonalityModel.findById(personalityId),
        ChatResponseTypeModel.findById(responseTypeId),
      ]);

      if (!personality) {
        respondWithError(eventName, 'Selected personality was not found.', { ack, adjustments });
        return;
      }
      if (!responseType) {
        respondWithError(eventName, 'Selected response type was not found.', { ack, adjustments });
        return;
      }
      if (personality.isActive === false) {
        pushAdjustment(adjustments, 'personalityId', 'Selected personality is inactive.', 'warning');
      }
      if (responseType.isActive === false) {
        pushAdjustment(adjustments, 'responseTypeId', 'Selected response type is inactive.', 'warning');
      }

      const notes = typeof raw.notes === 'string' ? raw.notes : '';

      const prompt = await conversationService.draftPromptForConversation({
        conversationId,
        personality: { name: personality.name, instructions: personality.instructions },
        responseType: { label: responseType.label, instructions: responseType.instructions },
        notes,
        userName,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, prompt });
      } else {
        socket.emit('chat5-draftprompt:result', { ok: true, prompt });
      }
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to generate draft prompt', { error: error.message, user: userName });
      respondWithError(eventName, 'Unable to generate draft prompt.', { ack, details: error.message, adjustments });
    }
  });

  socket.on('chat5-batch', async (raw) => {
    const eventName = 'chat5-batch';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for batch request.');
        return;
      }

      let conversationId = normalizeStringOption(raw.conversation_id, 'NEW', 'conversation_id', adjustments);
      if (conversationId.toUpperCase() === 'NEW') {
        if (conversationId !== 'NEW') {
          pushAdjustment(adjustments, 'conversation_id', 'Normalised conversation ID to "NEW".', 'info');
        }
        conversationId = 'NEW';
      }

      const includePrompt = normalizeBooleanOption(raw.includePrompt, false, 'includePrompt', adjustments);
      let prompt = '';
      if (raw.prompt === undefined || raw.prompt === null) {
        prompt = '';
      } else if (typeof raw.prompt === 'string') {
        prompt = raw.prompt;
      } else {
        pushAdjustment(adjustments, 'prompt', 'Prompt must be a string; ignoring provided value.', 'warning');
      }
      const hasPrompt = includePrompt && prompt.trim().length > 0;
      if (includePrompt && !hasPrompt) {
        pushAdjustment(adjustments, 'includePrompt', 'includePrompt requested but prompt missing; batch will run without prompt.', 'warning');
      }

      const { settingParams, conversationParams } = sanitizeChatSettings(raw.settings, adjustments);
      conversationParams.members = [...new Set([...conversationParams.members, userName])];

      let createdNewConversation = false;
      if (conversationId === 'NEW') {
        const created = await conversationService.createNewConversation(userName, settingParams, conversationParams);
        conversationId = created._id.toString();
        createdNewConversation = true;
      }

      const convRoom = roomForConversation(conversationId);

      const { userMessage } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
        messageContent: hasPrompt ? {
          text: prompt,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        } : null,
        messageType: hasPrompt ? "text" : null,
        generateAI: false,
        s: settingParams,
        c: conversationParams,
      });

      const conversation = await Conversation5Model.findById(conversationId);
      if (!conversation) {
        respondWithError(eventName, 'Conversation not found while queuing batch request.', { adjustments });
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
        userId: userName,
        conversationId,
        messageId: placeholder._id.toString(),
        model: settingParams.model,
        title: conversationParams.title,
        taskType: 'response',
      });

      const packets = [];
      if (userMessage) packets.push(userMessage);
      packets.push(placeholder);

      if (createdNewConversation) {
        socket.emit('chat5-messages', { id: conversationId, messages: packets });
      } else {
        io.to(convRoom).emit('chat5-messages', { id: conversationId, messages: packets });
      }

      notifyMembers(userName, conversationParams.members, 'chat5-notice', { id: conversationId, title: conversationParams.title }, { excludeCurrentSocket: true });
      emitAdjustments(eventName, adjustments, { conversationId, createdNewConversation });
    } catch (error) {
      logger.error('Failed to queue batch request', error);
      respondWithError(eventName, 'Unable to queue batch request.', { details: error.message });
    }
  });

  ////////////////////////////
  //----- Upload image -----//
  // Append to conversation //
  socket.on('chat5-uploadImage', async (raw) => {
    const eventName = 'chat5-uploadImage';
    const adjustments = [];
    let createdNewConversation = false;
    let conversationId = 'NEW';
    let tempFilePath = null;
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for uploadImage.');
        return;
      }

      conversationId = normalizeStringOption(raw.conversation_id, 'NEW', 'conversation_id', adjustments);
      if (conversationId.toUpperCase() === 'NEW') {
        if (conversationId !== 'NEW') {
          pushAdjustment(adjustments, 'conversation_id', 'Normalised conversation ID to "NEW".', 'info');
        }
        conversationId = 'NEW';
      }

      const fileName = normalizeStringOption(raw.name, '', 'name', adjustments);
      if (!fileName) {
        respondWithError(eventName, 'A file name is required for upload.', { adjustments });
        return;
      }

      let fileBuffer = null;
      const bufferInput = raw.buffer;
      if (Buffer.isBuffer(bufferInput)) {
        fileBuffer = bufferInput;
      } else if (bufferInput instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(new Uint8Array(bufferInput));
      } else if (ArrayBuffer.isView(bufferInput)) {
        fileBuffer = Buffer.from(bufferInput.buffer, bufferInput.byteOffset, bufferInput.byteLength);
      } else if (typeof bufferInput === 'string') {
        try {
          fileBuffer = Buffer.from(bufferInput, 'base64');
          pushAdjustment(adjustments, 'buffer', 'Decoded base64 string into binary buffer.', 'info');
        } catch (error) {
          logger.error('Failed to decode base64 buffer', error);
          respondWithError(eventName, 'Invalid base64 data for upload.', { adjustments });
          return;
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        respondWithError(eventName, 'Invalid file data provided.', { adjustments });
        return;
      }

      if (conversationId === 'NEW') {
        const created = await conversationService.createNewConversation(userName);
        conversationId = created._id.toString();
        createdNewConversation = true;
      }

      const convRoom = roomForConversation(conversationId);
      const uniqueName = `${Date.now()}_${fileName}`;
      tempFilePath = path.join(TEMP_DIR, uniqueName);

      await fs.promises.writeFile(tempFilePath, fileBuffer);
      logger.notice(`File saved: ${tempFilePath}`);

      const uploadFile = await ProcessUploadedImage(tempFilePath);
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupError) {
        logger.warning('Failed to cleanup temp upload file', cleanupError);
      }
      const { userMessage } = await conversationService.postToConversationNew({
        conversationId,
        userId: userName,
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

      if (createdNewConversation) {
        socket.emit('chat5-messages', { id: conversationId, messages: [userMessage] });
      } else {
        io.to(convRoom).emit('chat5-messages', { id: conversationId, messages: [userMessage] });
      }
      notifyMembers(userName, [], 'chat5-notice', { id: conversationId, title: "New Image" }, { excludeCurrentSocket: true });
      emitAdjustments(eventName, adjustments, { conversationId, createdNewConversation, fileName });
    } catch (error) {
      logger.error('Failed to upload image in chat5', error);
      if (tempFilePath) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          logger.warning('Failed to cleanup temp upload file after error', cleanupError);
        }
      }
      if (createdNewConversation && conversationId !== 'NEW') {
        try {
          await conversationService.deleteNewConversation(conversationId);
        } catch (cleanupError) {
          logger.error('Failed to clean up conversation after upload error', cleanupError);
        }
      }
      respondWithError(eventName, 'Failed to upload image.', { details: error.message, adjustments });
    }
  });

  // Edit message arraay
  socket.on('chat5-editmessagearray-up', async (raw) => {
    const eventName = 'chat5-editmessagearray-up';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for editmessagearray.');
        return;
      }
      const conversationId = normalizeStringOption(raw.conversation_id, '', 'conversation_id', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'conversation_id is required.', { adjustments });
        return;
      }
      if (!Array.isArray(raw.newArray)) {
        respondWithError(eventName, 'newArray must be an array of message IDs.', { adjustments });
        return;
      }
      const cleaned = raw.newArray.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(value => value.length > 0);
      if (cleaned.length < raw.newArray.length) {
        pushAdjustment(adjustments, 'newArray', 'Removed invalid or blank message IDs.', 'warning');
      }
      await conversationService.updateMessageArray(conversationId, cleaned);
      socket.emit('chat5-editmessagearray-done', { ok: true, conversationId, length: cleaned.length });
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to update message array', error);
      respondWithError(eventName, 'Failed to update message ordering.', { details: error.message, adjustments });
    }
  });

  // Toggle hide from bot
  socket.on('chat5-togglehidefrombot-up', async (raw) => {
    const eventName = 'chat5-togglehidefrombot-up';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for togglehidefrombot.');
        return;
      }
      const messageId = normalizeStringOption(raw.message_id, '', 'message_id', adjustments);
      if (!messageId) {
        respondWithError(eventName, 'message_id is required.', { adjustments });
        return;
      }
      const state = normalizeBooleanOption(raw.state, false, 'state', adjustments);
      await messageService.toggleHideFromBot({ message_id: messageId, state });
      socket.emit('chat5-togglehidefrombot-done', { ok: true, messageId, state });
      emitAdjustments(eventName, adjustments, { messageId });
    } catch (error) {
      logger.error('Failed to toggle hideFromBot', error);
      respondWithError(eventName, 'Failed to update hide-from-bot state.', { details: error.message, adjustments });
    }
  });

  // Edit text
  socket.on('chat5-edittext-up', async (raw) => {
    const eventName = 'chat5-edittext-up';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for edittext.');
        return;
      }
      const messageId = normalizeStringOption(raw.message_id, '', 'message_id', adjustments);
      if (!messageId) {
        respondWithError(eventName, 'message_id is required.', { adjustments });
        return;
      }
      const allowedTypes = ['text', 'tts', 'transcript', 'revisedPrompt', 'toolOutput', 'html'];
      const editType = normalizeStringOption(raw.type, '', 'type', adjustments);
      if (!editType || !allowedTypes.includes(editType)) {
        respondWithError(eventName, 'Unsupported edit type.', { adjustments });
        return;
      }
      let value = '';
      if (raw.value === undefined || raw.value === null) {
        value = '';
      } else if (typeof raw.value === 'string') {
        value = raw.value;
      } else {
        pushAdjustment(adjustments, 'value', 'Coerced value to string.', 'warning');
        value = String(raw.value);
      }
      await messageService.editTextNew({ message_id: messageId, type: editType, value });
      socket.emit('chat5-edittext-done', { ok: true, messageId, type: editType });
      emitAdjustments(eventName, adjustments, { messageId, type: editType });
    } catch (error) {
      logger.error('Failed to edit message text', error);
      respondWithError(eventName, 'Failed to edit message text.', { details: error.message, adjustments });
    }
  });

  // Generate title
  socket.on('chat5-generatetitle-up', async (raw) => {
    const eventName = 'chat5-generatetitle-up';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for generatetitle.');
        return;
      }
      const conversationId = normalizeStringOption(raw.conversation_id, '', 'conversation_id', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'conversation_id is required to generate a title.', { adjustments });
        return;
      }
      const title = await conversationService.generateTitle(conversationId);
      const convRoom = roomForConversation(conversationId);
      io.to(convRoom).emit('chat5-generatetitle-done', { title });
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to generate title', error);
      respondWithError(eventName, 'Failed to generate title.', { details: error.message, adjustments });
    }
  });

  // Update conversation settings
  socket.on('chat5-updateConversation', async (raw, ack) => {
    const eventName = 'chat5-updateConversation';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for updateConversation.', { ack });
        return;
      }
      const conversationId = normalizeStringOption(raw.conversation_id, '', 'conversation_id', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'conversation_id is required to update settings.', { ack, adjustments });
        return;
      }
      if (!isPlainObject(raw.updates)) {
        respondWithError(eventName, 'updates must be an object.', { ack, adjustments });
        return;
      }

      const conversation = await conversationService.updateConversationDetails(conversationId, raw.updates);
      if (!conversation) {
        const message = 'Conversation settings can only be updated for chat5 entries.';
        respondWithError(eventName, message, { ack, adjustments });
        return;
      }

      const convRoom = roomForConversation(conversationId);
      const payload = {
        conversationId,
        title: conversation.title,
        category: conversation.category,
        tags: conversation.tags,
        members: conversation.members,
        metadata: conversation.metadata,
        summary: conversation.summary,
      };

      io.to(convRoom).emit('chat5-conversation-settings-updated', payload);
      if (typeof ack === 'function') ack({ ok: true, conversation: payload });
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to update chat5 conversation settings', error);
      respondWithError(eventName, 'Failed to update conversation settings.', { ack, details: error.message, adjustments });
    }
  });

  // Generate summary
  socket.on('chat5-generatesummary-up', async (raw) => {
    const eventName = 'chat5-generatesummary-up';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for generatesummary.');
        return;
      }
      const conversationId = normalizeStringOption(raw.conversation_id, '', 'conversation_id', adjustments);
      if (!conversationId) {
        respondWithError(eventName, 'conversation_id is required to generate a summary.', { adjustments });
        return;
      }
      const summary = await conversationService.generateSummaryNew(conversationId);
      const convRoom = roomForConversation(conversationId);
      io.to(convRoom).emit('chat5-generatesummary-done', { summary });
      emitAdjustments(eventName, adjustments, { conversationId });
    } catch (error) {
      logger.error('Failed to generate chat5 conversation summary', error);
      socket.emit('chat5-generatesummary-error', { message: 'Unable to generate summary. Please try again later.' });
    }
  });

  // Save current content as a template (with ack)
  socket.on('chat5-savetemplate', async (raw, ack) => {
    const eventName = 'chat5-savetemplate';
    const adjustments = [];
    try {
      if (!isPlainObject(raw)) {
        respondWithError(eventName, 'Invalid payload for savetemplate.', { ack });
        return;
      }
      const title = normalizeStringOption(raw.Title, '', 'Title', adjustments);
      const type = normalizeStringOption(raw.Type, '', 'Type', adjustments);
      const category = normalizeStringOption(raw.Category, '', 'Category', adjustments);
      let templateText = '';
      if (raw.TemplateText === undefined || raw.TemplateText === null) {
        templateText = '';
      } else if (typeof raw.TemplateText === 'string') {
        templateText = raw.TemplateText;
      } else {
        pushAdjustment(adjustments, 'TemplateText', 'Coerced template text to string.', 'warning');
        templateText = String(raw.TemplateText);
      }

      if (!title || !type || !category) {
        respondWithError(eventName, 'Title, Type, and Category are required.', { ack, adjustments });
        return;
      }

      await templateService.createTemplate(title, type, category, templateText);
      if (typeof ack === 'function') ack({ ok: true });
      emitAdjustments(eventName, adjustments, { title, type, category });
    } catch (err) {
      logger.error('Failed to save template:', err);
      respondWithError(eventName, 'Failed to save template.', { ack, details: err.message, adjustments });
    }
  });
};
