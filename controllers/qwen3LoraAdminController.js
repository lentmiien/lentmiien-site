const logger = require('../utils/logger');
const Qwen3LoraGatewayService = require('../services/qwen3LoraGatewayService');
const { buildGatewayErrorMessage } = require('../services/qwen3LoraGatewayService');

const qwen3LoraGateway = new Qwen3LoraGatewayService();
const MAX_COMPARE_TARGETS = Number(process.env.QWEN3_LORA_MAX_COMPARE_TARGETS || 8);
const DEFAULT_TRAINING_PARAMS = Object.freeze({
  num_train_epochs: 3,
  learning_rate: 0.0002,
  per_device_train_batch_size: 1,
  gradient_accumulation_steps: 8,
  max_seq_length: 2048,
  warmup_ratio: 0.03,
  weight_decay: 0,
  logging_steps: 5,
  save_steps: 0,
  seed: 42,
  lora_r: 16,
  lora_alpha: 32,
  lora_dropout: 0.05,
});

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
          normalizedParams[key] = value;
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

function buildGenerationPayload(body = {}) {
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

function normalizeCompareTargets(rawTargets) {
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
  if (targets.length > MAX_COMPARE_TARGETS) {
    const error = new Error(`Compare up to ${MAX_COMPARE_TARGETS} targets at once.`);
    error.statusCode = 400;
    throw error;
  }

  return targets;
}

function sendControllerError(res, error, fallback) {
  const status = error?.statusCode || error?.response?.status || 502;
  const detail = error?.response?.data || null;
  const message = error?.statusCode ? error.message : buildGatewayErrorMessage(error, fallback);
  return res.status(status).json({
    error: message,
    detail,
  });
}

exports.render = async (req, res) => {
  res.render('admin_qwen3_lora', {
    apiBase: qwen3LoraGateway.gatewayBaseUrl,
    servicePrefix: Qwen3LoraGateway.SERVICE_PREFIX,
    defaultTrainingParams: DEFAULT_TRAINING_PARAMS,
    maxCompareTargets: MAX_COMPARE_TARGETS,
    maxUploadMb: Number(process.env.QWEN3_LORA_CSV_UPLOAD_MAX_MB || 100),
  });
};

exports.state = async (req, res) => {
  try {
    const state = await qwen3LoraGateway.getDashboardState();
    return res.json(state);
  } catch (error) {
    logger.error('Failed to build Qwen3 LoRA admin state', {
      category: 'qwen3_lora_admin',
      metadata: { message: error?.message || error },
    });
    return sendControllerError(res, error, 'Unable to fetch Qwen3 LoRA state.');
  }
};

exports.containerAction = async (req, res) => {
  const action = req.params?.action;
  try {
    const result = await qwen3LoraGateway.containerAction(action, {
      wait: parseBoolean(req.body?.wait, true),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA container action failed', {
      category: 'qwen3_lora_admin',
      metadata: { action, status: error?.response?.status, message: error?.message || error },
    });
    return sendControllerError(res, error, 'Unable to update Qwen3 LoRA container.');
  }
};

exports.downloadModel = async (req, res) => {
  try {
    const result = await qwen3LoraGateway.downloadModel();
    return res.json(result);
  } catch (error) {
    return sendControllerError(res, error, 'Unable to download or verify the base model.');
  }
};

exports.unloadModel = async (req, res) => {
  try {
    const result = await qwen3LoraGateway.unloadModel();
    return res.json(result);
  } catch (error) {
    return sendControllerError(res, error, 'Unable to unload the model.');
  }
};

exports.uploadDataset = async (req, res) => {
  try {
    const result = await qwen3LoraGateway.uploadDataset({
      file: req.file,
      name: req.body?.name,
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA dataset upload failed', {
      category: 'qwen3_lora_admin',
      metadata: {
        fileName: req.file?.originalname || null,
        size: req.file?.size || req.file?.buffer?.length || null,
        status: error?.response?.status,
        message: error?.message || error,
      },
    });
    return sendControllerError(res, error, 'Unable to upload dataset.');
  }
};

exports.deleteDataset = async (req, res) => {
  const datasetId = req.params?.datasetId;
  try {
    const result = await qwen3LoraGateway.deleteDataset(datasetId);
    return res.json(result);
  } catch (error) {
    return sendControllerError(res, error, 'Unable to delete dataset.');
  }
};

exports.createTrainingJob = async (req, res) => {
  try {
    const payload = buildTrainingPayload(req.body || {});
    const result = await qwen3LoraGateway.createTrainingJob(payload);
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA training job creation failed', {
      category: 'qwen3_lora_admin',
      metadata: { status: error?.response?.status, message: error?.message || error },
    });
    return sendControllerError(res, error, 'Unable to start training job.');
  }
};

exports.getTrainingJob = async (req, res) => {
  const jobId = req.params?.jobId;
  try {
    const result = await qwen3LoraGateway.getTrainingJob(jobId);
    return res.json(result);
  } catch (error) {
    return sendControllerError(res, error, 'Unable to fetch training job.');
  }
};

exports.generate = async (req, res) => {
  try {
    const payload = buildGenerationPayload(req.body || {});
    const result = await qwen3LoraGateway.generate(payload);
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA generation failed', {
      category: 'qwen3_lora_admin',
      metadata: { status: error?.response?.status, message: error?.message || error },
    });
    return sendControllerError(res, error, 'Unable to run Qwen3 LoRA generation.');
  }
};

exports.compare = async (req, res) => {
  try {
    const targets = normalizeCompareTargets(req.body?.targets);
    const payload = buildGenerationPayload({
      ...req.body,
      adapter_name: undefined,
    });
    const result = await qwen3LoraGateway.compareGenerations({ targets, payload });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA comparison failed', {
      category: 'qwen3_lora_admin',
      metadata: { status: error?.response?.status, message: error?.message || error },
    });
    return sendControllerError(res, error, 'Unable to compare Qwen3 LoRA generations.');
  }
};
