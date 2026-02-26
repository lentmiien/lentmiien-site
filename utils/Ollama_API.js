const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const { createApiDebugLogger } = require('./apiDebugLogger');

const JS_FILE_NAME = 'utils/Ollama_API.js';
const DEFAULT_BASE_URL = 'http://192.168.0.20:8080';
const MODELS_ENDPOINT = '/llm/models';
const CHAT_ENDPOINT = '/llm/chat';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_BASE_URL;
  }
  let normalized = value.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.length > 0 ? normalized : DEFAULT_BASE_URL;
};

const hostBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || process.env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL);

const httpClient = axios.create({
  baseURL: hostBaseUrl,
  timeout: 120000,
});

let cachedModels = [];
let cachedModelTags = [];
let cachedDefaultModel = null;

const normalizeModelIdentifier = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

const extractModelIdentifiers = (model) => {
  if (!model) return [];
  if (typeof model === 'string') {
    const normalized = normalizeModelIdentifier(model);
    return normalized ? [normalized] : [];
  }
  if (typeof model === 'object') {
    const candidates = [
      model.id,
      model.name,
      model.model,
      model.modelName,
    ];
    return candidates
      .map((candidate) => normalizeModelIdentifier(candidate))
      .filter(Boolean);
  }
  return [];
};

const modelMatches = (model, targetId) => {
  if (!targetId) return false;
  return extractModelIdentifiers(model).some((identifier) => identifier === targetId);
};

const describeAvailableModels = () => {
  const identifiers = [
    ...cachedModels,
    ...cachedModelTags,
  ].flatMap((model) => extractModelIdentifiers(model));
  const unique = Array.from(new Set(identifiers)).filter(Boolean);
  return unique.length > 0 ? unique.join(', ') : 'none';
};

const headersToObject = (headers) => {
  if (!headers) return null;
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    return Object.keys(headers).length > 0 ? { ...headers } : null;
  }
  return null;
};

const loadImageToBase64 = (filename) => {
  const filePath = path.resolve(__dirname, '..', 'public', 'img', filename);
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
};

const resolveContextPrompt = (conversation) => {
  if (!conversation) return '';
  if (typeof conversation.context_prompt === 'string') {
    return conversation.context_prompt;
  }
  if (typeof conversation.contextPrompt === 'string') {
    return conversation.contextPrompt;
  }
  const metadata = conversation.metadata || {};
  return (
    metadata.context_prompt ||
    metadata.contextPrompt ||
    ''
  );
};

const determineRole = (message) => (message && message.user_id === 'bot' ? 'assistant' : 'user');

const convertMessageContent = ({ message, role, allowImages }) => {
  if (!message || typeof message !== 'object') {
    return { text: '', images: [] };
  }

  const content = message.content || {};
  const type = (message.contentType || '').toLowerCase();
  const textParts = [];
  const images = [];
  const includeImages = role === 'user' && allowImages;

  const appendText = (text) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      textParts.push(trimmed);
    }
  };

  if (includeImages && Array.isArray(content.images)) {
    content.images.forEach((img) => {
      if (typeof img === 'string' && img.trim().length > 0) {
        images.push(img.trim());
      }
    });
  }

  const tryLoadImageFile = (filename) => {
    if (!includeImages || !filename) return;
    try {
      const b64 = loadImageToBase64(filename);
      images.push(b64);
    } catch (error) {
      logger.error('Failed to load image for Ollama chat payload', {
        error,
        image: filename,
      });
      if (content.revisedPrompt) {
        appendText(content.revisedPrompt);
      } else {
        appendText(`Image reference: ${filename}`);
      }
    }
  };

  switch (type) {
    case 'text':
      appendText(content.text);
      break;
    case 'image':
      if (includeImages && content.image) {
        tryLoadImageFile(content.image);
      }
      if (content.revisedPrompt) {
        appendText(content.revisedPrompt);
      } else if (!includeImages && content.text) {
        appendText(content.text);
      }
      break;
    case 'audio':
      appendText(content.transcript || content.text);
      break;
    default:
      appendText(content.text);
      if (!content.text && content.toolOutput) {
        appendText(content.toolOutput);
      }
      break;
  }

  const text = textParts.join('\n\n');
  return {
    text,
    images: includeImages ? images : [],
  };
};

const buildChatCompletionMessages = (contextPrompt, messages, allowImages) => {
  const formatted = [];

  if (typeof contextPrompt === 'string' && contextPrompt.trim().length > 0) {
    formatted.push({
      role: 'system',
      content: contextPrompt.trim(),
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return formatted;
  }

  for (const message of messages) {
    if (!message || message.hideFromBot) {
      continue;
    }

    const role = determineRole(message);
    const { text, images } = convertMessageContent({ message, role, allowImages });

    if (!text && images.length === 0) {
      continue;
    }

    const entry = {
      role,
      content: text || '',
    };

    if (allowImages && role === 'user' && images.length > 0) {
      entry.images = images;
    }

    formatted.push(entry);
  }

  return formatted;
};

const resolveMaxMessagesLimit = (conversation) => {
  const raw = conversation?.metadata?.maxMessages;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const sanitizeMessagesForLogging = (messages) => {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => {
    if (!message || typeof message !== 'object' || !Array.isArray(message.images) || message.images.length === 0) {
      return message;
    }
    return {
      ...message,
      images: message.images.map((img) => (typeof img === 'string'
        ? `[base64:${img.length} chars]`
        : '[binary image]')),
    };
  });
};

const isModelAvailable = (modelName) => {
  const normalized = normalizeModelIdentifier(modelName);
  if (!normalized) return false;
  return (
    cachedModels.some((model) => modelMatches(model, normalized)) ||
    cachedModelTags.some((model) => modelMatches(model, normalized))
  );
};

const setModelCacheFromResponse = (data) => {
  const models = Array.isArray(data?.models) ? data.models : [];
  const tagModels = Array.isArray(data?.ollama_tags?.models) ? data.ollama_tags.models : [];
  cachedModels = models;
  cachedModelTags = tagModels;
  cachedDefaultModel = typeof data?.default_model === 'string' ? data.default_model : null;
  return models;
};

const loadModelList = async () => {
  const requestUrl = `${hostBaseUrl}${MODELS_ENDPOINT}`;
  try {
    const response = await httpClient.get(MODELS_ENDPOINT);
    const models = setModelCacheFromResponse(response.data);
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders: headersToObject(response.headers),
      responseBody: response.data,
      functionName: 'loadModelList',
    });
    return models;
  } catch (error) {
    const responseHeaders = headersToObject(error.response?.headers);
    const responseBody = error.response?.data || error.message || error;
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders,
      responseBody,
      functionName: 'loadModelList',
    });
    logger.error('Failed to load AI gateway model list', {
      error: error?.message || error,
      requestUrl,
    });
    throw error;
  }
};

const normalizeChatResponse = (data) => {
  if (!data) return { choices: [] };
  if (Array.isArray(data.choices)) {
    return data;
  }
  if (data.message) {
    return {
      ...data,
      choices: [{ message: data.message }],
    };
  }
  if (typeof data.content === 'string') {
    const message = { role: 'assistant', content: data.content };
    return {
      ...data,
      message,
      choices: [{ message }],
    };
  }
  return { ...data, choices: Array.isArray(data.choices) ? data.choices : [] };
};

const chat = async (conversation, messages, model) => {
  if (!model || typeof model.api_model !== 'string' || model.api_model.length === 0) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  const targetModel = normalizeModelIdentifier(model.api_model);
  if (!targetModel) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  if (!isModelAvailable(targetModel)) {
    try {
      await loadModelList();
    } catch (error) {
      throw new Error(`Unable to refresh Ollama model list: ${error.message || error}`);
    }
    if (!isModelAvailable(targetModel)) {
      const available = describeAvailableModels();
      logger.error('Requested model not available on AI gateway', {
        requestedModel: targetModel,
        availableModels: available,
      });
      throw new Error(`Model "${targetModel}" is not available on the configured AI gateway. Available models: ${available}.`);
    }
  }

  const supportsImages = model.allow_images === true
    || (Array.isArray(model.in_modalities) && model.in_modalities.includes('image'));
  const contextPrompt = resolveContextPrompt(conversation);
  const visibleMessages = Array.isArray(messages)
    ? messages.filter((message) => message && !message.hideFromBot)
    : [];
  const maxMessagesLimit = resolveMaxMessagesLimit(conversation);
  const limitedMessages = maxMessagesLimit
    ? visibleMessages.slice(-maxMessagesLimit)
    : visibleMessages;
  const messageArray = buildChatCompletionMessages(
    contextPrompt,
    limitedMessages,
    supportsImages,
  );

  if (messageArray.length === 0) {
    throw new Error('No messages available to send to the AI gateway');
  }

  const payload = {
    model: targetModel,
    messages: messageArray,
  };

  const metadata = conversation?.metadata || {};
  if (typeof metadata.temperature === 'number') {
    payload.temperature = metadata.temperature;
  }
  if (typeof metadata.max_tokens === 'number') {
    payload.max_tokens = metadata.max_tokens;
  }

  const requestUrl = `${hostBaseUrl}${CHAT_ENDPOINT}`;
  const logPayload = {
    ...payload,
    messages: sanitizeMessagesForLogging(payload.messages),
  };

  try {
    const response = await httpClient.post(CHAT_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    const normalizedResponse = normalizeChatResponse(response.data);
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: logPayload,
      responseHeaders: headersToObject(response.headers),
      responseBody: response.data,
      functionName: 'chat',
    });
    return normalizedResponse;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: logPayload,
      responseHeaders: headersToObject(error.response?.headers),
      responseBody: error.response?.data || error.message || error,
      functionName: 'chat',
    });
    logger.error('Failed to complete AI gateway chat request', {
      error: error?.message || error,
      model: targetModel,
    });
    throw error;
  }
};

const getCachedModels = () => [...cachedModels];
const getCachedDefaultModel = () => cachedDefaultModel;

module.exports = {
  loadModelList,
  getCachedModels,
  getCachedDefaultModel,
  isModelAvailable,
  chat,
};
