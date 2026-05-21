const logger = require('../utils/logger');
const Qwen3LoraGatewayService = require('../services/qwen3LoraGatewayService');
const { buildGatewayErrorMessage } = require('../services/qwen3LoraGatewayService');

const qwen3LoraGateway = new Qwen3LoraGatewayService();
const MAX_NEW_TOKENS = 1024;
const DEFAULT_MAX_NEW_TOKENS = 160;
const activeGenerations = new Map();

function parseOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    const error = new Error(`${fieldName} must be a number.`);
    error.statusCode = 400;
    throw error;
  }
  return num;
}

function parseJsonField(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    const error = new Error(`${fieldName} must be valid JSON.`);
    error.statusCode = 400;
    throw error;
  }
}

function requireRange(value, fieldName, { min = null, max = null } = {}) {
  if (value === undefined) {
    return undefined;
  }
  if ((min !== null && value < min) || (max !== null && value > max)) {
    const error = new Error(`${fieldName} must be between ${min ?? '-infinity'} and ${max ?? 'infinity'}.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function normalizeContainerState(container) {
  if (!container || typeof container !== 'object') {
    return 'unknown';
  }

  const nested = container.container && typeof container.container === 'object' ? container.container : {};
  const candidates = [
    container.state,
    container.status,
    container.container_state,
    nested.state,
    nested.status,
    container.running === true ? 'running' : null,
    container.running === false ? 'stopped' : null,
    nested.running === true ? 'running' : null,
    nested.running === false ? 'stopped' : null,
  ];

  const value = candidates.find((entry) => typeof entry === 'string' && entry.trim());
  return value ? value.trim().toLowerCase() : 'unknown';
}

function isContainerRunning(container) {
  const state = normalizeContainerState(container);
  return ['running', 'healthy', 'started', 'up'].includes(state);
}

function extractAdapters(raw) {
  const adapters = Array.isArray(raw?.adapters) ? raw.adapters : (Array.isArray(raw) ? raw : []);
  return adapters
    .map((adapter) => ({
      adapter_name: adapter?.adapter_name || adapter?.name || adapter?.metadata?.adapter_name || '',
      metadata: adapter?.metadata || {},
    }))
    .filter((adapter) => adapter.adapter_name)
    .sort((a, b) => a.adapter_name.localeCompare(b.adapter_name));
}

function buildAvailability({ container, health, errors = {} }) {
  const state = normalizeContainerState(container);
  if (!container) {
    return {
      enabled: false,
      containerState: state,
      reason: errors.container || 'Unable to read Qwen3 LoRA container state.',
    };
  }

  if (!isContainerRunning(container)) {
    return {
      enabled: false,
      containerState: state,
      reason: `Qwen3 LoRA service is ${state}. Ask an admin to start it.`,
    };
  }

  if (errors.health) {
    return {
      enabled: false,
      containerState: state,
      reason: errors.health,
    };
  }

  if (health && health.ok === false) {
    return {
      enabled: false,
      containerState: state,
      reason: 'Qwen3 LoRA service health check is failing.',
    };
  }

  return {
    enabled: true,
    containerState: state,
    reason: '',
  };
}

async function fetchUserState() {
  const endpoints = {
    container: qwen3LoraGateway.getService('/container'),
    health: qwen3LoraGateway.getService('/health'),
    adapters: qwen3LoraGateway.getService('/adapters'),
  };

  const entries = await Promise.all(Object.entries(endpoints).map(async ([key, promise]) => {
    try {
      return [key, await promise, null];
    } catch (error) {
      return [key, null, buildGatewayErrorMessage(error)];
    }
  }));

  const state = {
    fetchedAt: new Date().toISOString(),
    errors: {},
    maxNewTokens: MAX_NEW_TOKENS,
  };

  entries.forEach(([key, data, error]) => {
    state[key] = data;
    if (error) {
      state.errors[key] = error;
    }
  });

  state.adapters = extractAdapters(state.adapters);
  state.availability = buildAvailability({
    container: state.container,
    health: state.health,
    errors: state.errors,
  });

  return state;
}

function buildGenerationPayload(body = {}) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    const error = new Error('Enter a user prompt before generating.');
    error.statusCode = 400;
    throw error;
  }

  const payload = { prompt };
  const system = typeof body.system === 'string' ? body.system.trim() : '';
  const adapterName = typeof body.adapter_name === 'string' ? body.adapter_name.trim() : '';

  if (system) {
    payload.system = system;
  }
  if (adapterName) {
    payload.adapter_name = adapterName;
  }

  const maxNewTokens = requireRange(
    parseOptionalNumber(body.max_new_tokens, 'Max tokens') ?? DEFAULT_MAX_NEW_TOKENS,
    'Max tokens',
    { min: 1, max: MAX_NEW_TOKENS },
  );
  payload.max_new_tokens = Math.floor(maxNewTokens);

  const temperature = requireRange(
    parseOptionalNumber(body.temperature, 'Temperature') ?? 0,
    'Temperature',
    { min: 0, max: 2 },
  );
  payload.temperature = temperature;

  const topP = requireRange(parseOptionalNumber(body.top_p, 'top_p'), 'top_p', { min: 0, max: 1 });
  if (topP !== undefined) {
    payload.top_p = topP;
  }

  const topK = requireRange(parseOptionalNumber(body.top_k, 'top_k'), 'top_k', { min: 0, max: 1000 });
  if (topK !== undefined) {
    payload.top_k = Math.floor(topK);
  }

  const repetitionPenalty = requireRange(
    parseOptionalNumber(body.repetition_penalty, 'repetition_penalty'),
    'repetition_penalty',
    { min: 0.1, max: 3 },
  );
  if (repetitionPenalty !== undefined) {
    payload.repetition_penalty = repetitionPenalty;
  }

  const tools = parseJsonField(body.tools, 'tools');
  if (tools !== undefined) {
    payload.tools = tools;
  }

  const responseFormat = parseJsonField(body.response_format, 'response_format');
  if (responseFormat !== undefined) {
    payload.response_format = responseFormat;
  }

  return payload;
}

function assertKnownAdapter(adapterName, adapters = []) {
  if (!adapterName) {
    return;
  }

  const knownAdapters = new Set(adapters.map((adapter) => adapter.adapter_name).filter(Boolean));
  if (!knownAdapters.has(adapterName)) {
    const error = new Error('Select an existing LoRA target before generating.');
    error.statusCode = 400;
    throw error;
  }
}

function requestMetadata(req, extra = {}) {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    user: req.user?.name || null,
    ...extra,
  };
}

function generationKey(req) {
  return req.user?._id?.toString?.() || req.user?.name || req.sessionID || 'anonymous';
}

function sendError(res, error, fallback = 'Qwen3 LoRA generation failed.') {
  const status = error?.statusCode || error?.response?.status || 502;
  const message = error?.statusCode ? error.message : buildGatewayErrorMessage(error, fallback);
  return res.status(status).json({ error: message });
}

exports.render = (req, res) => {
  res.render('qwen3_lora', {
    maxNewTokens: MAX_NEW_TOKENS,
    defaultMaxNewTokens: DEFAULT_MAX_NEW_TOKENS,
  });
};

exports.state = async (req, res) => {
  try {
    const state = await fetchUserState();
    if (!state.availability.enabled) {
      logger.notice('Qwen3 LoRA user tool disabled by service state', {
        category: 'qwen3_lora_user',
        metadata: requestMetadata(req, {
          containerState: state.availability.containerState,
          reason: state.availability.reason,
        }),
      });
    }
    return res.json(state);
  } catch (error) {
    logger.warning('Failed to fetch Qwen3 LoRA user state', {
      category: 'qwen3_lora_user',
      metadata: requestMetadata(req, {
        message: error?.message || String(error),
      }),
    });
    return sendError(res, error, 'Unable to fetch Qwen3 LoRA state.');
  }
};

exports.generate = async (req, res) => {
  const key = generationKey(req);
  if (activeGenerations.has(key)) {
    return res.status(409).json({ error: 'Wait for the current Qwen3 LoRA response before sending another prompt.' });
  }

  activeGenerations.set(key, Date.now());
  try {
    const state = await fetchUserState();
    if (!state.availability.enabled) {
      logger.notice('Qwen3 LoRA user generation blocked by service state', {
        category: 'qwen3_lora_user',
        metadata: requestMetadata(req, {
          containerState: state.availability.containerState,
          reason: state.availability.reason,
        }),
      });
      return res.status(503).json({ error: state.availability.reason || 'Qwen3 LoRA service is not available.' });
    }

    const payload = buildGenerationPayload(req.body || {});
    assertKnownAdapter(payload.adapter_name, state.adapters);
    logger.notice('Qwen3 LoRA user generation requested', {
      category: 'qwen3_lora_user',
      metadata: requestMetadata(req, {
        adapterName: payload.adapter_name || null,
        promptLength: payload.prompt.length,
        systemLength: payload.system ? payload.system.length : 0,
        maxNewTokens: payload.max_new_tokens,
        temperature: payload.temperature,
        hasTools: Array.isArray(payload.tools),
        hasResponseFormat: Boolean(payload.response_format),
      }),
    });

    const result = await qwen3LoraGateway.generate(payload, {
      debugLog: false,
    });

    logger.notice('Qwen3 LoRA user generation completed', {
      category: 'qwen3_lora_user',
      metadata: requestMetadata(req, {
        adapterName: result?.adapter_name || payload.adapter_name || null,
        promptTokens: result?.usage?.prompt_tokens || null,
        completionTokens: result?.usage?.completion_tokens || null,
        totalTokens: result?.usage?.total_tokens || null,
        toolCallCount: Array.isArray(result?.tool_calls) ? result.tool_calls.length : null,
      }),
    });

    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA user generation failed', {
      category: 'qwen3_lora_user',
      metadata: requestMetadata(req, {
        status: error?.response?.status || error?.statusCode || null,
        message: error?.message || String(error),
      }),
    });
    return sendError(res, error);
  } finally {
    activeGenerations.delete(key);
  }
};
