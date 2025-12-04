const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');
const logger = require('./logger');
const { createApiDebugLogger } = require('./apiDebugLogger');

const JS_FILE_NAME = 'utils/Ollama_API.js';
const DEFAULT_BASE_URL = 'http://192.168.0.20:11434';
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

const hostBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL);
const apiBaseUrl = process.env.OLLAMA_API_URL
  ? normalizeBaseUrl(process.env.OLLAMA_API_URL)
  : `${hostBaseUrl}/api`;
const v1BaseUrl = process.env.OLLAMA_V1_URL
  ? normalizeBaseUrl(process.env.OLLAMA_V1_URL)
  : `${hostBaseUrl}/v1`;

const httpClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 120000,
});

const ollamaClient = new OpenAI({
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
  baseURL: v1BaseUrl,
});

let cachedModels = [];

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
  if (!message || typeof message !== 'object') return [];
  const content = message.content || {};
  const type = (message.contentType || '').toLowerCase();
  const items = [];

  const appendText = (text) => {
    if (typeof text === 'string' && text.trim().length > 0) {
      items.push({ type: 'text', text });
    }
  };

  switch (type) {
    case 'text':
      appendText(content.text);
      break;
    case 'image':
      if (role === 'user' && allowImages && content.image) {
        try {
          const b64 = loadImageToBase64(content.image);
          items.push({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${b64}`,
              detail: content.imageQuality === 'high' ? 'high' : 'auto',
            },
          });
        } catch (error) {
          logger.error('Failed to load image for Ollama chat payload', {
            error,
            image: content.image,
          });
          appendText(content.revisedPrompt || `Image reference: ${content.image}`);
        }
      } else if (content.revisedPrompt) {
        appendText(`Image prompt: ${content.revisedPrompt}`);
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

  return items;
};

const buildChatCompletionMessages = (context, messages, allowImages) => {
  const formatted = [];

  if (
    context &&
    context.type &&
    context.type !== 'none' &&
    typeof context.prompt === 'string' &&
    context.prompt.trim().length > 0
  ) {
    formatted.push({
      role: context.type,
      content: [{ type: 'text', text: context.prompt }],
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return formatted;
  }

  let role = determineRole(messages[0]);
  let chunk = [];

  const flush = () => {
    if (chunk.length === 0) return;
    formatted.push({
      role,
      content: chunk,
    });
    chunk = [];
  };

  for (const message of messages) {
    const messageRole = determineRole(message);
    if (messageRole !== role) {
      flush();
      role = messageRole;
    }

    if (message && message.hideFromBot) {
      continue;
    }

    const parts = convertMessageContent({ message, role, allowImages });
    if (parts.length > 0) {
      chunk.push(...parts);
    }
  }

  flush();
  return formatted;
};

const isModelAvailable = (modelName) => {
  if (!modelName) return false;
  return cachedModels.some((model) => {
    if (!model || typeof model !== 'object') return false;
    return model.name === modelName || model.model === modelName;
  });
};

const loadModelList = async () => {
  const requestUrl = `${apiBaseUrl}/tags`;
  try {
    const response = await httpClient.get('/tags');
    const models = Array.isArray(response.data?.models) ? response.data.models : [];
    cachedModels = models;
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
    logger.error('Failed to load Ollama model list', {
      error: error?.message || error,
      requestUrl,
    });
    throw error;
  }
};

const chat = async (conversation, messages, model) => {
  if (!model || typeof model.api_model !== 'string' || model.api_model.length === 0) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  const targetModel = model.api_model;
  if (!isModelAvailable(targetModel)) {
    try {
      await loadModelList();
    } catch (error) {
      throw new Error(`Unable to refresh Ollama model list: ${error.message || error}`);
    }
    if (!isModelAvailable(targetModel)) {
      throw new Error(`Model "${targetModel}" is not available on the configured Ollama instance`);
    }
  }

  const supportsImages = Array.isArray(model.in_modalities) && model.in_modalities.includes('image');
  const contextPrompt = resolveContextPrompt(conversation);
  const messageArray = buildChatCompletionMessages(
    { type: model.context_type || 'system', prompt: contextPrompt },
    Array.isArray(messages) ? messages : [],
    supportsImages,
  );

  if (messageArray.length === 0) {
    throw new Error('No messages available to send to Ollama');
  }

  const payload = {
    model: targetModel,
    messages: messageArray,
    stream: false,
  };

  const metadata = conversation?.metadata || {};
  if (metadata.outputFormat === 'json') {
    payload.response_format = { type: 'json_object' };
  }

  const requestUrl = `${v1BaseUrl}/chat/completions`;
  try {
    const response = await ollamaClient.chat.completions.create(payload);
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: payload,
      responseHeaders: null,
      responseBody: response,
      functionName: 'chat',
    });
    return response;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: payload,
      responseHeaders: headersToObject(error.response?.headers),
      responseBody: error.response?.data || error.message || error,
      functionName: 'chat',
    });
    logger.error('Failed to complete Ollama chat request', {
      error: error?.message || error,
      model: targetModel,
    });
    throw error;
  }
};

const getCachedModels = () => [...cachedModels];

module.exports = {
  loadModelList,
  getCachedModels,
  isModelAvailable,
  chat,
};
