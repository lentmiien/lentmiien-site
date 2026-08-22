const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');
const { createApiDebugLogger } = require('./apiDebugLogger');
const ToolManagerService = require('../services/toolManagerService');
const { sliceMessagesFromConfiguredStart } = require('./chat5MessageSelection');

const JS_FILE_NAME = 'utils/Ollama_API.js';
const DEFAULT_BASE_URL = 'http://192.168.0.20:8080';
const DEFAULT_WEBHOOK_BASE_URL = 'https://my.lentmiien.com/';
const MODELS_ENDPOINT = '/llm/models';
const CHAT_ENDPOINT = '/llm/chat';
const CHAT_JOBS_ENDPOINT = '/llm/chat/jobs';
const WEBHOOK_PATH = '/webhook/ollama';
const WEBHOOK_TOKEN_PARAM = 'token';
const WEBHOOK_TOKEN_CONTEXT = 'lentmiien-ollama-webhook-v1';
const JOB_REQUEST_TIMEOUT_MS = 30000;
const JOB_STATUS_TIMEOUT_MS = 30000;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_JOB_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const GEMMA4_ESCAPE_TOKEN = '<|"|>';
const OPENAI_BUILT_IN_TOOL_NAMES = new Set([
  'image_generation',
  'web_search_preview',
]);
const toolManagerService = new ToolManagerService();

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

let warnedAboutSessionSecretFallback = false;
let warnedAboutShortWebhookSecret = false;

const getWebhookSecretMaterial = () => {
  const configuredSecret = typeof process.env.OLLAMA_WEBHOOK_SECRET === 'string'
    ? process.env.OLLAMA_WEBHOOK_SECRET.trim()
    : '';
  if (configuredSecret) {
    return configuredSecret;
  }

  const sessionSecret = typeof process.env.SESSION_SECRET === 'string'
    ? process.env.SESSION_SECRET.trim()
    : '';
  if (sessionSecret && !warnedAboutSessionSecretFallback) {
    warnedAboutSessionSecretFallback = true;
    void logger.warning('OLLAMA_WEBHOOK_SECRET is not configured; deriving the callback token from SESSION_SECRET', {
      category: 'ollama_webhook',
      metadata: {
        recommendation: 'Configure a separate OLLAMA_WEBHOOK_SECRET before rotating SESSION_SECRET.',
      },
    });
  }
  return sessionSecret;
};

const getWebhookToken = () => {
  const secret = getWebhookSecretMaterial();
  if (!secret) {
    throw new Error('OLLAMA_WEBHOOK_SECRET or SESSION_SECRET is required for Ollama background jobs');
  }
  if (secret.length < 32 && !warnedAboutShortWebhookSecret) {
    warnedAboutShortWebhookSecret = true;
    void logger.warning('Ollama webhook secret material is shorter than 32 characters', {
      category: 'ollama_webhook',
      metadata: {
        configuredLength: secret.length,
        recommendation: 'Use a randomly generated OLLAMA_WEBHOOK_SECRET of at least 32 characters.',
      },
    });
  }
  return crypto.createHmac('sha256', secret).update(WEBHOOK_TOKEN_CONTEXT).digest('hex');
};

const normalizeWebhookBaseUrl = (value) => {
  const raw = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_WEBHOOK_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error('OLLAMA_WEBHOOK_BASE_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('OLLAMA_WEBHOOK_BASE_URL must use http or https');
  }
  const loopbackHost = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol === 'http:' && !loopbackHost) {
    throw new Error('OLLAMA_WEBHOOK_BASE_URL must use https unless it targets loopback');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('OLLAMA_WEBHOOK_BASE_URL must not contain credentials or a fragment');
  }
  parsed.search = '';
  return parsed;
};

const buildWebhookUrl = () => {
  const baseUrl = normalizeWebhookBaseUrl(process.env.OLLAMA_WEBHOOK_BASE_URL || DEFAULT_WEBHOOK_BASE_URL);
  const webhookUrl = new URL(WEBHOOK_PATH, baseUrl);
  webhookUrl.searchParams.set(WEBHOOK_TOKEN_PARAM, getWebhookToken());
  return webhookUrl.toString();
};

const redactWebhookUrl = (value) => {
  if (typeof value !== 'string' || value.length === 0) return value;
  try {
    const parsed = new URL(value);
    if (parsed.searchParams.has(WEBHOOK_TOKEN_PARAM)) {
      parsed.searchParams.set(WEBHOOK_TOKEN_PARAM, '[redacted]');
    }
    return parsed.toString();
  } catch (error) {
    return '[invalid webhook URL]';
  }
};

const verifyWebhookToken = (candidate) => {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  let expected;
  try {
    expected = getWebhookToken();
  } catch (error) {
    return false;
  }
  const providedBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const isValidChatJobId = (value) => typeof value === 'string' && JOB_ID_PATTERN.test(value);

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

const isGemma4Model = (value) => normalizeModelIdentifier(value).toLowerCase().startsWith('gemma4');

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

const getMessageIdentity = (message, fallbackIndex = 0) => {
  if (!message) return `message-${fallbackIndex}`;
  const rawId = message._id || message.id;
  if (!rawId) return `message-${fallbackIndex}`;
  if (typeof rawId === 'string') return rawId;
  if (typeof rawId.toString === 'function') return rawId.toString();
  return `message-${fallbackIndex}`;
};

const isFunctionReplayMessage = (message) => (
  message?.contentType === 'function_call' || message?.contentType === 'function_call_output'
);

const isReasoningReplayMessage = (message) => message?.contentType === 'reasoning';

const findLastFunctionReplayBatch = (messages = []) => {
  const batch = new Set();
  let foundBatch = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    if (isFunctionReplayMessage(message)) {
      batch.add(getMessageIdentity(message, index));
      foundBatch = true;
      continue;
    }
    if (foundBatch && isReasoningReplayMessage(message)) {
      batch.add(getMessageIdentity(message, index));
      continue;
    }
    if (foundBatch && !message.hideFromBot) {
      break;
    }
  }

  return batch;
};

const selectMessagesForOllama = (messages = [], maxMessagesLimit = null, { includeLastToolBatch = false } = {}) => {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const replayBatch = includeLastToolBatch ? findLastFunctionReplayBatch(messages) : new Set();
  const selected = [];
  let visibleCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    if (isFunctionReplayMessage(message) || isReasoningReplayMessage(message)) {
      if (replayBatch.has(getMessageIdentity(message, index))) {
        selected.push(message);
      }
      continue;
    }
    if (message.hideFromBot) continue;
    if (maxMessagesLimit && visibleCount >= maxMessagesLimit) continue;
    selected.push(message);
    visibleCount += 1;
  }

  return selected.reverse();
};

const buildFunctionCallReplayMessage = (message) => {
  const content = message?.content || {};
  const raw = content.raw && typeof content.raw === 'object' ? content.raw : {};
  const rawFunction = raw.function && typeof raw.function === 'object' ? raw.function : {};
  const name = content.toolName || content.name || raw.name || rawFunction.name;
  const callId = content.toolCallId || content.callId || raw.id || raw.tool_call_id || raw.call_id;
  if (!name || !callId) {
    logger.warning('Skipping malformed Ollama function_call replay message', {
      category: 'ollama_background_job',
      metadata: { messageId: getMessageIdentity(message), name: name || null, callId: callId || null },
    });
    return null;
  }
  const rawArguments = Object.prototype.hasOwnProperty.call(content, 'arguments')
    ? content.arguments
    : (Object.prototype.hasOwnProperty.call(rawFunction, 'arguments') ? rawFunction.arguments : raw.arguments);
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: callId,
      type: 'function',
      function: {
        name,
        arguments: parseToolArguments(rawArguments),
      },
    }],
  };
};

const buildFunctionOutputReplayMessage = (message) => {
  const content = message?.content || {};
  const raw = content.raw && typeof content.raw === 'object' ? content.raw : {};
  const callId = content.toolCallId || content.callId || raw.tool_call_id || raw.call_id;
  const name = content.toolName || content.name || raw.name || 'unknown_tool';
  if (!callId) {
    logger.warning('Skipping malformed Ollama function_call_output replay message', {
      category: 'ollama_background_job',
      metadata: { messageId: getMessageIdentity(message), name },
    });
    return null;
  }
  const output = Object.prototype.hasOwnProperty.call(content, 'output')
    ? content.output
    : content.toolOutput;
  return {
    role: 'tool',
    tool_name: name,
    tool_call_id: callId,
    call_id: content.callId || raw.call_id || callId,
    content: serializeToolResult(output),
  };
};

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
    if (!message) {
      continue;
    }

    if (message.contentType === 'function_call') {
      const replayMessage = buildFunctionCallReplayMessage(message);
      if (replayMessage) formatted.push(replayMessage);
      continue;
    }
    if (message.contentType === 'function_call_output') {
      const replayMessage = buildFunctionOutputReplayMessage(message);
      if (replayMessage) formatted.push(replayMessage);
      continue;
    }
    if (message.contentType === 'reasoning' || message.hideFromBot) continue;

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

const messageHasPayload = (message) => {
  if (!message || typeof message !== 'object') return false;
  if (typeof message.content === 'string' && message.content.trim().length > 0) return true;
  if (typeof message.thinking === 'string' && message.thinking.trim().length > 0) return true;
  if (Array.isArray(message.images) && message.images.length > 0) return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (typeof message.tool_name === 'string' && message.tool_name.trim().length > 0) return true;
  return false;
};

const limitMessagesToLastImage = (messages, maxImages = null) => {
  if (!Array.isArray(messages)) return [];
  if (maxImages === 0) {
    return messages
      .map((message) => {
        if (!message || typeof message !== 'object') return message;
        const nextMessage = { ...message };
        delete nextMessage.images;
        return nextMessage;
      })
      .filter(messageHasPayload);
  }
  if (maxImages !== 1) {
    return messages.filter(messageHasPayload).map((message) => ({ ...message }));
  }

  let lastImage = null;
  let lastImageMessageIndex = -1;
  messages.forEach((message, index) => {
    if (message && Array.isArray(message.images) && message.images.length > 0) {
      lastImage = message.images[message.images.length - 1];
      lastImageMessageIndex = index;
    }
  });

  return messages
    .map((message, index) => {
      if (!message || typeof message !== 'object') return message;
      if (!Array.isArray(message.images) || message.images.length === 0) {
        return { ...message };
      }
      if (index === lastImageMessageIndex && lastImage) {
        return {
          ...message,
          images: [lastImage],
        };
      }
      const nextMessage = { ...message };
      delete nextMessage.images;
      return nextMessage;
    })
    .filter(messageHasPayload);
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

const sanitizeChatPayloadForLogging = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  const sanitized = {
    ...payload,
    messages: sanitizeMessagesForLogging(payload.messages),
  };
  if (typeof sanitized.webhook_url === 'string') {
    sanitized.webhook_url = redactWebhookUrl(sanitized.webhook_url);
  }
  return sanitized;
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

const extractGatewayErrorDetail = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim().length > 0) {
    return detail.trim();
  }
  return '';
};

const shouldRetryWithToolRoleFallback = (error, payload) => {
  if (!payload || !Array.isArray(payload.messages)) return false;
  const detail = extractGatewayErrorDetail(error);
  if (detail !== 'Invalid role: tool') return false;
  return payload.messages.some((message) => message?.role === 'tool');
};

const buildGatewayToolResultFallbackMessage = (message) => {
  const toolName = typeof message?.tool_name === 'string' && message.tool_name.trim().length > 0
    ? message.tool_name.trim()
    : 'unknown_tool';
  const toolContent = typeof message?.content === 'string' ? message.content : serializeToolResult(message?.content);
  const content = [
    `Tool result for ${toolName}:`,
    toolContent && toolContent.trim().length > 0 ? toolContent.trim() : '[empty tool result]',
    'Use this tool result to continue the conversation and answer the original request.',
  ].join('\n\n');

  return {
    role: 'user',
    content,
  };
};

const convertMessagesForGatewayToolRoleFallback = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    if (message.role !== 'tool') {
      return cloneMessageForToolLoop(message);
    }
    return buildGatewayToolResultFallbackMessage(message);
  });
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

const extractAssistantMessage = (response) => {
  if (!response || typeof response !== 'object') return null;
  if (response.message && typeof response.message === 'object') {
    return response.message;
  }
  if (Array.isArray(response.choices) && response.choices[0]?.message) {
    return response.choices[0].message;
  }
  return null;
};

const cloneMessageForToolLoop = (message) => {
  if (!message || typeof message !== 'object') return message;
  const copy = { ...message };
  if (Array.isArray(message.images)) copy.images = [...message.images];
  if (Array.isArray(message.tool_calls)) {
    copy.tool_calls = message.tool_calls.map((toolCall) => ({
      ...toolCall,
      function: toolCall?.function && typeof toolCall.function === 'object'
        ? { ...toolCall.function }
        : toolCall?.function,
    }));
  }
  return copy;
};

const normalizeToolDefinitions = (tools) => {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => {
    if (!tool || typeof tool !== 'object') return false;
    if (typeof tool.type !== 'string' || tool.type.trim().length === 0) return false;
    if (!tool.function || typeof tool.function !== 'object') return false;
    return typeof tool.function.name === 'string' && tool.function.name.trim().length > 0;
  });
};

const extractToolDefinitionName = (tool) => {
  if (!tool || typeof tool !== 'object') return '';
  if (tool.function && typeof tool.function.name === 'string') {
    return tool.function.name.trim();
  }
  if (typeof tool.name === 'string') {
    return tool.name.trim();
  }
  return '';
};

const normalizeToolNameList = (names = []) => {
  if (typeof names === 'string') {
    return normalizeToolNameList(names.split(','));
  }
  if (!Array.isArray(names)) return [];

  const cleaned = names
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name) => name.length > 0);
  return Array.from(new Set(cleaned));
};

const getSelectedToolManagerToolNames = (conversation) => normalizeToolNameList(conversation?.metadata?.tools)
  .filter((name) => !OPENAI_BUILT_IN_TOOL_NAMES.has(name));

const mergeToolDefinitions = (...toolLists) => {
  const merged = [];
  const seen = new Set();

  toolLists.forEach((toolList) => {
    normalizeToolDefinitions(toolList).forEach((tool) => {
      const name = extractToolDefinitionName(tool);
      if (!name || seen.has(name)) return;
      seen.add(name);
      merged.push(tool);
    });
  });

  return merged;
};

const buildToolGuidanceEntriesFromDefinitions = (tools = []) => normalizeToolDefinitions(tools)
  .map((tool) => {
    const name = extractToolDefinitionName(tool);
    if (!name) return null;
    return {
      name,
      displayName: name,
      description: typeof tool.function?.description === 'string' ? tool.function.description.trim() : '',
    };
  })
  .filter(Boolean);

const mergeToolGuidanceEntries = (...entryLists) => {
  const merged = [];
  const seen = new Set();

  entryLists.forEach((entries) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      if (!name || seen.has(name)) return;
      seen.add(name);
      merged.push({
        name,
        displayName: typeof entry.displayName === 'string' && entry.displayName.trim().length > 0
          ? entry.displayName.trim()
          : name,
        description: typeof entry.description === 'string' ? entry.description.trim() : '',
      });
    });
  });

  return merged;
};

const appendToolGuidanceToContext = (contextPrompt, toolGuidanceEntries = []) => {
  const entries = mergeToolGuidanceEntries(toolGuidanceEntries);
  if (entries.length === 0) {
    return typeof contextPrompt === 'string' ? contextPrompt : '';
  }

  const list = entries
    .map((entry) => {
      const description = entry.description || 'Available tool.';
      return `- ${entry.displayName}: ${description}`;
    })
    .join('\n');
  const guidance = `Use tools when needed. These are the tools available to you:\n${list}`;
  const base = typeof contextPrompt === 'string' ? contextPrompt.trimEnd() : '';
  return base.length > 0 ? `${base}\n\n${guidance}` : guidance;
};

const resolveToolMetadataByName = async (toolNames = []) => {
  const byName = new Map();
  if (typeof toolManagerService.getTool !== 'function') {
    return byName;
  }

  for (const toolName of toolNames) {
    try {
      const tool = await toolManagerService.getTool(toolName, { includeDisabled: false });
      if (tool && typeof tool.name === 'string') {
        byName.set(tool.name, tool);
      }
    } catch (error) {
      logger.error('Failed to load custom tool metadata for Ollama chat guidance', {
        toolName,
        error,
      });
    }
  }

  return byName;
};

const resolveToolManagerToolsForConversation = async (conversation) => {
  const selectedToolNames = getSelectedToolManagerToolNames(conversation);
  if (selectedToolNames.length === 0) {
    return {
      tools: [],
      toolNames: new Set(),
      toolGuidance: [],
    };
  }

  try {
    const tools = normalizeToolDefinitions(await toolManagerService.getToolDefinitions(selectedToolNames, {
      format: 'chat_completions',
      includeDisabled: false,
      strict: false,
    }));
    const metadataByName = await resolveToolMetadataByName(selectedToolNames);
    const definitionGuidance = buildToolGuidanceEntriesFromDefinitions(tools);
    const toolGuidance = definitionGuidance.map((entry) => {
      const metadata = metadataByName.get(entry.name);
      return {
        ...entry,
        displayName: metadata?.displayName || entry.displayName,
        description: metadata?.description || entry.description,
      };
    });
    return {
      tools,
      toolNames: new Set(tools.map((tool) => extractToolDefinitionName(tool)).filter(Boolean)),
      toolGuidance,
    };
  } catch (error) {
    logger.error('Failed to load custom tool definitions for Ollama chat', {
      toolNames: selectedToolNames,
      error,
    });
    return {
      tools: [],
      toolNames: new Set(),
      toolGuidance: [],
    };
  }
};

const resolveToolUserName = (conversation) => {
  if (Array.isArray(conversation?.members) && conversation.members.length > 0) {
    const member = conversation.members.find((name) => typeof name === 'string' && name.trim().length > 0);
    if (member) return member.trim();
  }
  if (typeof conversation?.user_id === 'string' && conversation.user_id.trim().length > 0) {
    return conversation.user_id.trim();
  }
  return 'chat5';
};

const normalizeToolHandlers = (toolHandlers) => {
  if (!toolHandlers) return {};
  if (toolHandlers instanceof Map) {
    return Object.fromEntries(toolHandlers.entries());
  }
  return typeof toolHandlers === 'object' ? { ...toolHandlers } : {};
};

const parseToolArguments = (value) => {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};

  const trimmed = value.trim();
  if (trimmed.length === 0) return {};

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
};

const stringifyJsonForOllama = (value, fallback = '{}') => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return fallback;
  }
};

const splitTopLevelSegments = (value, delimiter = ',') => {
  if (typeof value !== 'string' || value.length === 0) return [];

  const segments = [];
  let current = '';
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === delimiter && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    segments.push(trailing);
  }

  return segments;
};

const findTopLevelDelimiterIndex = (value, delimiter = ':') => {
  if (typeof value !== 'string' || value.length === 0) return -1;

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char === delimiter && depth === 0) {
      return i;
    }
  }

  return -1;
};

const parseLooseToolArgumentValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';

  const normalized = trimmed.replaceAll(GEMMA4_ESCAPE_TOKEN, '"');
  const jsonCandidate = normalized.startsWith('\'') && normalized.endsWith('\'')
    ? `"${normalized.slice(1, -1).replace(/"/g, '\\"')}"`
    : normalized;

  if (
    (jsonCandidate.startsWith('"') && jsonCandidate.endsWith('"'))
    || (jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}'))
    || (jsonCandidate.startsWith('[') && jsonCandidate.endsWith(']'))
  ) {
    try {
      return JSON.parse(jsonCandidate);
    } catch (error) {
      return jsonCandidate;
    }
  }

  if (/^-?\d+(?:\.\d+)?$/.test(jsonCandidate)) {
    return Number(jsonCandidate);
  }
  if (jsonCandidate === 'true') return true;
  if (jsonCandidate === 'false') return false;
  if (jsonCandidate === 'null') return null;

  return jsonCandidate;
};

const parseGemma4Arguments = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return {};

  const normalized = value.trim().replaceAll(GEMMA4_ESCAPE_TOKEN, '"');
  const jsonParsed = parseToolArguments(`{${normalized}}`);
  if (Object.keys(jsonParsed).length > 0) {
    return jsonParsed;
  }

  const segments = splitTopLevelSegments(normalized, ',');
  const parsed = {};

  segments.forEach((segment) => {
    const delimiterIndex = findTopLevelDelimiterIndex(segment, ':');
    if (delimiterIndex <= 0) return;

    const key = segment.slice(0, delimiterIndex).trim().replace(/^['"]|['"]$/g, '');
    const rawValue = segment.slice(delimiterIndex + 1);
    if (!key) return;
    parsed[key] = parseLooseToolArgumentValue(rawValue);
  });

  return parsed;
};

const parseFunctionStyleArguments = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return {};

  const segments = splitTopLevelSegments(value.trim(), ',');
  const parsed = {};

  segments.forEach((segment) => {
    let delimiterIndex = findTopLevelDelimiterIndex(segment, '=');
    if (delimiterIndex < 0) {
      delimiterIndex = findTopLevelDelimiterIndex(segment, ':');
    }
    if (delimiterIndex <= 0) return;

    const key = segment.slice(0, delimiterIndex).trim().replace(/^['"`]|['"`]$/g, '');
    const rawValue = segment.slice(delimiterIndex + 1);
    if (!key) return;
    parsed[key] = parseLooseToolArgumentValue(rawValue);
  });

  return parsed;
};

const isWordChar = (value) => typeof value === 'string' && /[A-Za-z0-9_]/.test(value);

const extractFunctionStyleToolCalls = (text, allowedToolNames = []) => {
  if (typeof text !== 'string' || text.length === 0 || !Array.isArray(allowedToolNames) || allowedToolNames.length === 0) {
    return [];
  }

  const toolNames = Array.from(new Set(
    allowedToolNames
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
  )).sort((a, b) => b.length - a.length);

  const toolCalls = [];
  const seen = new Set();

  const readCallArguments = (source, openParenIndex) => {
    let depth = 1;
    let quote = null;
    let escaped = false;

    for (let i = openParenIndex + 1; i < source.length; i += 1) {
      const char = source[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (quote) {
        if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === '\'' || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(') {
        depth += 1;
        continue;
      }

      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          return {
            argsString: source.slice(openParenIndex + 1, i),
            endIndex: i,
          };
        }
      }
    }

    return null;
  };

  toolNames.forEach((toolName) => {
    let searchIndex = 0;

    while (searchIndex < text.length) {
      const foundIndex = text.indexOf(toolName, searchIndex);
      if (foundIndex < 0) break;

      const beforeChar = foundIndex > 0 ? text[foundIndex - 1] : '';
      const afterNameIndex = foundIndex + toolName.length;
      if (isWordChar(beforeChar)) {
        searchIndex = afterNameIndex;
        continue;
      }

      let cursor = afterNameIndex;
      while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
      }

      if (text[cursor] !== '(') {
        searchIndex = afterNameIndex;
        continue;
      }

      const afterParenChar = cursor + 1 < text.length ? text[cursor + 1] : '';
      if (isWordChar(afterParenChar) === false && text.slice(foundIndex, cursor).trim().length === 0) {
        searchIndex = afterNameIndex;
        continue;
      }

      const parsedCall = readCallArguments(text, cursor);
      if (!parsedCall) {
        searchIndex = afterNameIndex;
        continue;
      }

      const args = parseFunctionStyleArguments(parsedCall.argsString);
      const signature = `${toolName}:${JSON.stringify(args)}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        toolCalls.push({
          type: 'function',
          function: {
            index: toolCalls.length,
            name: toolName,
            arguments: args,
          },
        });
      }

      searchIndex = parsedCall.endIndex + 1;
    }
  });

  return toolCalls;
};

const normalizeToolCall = (toolCall, index = 0) => {
  if (!toolCall || typeof toolCall !== 'object') return null;

  const fn = toolCall.function && typeof toolCall.function === 'object'
    ? toolCall.function
    : toolCall;
  const toolName = typeof fn?.name === 'string' ? fn.name.trim() : '';
  if (!toolName) return null;

  return {
    ...toolCall,
    type: typeof toolCall.type === 'string' && toolCall.type.trim().length > 0
      ? toolCall.type
      : 'function',
    function: {
      ...(toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : {}),
      index: Number.isInteger(fn?.index) ? fn.index : index,
      name: toolName,
      arguments: parseToolArguments(fn?.arguments),
    },
  };
};

const extractToolCallsFromStructuredCandidate = (candidate) => {
  if (!candidate) return [];

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return [];
    try {
      return extractToolCallsFromStructuredCandidate(JSON.parse(trimmed));
    } catch (error) {
      return [];
    }
  }

  if (Array.isArray(candidate)) {
    return candidate
      .map((toolCall, index) => normalizeToolCall(toolCall, index))
      .filter(Boolean);
  }

  if (typeof candidate !== 'object') {
    return [];
  }

  if (Array.isArray(candidate.tool_calls)) {
    return candidate.tool_calls
      .map((toolCall, index) => normalizeToolCall(toolCall, index))
      .filter(Boolean);
  }

  const single = normalizeToolCall(candidate, 0);
  return single ? [single] : [];
};

const extractToolCallsFromText = (text, options = {}) => {
  if (typeof text !== 'string') {
    return { toolCalls: [], cleanedText: '' };
  }

  let cleanedText = text;
  const toolCalls = [];
  const patterns = [
    /<\|tool_call\>call:(\w+)\{([\s\S]*?)\}(?:<tool_call\|>|<turn\|>)/g,
    /(?:<call>|(?:^|\s)call:)(\w+)\{([\s\S]*?)\}/g,
  ];

  patterns.forEach((pattern) => {
    cleanedText = cleanedText.replace(pattern, (fullMatch, name, argsString) => {
      toolCalls.push({
        type: 'function',
        function: {
          index: toolCalls.length,
          name,
          arguments: parseGemma4Arguments(argsString),
        },
      });
      return '';
    });
  });

  if (toolCalls.length > 0) {
    return {
      toolCalls,
      cleanedText: cleanedText.replace(/\n{3,}/g, '\n\n').trim(),
    };
  }

  const trimmed = text.trim();
  const structuredCandidates = [trimmed];
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    structuredCandidates.push(fencedMatch[1].trim());
  }

  for (const candidate of structuredCandidates) {
    const parsed = extractToolCallsFromStructuredCandidate(candidate);
    if (parsed.length > 0) {
      return {
        toolCalls: parsed,
        cleanedText: '',
      };
    }
  }

  const functionStyleToolCalls = extractFunctionStyleToolCalls(text, options.allowedToolNames);
  if (functionStyleToolCalls.length > 0) {
    return {
      toolCalls: functionStyleToolCalls,
      cleanedText: trimmed,
    };
  }

  return {
    toolCalls: [],
    cleanedText: trimmed,
  };
};

const extractToolCallsFromMessage = (message, allowTextFallback = false, options = {}) => {
  const content = typeof message?.content === 'string' ? message.content : '';
  const thinking = typeof message?.thinking === 'string' ? message.thinking : '';

  const explicitToolCalls = extractToolCallsFromStructuredCandidate(message?.tool_calls);
  if (explicitToolCalls.length > 0) {
    return {
      toolCalls: explicitToolCalls,
      content,
      thinking,
      source: 'tool_calls',
    };
  }

  if (!allowTextFallback) {
    return {
      toolCalls: [],
      content,
      thinking,
      source: null,
    };
  }

  const contentResult = extractToolCallsFromText(content, options);
  const thinkingResult = extractToolCallsFromText(thinking, options);
  const combined = [...contentResult.toolCalls, ...thinkingResult.toolCalls]
    .map((toolCall, index) => normalizeToolCall(toolCall, index))
    .filter(Boolean);

  return {
    toolCalls: combined,
    content: contentResult.cleanedText,
    thinking: thinkingResult.cleanedText,
    source: combined.length > 0
      ? [
          contentResult.toolCalls.length > 0 ? 'content' : null,
          thinkingResult.toolCalls.length > 0 ? 'thinking' : null,
        ].filter(Boolean).join('+')
      : null,
  };
};

const serializeToolResult = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const buildAssistantLoopMessage = (message, options = {}) => {
  const extracted = extractToolCallsFromMessage(
    message,
    options.allowTextToolFallback === true,
    options,
  );
  const assistantMessage = {
    role: 'assistant',
    content: extracted.content,
  };

  if (typeof extracted.thinking === 'string' && extracted.thinking.trim().length > 0) {
    assistantMessage.thinking = extracted.thinking;
  }
  if (Array.isArray(extracted.toolCalls) && extracted.toolCalls.length > 0) {
    assistantMessage.tool_calls = extracted.toolCalls.map((toolCall) => ({
      ...toolCall,
      function: toolCall?.function && typeof toolCall.function === 'object'
        ? { ...toolCall.function }
        : toolCall?.function,
    }));
  }
  return {
    assistantMessage,
    toolCallSource: extracted.source,
  };
};

const ensureToolCallIdentifier = (toolCall, round = 0, index = 0) => {
  if (!toolCall || typeof toolCall !== 'object') return toolCall;
  const copy = cloneMessageForToolLoop(toolCall);
  const existingId = copy.id || copy.tool_call_id || copy.call_id;
  if (!existingId) {
    const fnName = typeof copy?.function?.name === 'string' && copy.function.name.trim().length > 0
      ? copy.function.name.trim().replace(/[^A-Za-z0-9_-]/g, '_')
      : 'tool';
    copy.id = `ollama_call_${round}_${index + 1}_${fnName}`;
  }
  return copy;
};

const createOllamaTextOutput = (text, hideFromBot = false) => ({
  contentType: 'text',
  content: {
    text,
    image: null,
    audio: null,
    tts: null,
    transcript: null,
    revisedPrompt: null,
    imageQuality: null,
    toolOutput: null,
  },
  hideFromBot,
});

const normalizeThinkingText = (thinking) => (
  typeof thinking === 'string' ? thinking.trim() : ''
);

const createOllamaReasoningOutput = (thinking, extras = {}) => {
  const text = normalizeThinkingText(thinking);
  if (!text) return null;

  const summary = [{ type: 'summary_text', text }];
  const raw = {
    type: 'reasoning',
    source: 'ollama_thinking',
    thinking: text,
  };

  if (extras.model) raw.model = extras.model;
  if (extras.createdAt) raw.created_at = extras.createdAt;
  if (Number.isInteger(extras.round)) raw.round = extras.round;
  if (extras.role) raw.role = extras.role;
  if (extras.toolCallSource) raw.tool_call_source = extras.toolCallSource;

  return {
    contentType: 'reasoning',
    content: {
      text,
      image: null,
      audio: null,
      tts: null,
      transcript: null,
      revisedPrompt: null,
      imageQuality: null,
      toolOutput: null,
      outputId: null,
      responseId: null,
      outputIndex: Number.isInteger(extras.outputIndex) ? extras.outputIndex : null,
      toolCallId: null,
      callId: null,
      toolName: null,
      summary,
      encryptedContent: null,
      arguments: null,
      output: null,
      result: null,
      raw,
      status: 'completed',
      error: null,
    },
    hideFromBot: true,
  };
};

const getToolCallIdentifier = (toolCall) => {
  if (!toolCall || typeof toolCall !== 'object') {
    return {
      toolCallId: null,
      callId: null,
    };
  }
  const toolCallId = toolCall.id || toolCall.tool_call_id || null;
  return {
    toolCallId,
    callId: toolCall.call_id || toolCallId || null,
  };
};

const createOllamaFunctionCallOutput = (toolCall) => {
  const normalized = normalizeToolCall(toolCall, 0);
  if (!normalized) return null;

  const { toolCallId, callId } = getToolCallIdentifier(normalized);
  const fn = normalized.function || {};
  const raw = {
    ...normalized,
    type: 'function_call',
    call_id: callId,
    name: fn.name || null,
    arguments: stringifyJsonForOllama(fn.arguments, '{}'),
    status: 'completed',
  };

  return {
    contentType: 'function_call',
    content: {
      text: null,
      image: null,
      audio: null,
      tts: null,
      transcript: null,
      revisedPrompt: null,
      imageQuality: null,
      toolOutput: null,
      toolCallId,
      callId,
      toolName: fn.name || null,
      arguments: stringifyJsonForOllama(fn.arguments, '{}'),
      output: null,
      result: null,
      raw,
      status: 'completed',
      error: null,
    },
    hideFromBot: true,
  };
};

const createOllamaFunctionCallResultOutput = (toolStep) => {
  if (!toolStep || typeof toolStep !== 'object') return null;

  const output = Object.prototype.hasOwnProperty.call(toolStep, 'content') ? toolStep.content : '';
  const toolCallId = toolStep.tool_call_id || toolStep.toolCallId || null;
  const callId = toolStep.call_id || toolStep.callId || toolCallId || null;
  const raw = {
    type: 'function_call_output',
    call_id: callId,
    tool_call_id: toolCallId,
    name: toolStep.name || null,
    output,
    status: toolStep.error ? 'failed' : 'completed',
  };
  if (toolStep.error) {
    raw.error = toolStep.error;
  }
  if (toolStep.execution) {
    raw.result = toolStep.execution;
  }

  return {
    contentType: 'function_call_output',
    content: {
      text: null,
      image: null,
      audio: null,
      tts: null,
      transcript: null,
      revisedPrompt: null,
      imageQuality: null,
      toolOutput: serializeToolResult(output),
      toolCallId,
      callId,
      toolName: toolStep.name || null,
      arguments: null,
      output,
      result: toolStep.execution || null,
      raw,
      status: toolStep.error ? 'failed' : 'completed',
      error: toolStep.error || null,
    },
    hideFromBot: true,
  };
};

const flattenAssistantContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => flattenAssistantContent(item))
      .filter((item) => item && item.length > 0)
      .join('\n\n')
      .trim();
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text.trim();
    }
    if (typeof content.content === 'string') {
      return content.content.trim();
    }
  }
  return '';
};

const convertResponseBody = async (response, options = {}) => {
  const outputs = [];
  const toolSteps = Array.isArray(response?.tool_steps) ? response.tool_steps : [];
  const includedThinking = new Set();
  const includedToolCalls = new Set();

  const addThinkingOutput = (thinking, extras = {}) => {
    const text = normalizeThinkingText(thinking);
    if (!text || includedThinking.has(text)) return;
    const output = createOllamaReasoningOutput(text, extras);
    if (!output) return;
    includedThinking.add(text);
    outputs.push(output);
  };

  const addToolCallOutput = (toolCall, fallbackIndex = 0) => {
    const normalized = ensureToolCallIdentifier(toolCall, 1, fallbackIndex);
    const output = createOllamaFunctionCallOutput(normalized);
    if (!output) return;
    const key = output.content.toolCallId
      || output.content.callId
      || `${output.content.toolName}:${output.content.arguments}`;
    if (includedToolCalls.has(key)) return;
    includedToolCalls.add(key);
    outputs.push(output);
  };

  for (let index = 0; index < toolSteps.length; index++) {
    const step = toolSteps[index];
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'assistant') {
      addThinkingOutput(step.thinking, {
        round: step.round,
        outputIndex: index,
        toolCallSource: step.tool_call_source,
      });
      if (Array.isArray(step.tool_calls)) {
        step.tool_calls.forEach((toolCall, toolIndex) => addToolCallOutput(toolCall, toolIndex));
      }
      continue;
    }
    if (step.type === 'tool') {
      const output = createOllamaFunctionCallResultOutput(step);
      if (output) outputs.push(output);
    }
  }

  const rawAssistantMessage = extractAssistantMessage(response);
  const { assistantMessage } = buildAssistantLoopMessage(rawAssistantMessage || {}, {
    allowTextToolFallback: options.allowTextToolFallback === true,
    allowedToolNames: Array.isArray(options.allowedToolNames) ? options.allowedToolNames : [],
  });
  addThinkingOutput(assistantMessage?.thinking, {
    model: response?.model,
    createdAt: response?.created_at,
    role: assistantMessage?.role,
  });
  const assistantToolCalls = Array.isArray(assistantMessage?.tool_calls)
    ? assistantMessage.tool_calls
    : [];
  assistantToolCalls.forEach((toolCall, toolIndex) => addToolCallOutput(toolCall, toolIndex));
  const assistantText = flattenAssistantContent(assistantMessage?.content);
  if (assistantText && assistantToolCalls.length === 0) {
    outputs.push(createOllamaTextOutput(assistantText, false));
  }

  return outputs;
};

const buildChatPayloadOptions = (conversation) => {
  const options = {};
  const metadata = conversation?.metadata || {};
  if (typeof metadata.temperature === 'number') {
    options.temperature = metadata.temperature;
  }
  if (typeof metadata.max_tokens === 'number') {
    options.max_tokens = metadata.max_tokens;
  }
  return options;
};

const ensureModelAvailable = async (targetModel) => {
  if (isModelAvailable(targetModel)) {
    return;
  }

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
};

const postChatPayload = async (payload, functionName) => {
  const requestUrl = `${hostBaseUrl}${CHAT_ENDPOINT}`;
  const logPayload = sanitizeChatPayloadForLogging(payload);

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
      functionName,
    });
    return normalizedResponse;
  } catch (error) {
    if (shouldRetryWithToolRoleFallback(error, payload)) {
      const fallbackPayload = {
        ...payload,
        messages: convertMessagesForGatewayToolRoleFallback(payload.messages),
      };
      const fallbackLogPayload = sanitizeChatPayloadForLogging(fallbackPayload);

      try {
        const fallbackResponse = await httpClient.post(CHAT_ENDPOINT, fallbackPayload, {
          headers: { 'Content-Type': 'application/json' },
        });
        const normalizedFallbackResponse = normalizeChatResponse(fallbackResponse.data);
        normalizedFallbackResponse.gateway_tool_role_fallback = true;
        await recordApiDebugLog({
          requestUrl,
          requestHeaders: null,
          requestBody: fallbackLogPayload,
          responseHeaders: headersToObject(fallbackResponse.headers),
          responseBody: fallbackResponse.data,
          functionName: `${functionName}.toolRoleFallback`,
        });
        return normalizedFallbackResponse;
      } catch (fallbackError) {
        await recordApiDebugLog({
          requestUrl,
          requestHeaders: null,
          requestBody: fallbackLogPayload,
          responseHeaders: headersToObject(fallbackError.response?.headers),
          responseBody: fallbackError.response?.data || fallbackError.message || fallbackError,
          functionName: `${functionName}.toolRoleFallback`,
        });
      }
    }

    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: logPayload,
      responseHeaders: headersToObject(error.response?.headers),
      responseBody: error.response?.data || error.message || error,
      functionName,
    });
    logger.error('Failed to complete AI gateway chat request', {
      error: error?.message || error,
      model: payload?.model,
      functionName,
    });
    throw error;
  }
};

const normalizeChatJobRecord = (data, { expectedJobId = null } = {}) => {
  if (!data || typeof data !== 'object') {
    throw new Error('AI gateway returned an invalid Ollama job response');
  }
  const jobId = normalizeModelIdentifier(data.job_id);
  if (!isValidChatJobId(jobId)) {
    throw new Error('AI gateway returned an invalid Ollama job ID');
  }
  if (expectedJobId && jobId !== expectedJobId) {
    throw new Error('AI gateway returned a mismatched Ollama job ID');
  }
  const status = normalizeModelIdentifier(data.status).toLowerCase();
  if (!CHAT_JOB_STATUSES.has(status)) {
    throw new Error(`AI gateway returned an invalid Ollama job status: ${status || 'missing'}`);
  }

  const expectedStatusUrl = `${CHAT_JOBS_ENDPOINT}/${jobId}`;
  if (data.status_url && data.status_url !== expectedStatusUrl) {
    void logger.warning('Ignoring unexpected Ollama job status URL from AI gateway', {
      category: 'ollama_background_job',
      metadata: {
        jobId,
        receivedStatusUrl: String(data.status_url).slice(0, 300),
        expectedStatusUrl,
      },
    });
  }

  return {
    ...data,
    job_id: jobId,
    status,
    status_url: expectedStatusUrl,
  };
};

const sendChatJobPayload = async (payload, functionName) => {
  const requestUrl = `${hostBaseUrl}${CHAT_JOBS_ENDPOINT}`;
  const logPayload = sanitizeChatPayloadForLogging(payload);

  try {
    const response = await httpClient.post(CHAT_JOBS_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: JOB_REQUEST_TIMEOUT_MS,
    });
    const job = normalizeChatJobRecord(response.data);
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: logPayload,
      responseHeaders: headersToObject(response.headers),
      responseBody: response.data,
      functionName,
    });
    return job;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: logPayload,
      responseHeaders: headersToObject(error.response?.headers),
      responseBody: error.response?.data || error.message || error,
      functionName,
    });
    throw error;
  }
};

const postChatJobPayload = async (payload, functionName) => {
  try {
    return await sendChatJobPayload(payload, functionName);
  } catch (error) {
    if (shouldRetryWithToolRoleFallback(error, payload)) {
      const fallbackPayload = {
        ...payload,
        messages: convertMessagesForGatewayToolRoleFallback(payload.messages),
      };
      void logger.warning('Retrying rejected Ollama job submission with tool-result compatibility messages', {
        category: 'ollama_background_job',
        metadata: { model: payload.model },
      });
      const fallbackJob = await sendChatJobPayload(fallbackPayload, `${functionName}.toolRoleFallback`);
      fallbackJob.gateway_tool_role_fallback = true;
      return fallbackJob;
    }

    logger.error('Failed to submit Ollama background chat job', {
      category: 'ollama_background_job',
      metadata: {
        model: payload?.model || null,
        statusCode: error?.response?.status || null,
        error: error?.message || String(error),
      },
    });
    throw error;
  }
};

const submitChatJob = async (conversation, messages, model, options = {}) => {
  if (!model || typeof model.api_model !== 'string' || model.api_model.length === 0) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  const targetModel = normalizeModelIdentifier(model.api_model);
  if (!targetModel) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  await ensureModelAvailable(targetModel);

  const supportsImages = model.allow_images === true
    || (Array.isArray(model.in_modalities) && model.in_modalities.includes('image'))
    || isGemma4Model(targetModel);
  const toolManagerConfig = await resolveToolManagerToolsForConversation(conversation);
  const tools = toolManagerConfig.tools;
  const contextPrompt = appendToolGuidanceToContext(
    resolveContextPrompt(conversation),
    toolManagerConfig.toolGuidance,
  );
  const maxMessagesLimit = resolveMaxMessagesLimit(conversation);
  const messagesFromConfiguredStart = sliceMessagesFromConfiguredStart(messages, conversation);
  const selectedMessages = selectMessagesForOllama(messagesFromConfiguredStart, maxMessagesLimit, {
    includeLastToolBatch: options.includeLastToolBatch === true,
  });
  const rawMessageArray = buildChatCompletionMessages(
    contextPrompt,
    selectedMessages,
    supportsImages,
  );
  const messageArray = isGemma4Model(targetModel)
    ? limitMessagesToLastImage(rawMessageArray, 1)
    : rawMessageArray.filter(messageHasPayload);

  if (messageArray.length === 0) {
    throw new Error('No messages available to send to the AI gateway');
  }

  const webhookUrl = buildWebhookUrl();
  const payload = {
    model: targetModel,
    messages: messageArray,
    stream: false,
    webhook_url: webhookUrl,
    ...buildChatPayloadOptions(conversation),
  };
  if (tools.length > 0) {
    payload.tools = tools;
  }

  const job = await postChatJobPayload(payload, 'submitChatJob');
  void logger.notice('Ollama background chat job accepted', {
    category: 'ollama_background_job',
    metadata: {
      jobId: job.job_id,
      status: job.status,
      model: targetModel,
      conversationId: conversation?._id?.toString?.() || conversation?.id?.toString?.() || null,
      webhookUrl: redactWebhookUrl(webhookUrl),
      includesTools: tools.length > 0,
      includeLastToolBatch: options.includeLastToolBatch === true,
    },
  });
  return job;
};

const retrieveChatJob = async (jobId) => {
  if (!isValidChatJobId(jobId)) {
    throw new Error('A valid Ollama job ID is required');
  }

  const endpoint = `${CHAT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}`;
  const requestUrl = `${hostBaseUrl}${endpoint}`;
  try {
    const response = await httpClient.get(endpoint, { timeout: JOB_STATUS_TIMEOUT_MS });
    const job = normalizeChatJobRecord(response.data, { expectedJobId: jobId });
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders: headersToObject(response.headers),
      responseBody: response.data,
      functionName: 'retrieveChatJob',
    });
    return job;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders: headersToObject(error.response?.headers),
      responseBody: error.response?.data || error.message || error,
      functionName: 'retrieveChatJob',
    });
    logger.error('Failed to retrieve Ollama background chat job', {
      category: 'ollama_background_job',
      metadata: {
        jobId,
        statusCode: error?.response?.status || null,
        error: error?.message || String(error),
      },
    });
    return null;
  }
};

const chat = async (conversation, messages, model) => {
  if (!model || typeof model.api_model !== 'string' || model.api_model.length === 0) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  const targetModel = normalizeModelIdentifier(model.api_model);
  if (!targetModel) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  if (getSelectedToolManagerToolNames(conversation).length > 0) {
    return chatWithThinkingAndTools(conversation, messages, model);
  }

  await ensureModelAvailable(targetModel);

  const supportsImages = model.allow_images === true
    || (Array.isArray(model.in_modalities) && model.in_modalities.includes('image'));
  const contextPrompt = resolveContextPrompt(conversation);
  const messagesFromConfiguredStart = sliceMessagesFromConfiguredStart(messages, conversation);
  const visibleMessages = messagesFromConfiguredStart.filter((message) => message && !message.hideFromBot);
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
  Object.assign(payload, buildChatPayloadOptions(conversation));

  return postChatPayload(payload, 'chat');
};

const chatWithThinkingAndTools = async (conversation, messages, model, options = {}) => {
  if (!model || typeof model.api_model !== 'string' || model.api_model.length === 0) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  const targetModel = normalizeModelIdentifier(model.api_model);
  if (!targetModel) {
    throw new Error('Model information is required for Ollama chat requests');
  }

  await ensureModelAvailable(targetModel);

  const supportsImages = model.allow_images === true
    || (Array.isArray(model.in_modalities) && model.in_modalities.includes('image'))
    || isGemma4Model(targetModel);
  const toolManagerConfig = options.useToolManager === false
    ? { tools: [], toolNames: new Set(), toolGuidance: [] }
    : await resolveToolManagerToolsForConversation(conversation);
  const tools = mergeToolDefinitions(options.tools, toolManagerConfig.tools);
  const toolGuidance = mergeToolGuidanceEntries(
    buildToolGuidanceEntriesFromDefinitions(options.tools),
    toolManagerConfig.toolGuidance,
  );
  const contextPrompt = appendToolGuidanceToContext(resolveContextPrompt(conversation), toolGuidance);
  const messagesFromConfiguredStart = sliceMessagesFromConfiguredStart(messages, conversation);
  const visibleMessages = messagesFromConfiguredStart.filter((message) => message && !message.hideFromBot);
  const maxMessagesLimit = resolveMaxMessagesLimit(conversation);
  const limitedMessages = maxMessagesLimit
    ? visibleMessages.slice(-maxMessagesLimit)
    : visibleMessages;
  const rawMessages = buildChatCompletionMessages(
    contextPrompt,
    limitedMessages,
    supportsImages,
  );
  const maxImages = Number.isInteger(options.maxImages) && options.maxImages >= 0
    ? options.maxImages
    : (isGemma4Model(targetModel) ? 1 : null);
  const messageArray = Number.isInteger(maxImages)
    ? limitMessagesToLastImage(rawMessages, maxImages)
    : rawMessages.filter(messageHasPayload).map(cloneMessageForToolLoop);

  if (messageArray.length === 0) {
    throw new Error('No messages available to send to the AI gateway');
  }

  const toolManagerToolNames = toolManagerConfig.toolNames;
  const toolHandlers = normalizeToolHandlers(options.toolHandlers);
  const allowedToolNames = tools
    .map((tool) => tool?.function?.name)
    .filter((name) => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim());
  const maxToolRounds = Number.isInteger(options.maxToolRounds) && options.maxToolRounds > 0
    ? options.maxToolRounds
    : DEFAULT_MAX_TOOL_ROUNDS;
  const includeThinkingInHistory = typeof options.includeThinkingInHistory === 'boolean'
    ? options.includeThinkingInHistory
    : !isGemma4Model(targetModel);
  const basePayload = {
    model: targetModel,
    messages: [],
    stream: false,
    ...buildChatPayloadOptions(conversation),
  };

  if (Object.prototype.hasOwnProperty.call(options, 'think')) {
    basePayload.think = options.think;
  }
  if (tools.length > 0) {
    basePayload.tools = tools;
  }

  let workingMessages = messageArray.map(cloneMessageForToolLoop);
  const toolSteps = [];
  let round = 0;

  while (true) {
    round += 1;

    const response = await postChatPayload({
      ...basePayload,
      messages: workingMessages.map(cloneMessageForToolLoop),
    }, round === 1 ? 'chatWithThinkingAndTools' : `chatWithThinkingAndTools.round${round}`);
    const responseMessage = extractAssistantMessage(response);
    if (!responseMessage) {
      return {
        ...response,
        message_history: [...workingMessages].filter(messageHasPayload),
        tool_steps: toolSteps,
        rounds: round,
      };
    }
    const { assistantMessage, toolCallSource } = buildAssistantLoopMessage(responseMessage, {
      allowTextToolFallback: tools.length > 0,
      allowedToolNames,
    });
    const toolCalls = Array.isArray(assistantMessage.tool_calls)
      ? assistantMessage.tool_calls.map((toolCall, index) => ensureToolCallIdentifier(toolCall, round, index))
      : [];
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }

    toolSteps.push({
      round,
      type: 'assistant',
      content: assistantMessage.content || '',
      thinking: assistantMessage.thinking || '',
      tool_calls: toolCalls,
      tool_call_source: toolCallSource,
    });

    if (toolCalls.length === 0 || tools.length === 0) {
      return {
        ...response,
        message_history: [...workingMessages, assistantMessage].filter(messageHasPayload),
        tool_steps: toolSteps,
        rounds: round,
      };
    }

    if (round >= maxToolRounds) {
      throw new Error(`Ollama tool loop exceeded maxToolRounds (${maxToolRounds}) for model "${targetModel}".`);
    }

    const assistantHistoryMessage = cloneMessageForToolLoop(assistantMessage);
    if (!includeThinkingInHistory) {
      delete assistantHistoryMessage.thinking;
    }
    workingMessages = [...workingMessages, assistantHistoryMessage].filter(messageHasPayload);

    for (const toolCall of toolCalls) {
      const toolName = typeof toolCall?.function?.name === 'string'
        ? toolCall.function.name.trim()
        : '';
      const args = parseToolArguments(toolCall?.function?.arguments);
      const handler = toolHandlers[toolName];
      let result;
      let toolError = null;
      let execution = null;

      if (typeof handler === 'function') {
        try {
          result = await handler(args, {
            conversation,
            messages: workingMessages.map(cloneMessageForToolLoop),
            model,
            round,
            toolCall,
          });
        } catch (error) {
          toolError = error?.message || String(error);
          logger.error('Failed to execute local tool handler for Ollama chat', {
            error: toolError,
            toolName,
            model: targetModel,
          });
          result = `Tool execution error for "${toolName}": ${toolError}`;
        }
      } else if (toolManagerToolNames.has(toolName)) {
        try {
          const userName = resolveToolUserName(conversation);
          execution = await toolManagerService.executeToolCall(toolCall, {
            conversation,
            messages: workingMessages.map(cloneMessageForToolLoop),
            model,
            round,
            userName,
            userId: userName,
            openaiUser: userName,
            createdBy: 'Ollama',
          });
          result = execution.result;
        } catch (error) {
          toolError = error?.message || String(error);
          logger.error('Failed to execute tool manager tool for Ollama chat', {
            error: toolError,
            toolName,
            model: targetModel,
          });
          result = {
            ok: false,
            tool: toolName || null,
            toolCallId: toolCall?.id || null,
            callId: toolCall?.call_id || toolCall?.id || null,
            error: toolError,
          };
        }
      } else {
        toolError = `No local tool handler is registered for "${toolName || 'unknown'}".`;
        result = toolError;
      }

      const serializedResult = serializeToolResult(result);
      const toolCallId = toolCall?.id || toolCall?.tool_call_id || null;
      const callId = toolCall?.call_id || toolCallId || null;
      const toolMessage = {
        role: 'tool',
        tool_name: toolName || 'unknown',
        content: serializedResult,
      };
      if (toolCallId) {
        toolMessage.tool_call_id = toolCallId;
      }
      if (callId) {
        toolMessage.call_id = callId;
      }

      workingMessages.push(toolMessage);
      toolSteps.push({
        round,
        type: 'tool',
        name: toolMessage.tool_name,
        tool_call_id: toolCallId,
        call_id: callId,
        arguments: args,
        content: serializedResult,
        error: toolError,
        execution,
      });
    }
  }
};

const chatGemma4 = async (conversation, messages, model, options = {}) => {
  const normalizedOptions = options && typeof options === 'object'
    ? { ...options }
    : {};
  normalizedOptions.maxImages = 1;
  return chatWithThinkingAndTools(conversation, messages, model, normalizedOptions);
};

const getCachedModels = () => [...cachedModels];
const getCachedDefaultModel = () => cachedDefaultModel;

module.exports = {
  loadModelList,
  getCachedModels,
  getCachedDefaultModel,
  isModelAvailable,
  isValidChatJobId,
  buildWebhookUrl,
  verifyWebhookToken,
  submitChatJob,
  retrieveChatJob,
  chat,
  chatWithThinkingAndTools,
  chatGemma4,
  convertResponseBody,
};
