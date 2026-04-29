const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const { createApiDebugLogger } = require('./apiDebugLogger');
const ToolManagerService = require('../services/toolManagerService');

const JS_FILE_NAME = 'utils/Ollama_API.js';
const DEFAULT_BASE_URL = 'http://192.168.0.20:8080';
const MODELS_ENDPOINT = '/llm/models';
const CHAT_ENDPOINT = '/llm/chat';
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

const resolveToolManagerToolsForConversation = async (conversation) => {
  const selectedToolNames = getSelectedToolManagerToolNames(conversation);
  if (selectedToolNames.length === 0) {
    return {
      tools: [],
      toolNames: new Set(),
    };
  }

  try {
    const tools = normalizeToolDefinitions(await toolManagerService.getToolDefinitions(selectedToolNames, {
      format: 'chat_completions',
      includeDisabled: false,
      strict: false,
    }));
    return {
      tools,
      toolNames: new Set(tools.map((tool) => extractToolDefinitionName(tool)).filter(Boolean)),
    };
  } catch (error) {
    logger.error('Failed to load custom tool definitions for Ollama chat', {
      toolNames: selectedToolNames,
      error,
    });
    return {
      tools: [],
      toolNames: new Set(),
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
      functionName,
    });
    return normalizedResponse;
  } catch (error) {
    if (shouldRetryWithToolRoleFallback(error, payload)) {
      const fallbackPayload = {
        ...payload,
        messages: convertMessagesForGatewayToolRoleFallback(payload.messages),
      };
      const fallbackLogPayload = {
        ...fallbackPayload,
        messages: sanitizeMessagesForLogging(fallbackPayload.messages),
      };

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
  const contextPrompt = resolveContextPrompt(conversation);
  const visibleMessages = Array.isArray(messages)
    ? messages.filter((message) => message && !message.hideFromBot)
    : [];
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

  const toolManagerConfig = options.useToolManager === false
    ? { tools: [], toolNames: new Set() }
    : await resolveToolManagerToolsForConversation(conversation);
  const tools = mergeToolDefinitions(options.tools, toolManagerConfig.tools);
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
    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

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
      const toolMessage = {
        role: 'tool',
        tool_name: toolName || 'unknown',
        content: serializedResult,
      };
      if (toolCall?.id) {
        toolMessage.tool_call_id = toolCall.id;
      }
      if (toolCall?.call_id) {
        toolMessage.call_id = toolCall.call_id;
      }

      workingMessages.push(toolMessage);
      toolSteps.push({
        round,
        type: 'tool',
        name: toolMessage.tool_name,
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
  chat,
  chatWithThinkingAndTools,
  chatGemma4,
};
