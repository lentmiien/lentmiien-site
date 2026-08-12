function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function pickPresentObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value;
    }
  });
  return Object.keys(result).length ? result : undefined;
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
  } catch (error) {
    const err = new Error(`${fieldName} must be valid JSON.`);
    err.statusCode = 400;
    throw err;
  }
}

function buildTrainingPayload(body = {}) {
  const datasetId = typeof body.dataset_id === 'string' ? body.dataset_id.trim() : '';
  if (!datasetId) {
    const error = new Error('Choose a dataset before starting training.');
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    dataset_id: datasetId,
    overwrite_adapter: parseBoolean(body.overwrite_adapter, false),
  };

  const adapterName = typeof body.adapter_name === 'string' ? body.adapter_name.trim() : '';
  if (adapterName) {
    payload.adapter_name = adapterName;
  }

  const columns = pickPresentObject(body.columns);
  if (columns) {
    payload.columns = columns;
  }

  const params = pickPresentObject(body.params);
  if (params) {
    const normalizedParams = {};
    Object.entries(params).forEach(([key, value]) => {
      if (key === 'target_modules') {
        if (Array.isArray(value)) {
          const modules = value.map((entry) => String(entry).trim()).filter(Boolean);
          if (modules.length) normalizedParams[key] = modules;
        } else if (typeof value === 'string' && value.trim()) {
          normalizedParams[key] = value.split(',').map((entry) => entry.trim()).filter(Boolean);
        }
        return;
      }
      const numeric = parseOptionalNumber(value);
      if (numeric !== undefined) {
        normalizedParams[key] = numeric;
      }
    });
    if (Object.keys(normalizedParams).length) {
      payload.params = normalizedParams;
    }
  }

  return payload;
}

function buildGenerationPayload(body = {}, { supportsThinking = false } = {}) {
  const payload = {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const system = typeof body.system === 'string' ? body.system.trim() : '';
  const adapterName = typeof body.adapter_name === 'string' ? body.adapter_name.trim() : '';

  if (prompt) {
    payload.prompt = prompt;
  }
  if (Array.isArray(body.messages) && body.messages.length) {
    payload.messages = body.messages;
  }
  if (!payload.prompt && !payload.messages) {
    const error = new Error('Enter a prompt before generating.');
    error.statusCode = 400;
    throw error;
  }
  if (system) {
    payload.system = system;
  }
  if (adapterName) {
    payload.adapter_name = adapterName;
  } else if (body.adapter_name === null) {
    payload.adapter_name = null;
  }

  [
    'max_new_tokens',
    'temperature',
    'top_p',
    'top_k',
    'repetition_penalty',
  ].forEach((key) => {
    const numeric = parseOptionalNumber(body[key]);
    if (numeric !== undefined) {
      payload[key] = numeric;
    }
  });

  if (body.do_sample !== undefined && body.do_sample !== null && body.do_sample !== '') {
    payload.do_sample = parseBoolean(body.do_sample, false);
  }

  if (supportsThinking && body.enable_thinking !== undefined
    && body.enable_thinking !== null && body.enable_thinking !== '') {
    payload.enable_thinking = parseBoolean(body.enable_thinking, false);
  }

  if (payload.enable_thinking === true && payload.do_sample === false) {
    const error = new Error('Thinking mode requires sampling. Enable sampling or disable thinking.');
    error.statusCode = 400;
    throw error;
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

function normalizeCompareTargets(rawTargets, maxTargets = 8) {
  if (!Array.isArray(rawTargets)) {
    const error = new Error('Select at least one target to compare.');
    error.statusCode = 400;
    throw error;
  }

  const targets = rawTargets
    .map((target) => {
      if (!target || typeof target !== 'object') {
        return null;
      }
      const adapterName = typeof target.adapter_name === 'string' && target.adapter_name.trim()
        ? target.adapter_name.trim()
        : null;
      const label = typeof target.label === 'string' && target.label.trim()
        ? target.label.trim()
        : (adapterName || 'Base model');
      return { adapter_name: adapterName, label };
    })
    .filter(Boolean);

  if (!targets.length) {
    const error = new Error('Select at least one target to compare.');
    error.statusCode = 400;
    throw error;
  }
  if (targets.length > maxTargets) {
    const error = new Error(`Compare up to ${maxTargets} targets at once.`);
    error.statusCode = 400;
    throw error;
  }

  return targets;
}

module.exports = {
  buildGenerationPayload,
  buildTrainingPayload,
  normalizeCompareTargets,
  parseBoolean,
};
