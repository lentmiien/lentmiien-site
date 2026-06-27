const logger = require('../utils/logger');
const Qwen3LoraGatewayService = require('../services/qwen3LoraGatewayService');
const { buildGatewayErrorMessage } = require('../services/qwen3LoraGatewayService');
const TrainingDataService = require('../services/trainingDataService');

const qwen3LoraGateway = new Qwen3LoraGatewayService();
const trainingDataService = new TrainingDataService();
const MAX_COMPARE_TARGETS = readPositiveInteger(process.env.QWEN3_LORA_MAX_COMPARE_TARGETS, 8);
const MAX_UPLOAD_MB = readPositiveInteger(process.env.QWEN3_LORA_CSV_UPLOAD_MAX_MB, 100);
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

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
  const detail = sanitizeErrorDetail(error?.response?.data || null);
  const message = error?.statusCode ? error.message : buildGatewayErrorMessage(error, fallback);
  return res.status(status).json({
    error: message,
    detail,
  });
}

function sanitizeErrorDetail(detail) {
  if (!detail) {
    return null;
  }
  if (typeof detail === 'string') {
    return detail.slice(0, 1000);
  }
  try {
    return JSON.parse(JSON.stringify(detail));
  } catch {
    return String(detail).slice(0, 1000);
  }
}

function requestMetadata(req, extra = {}) {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    user: req.user?.name || null,
    ip: req.ip || req.connection?.remoteAddress || null,
    ...extra,
  };
}

function redirectTrainingGroups(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return `/admin/qwen3-lora/training-groups${qs ? `?${qs}` : ''}`;
}

function csvFilename(groupId) {
  const safeName = String(groupId || 'training-group')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'training-group';
  return `${safeName}.csv`;
}

function sendUnexpectedError(req, res, action, error) {
  logger.error('Unhandled Qwen3 LoRA admin route error', {
    category: 'qwen3_lora_admin',
    metadata: requestMetadata(req, {
      action,
      message: error?.message || String(error),
      stack: error?.stack || null,
    }),
  });

  if (res.headersSent) {
    return;
  }

  if (action === 'render') {
    return res.status(500).render('error_page', {
      error: 'Unable to load the Qwen3 LoRA admin tool. Check qwen3_lora_admin logs for details.',
    }, (renderError, html) => {
      if (renderError) {
        logger.error('Failed to render Qwen3 LoRA fallback error page', {
          category: 'qwen3_lora_admin',
          metadata: requestMetadata(req, {
            action,
            message: renderError?.message || String(renderError),
            stack: renderError?.stack || null,
          }),
        });
        return res.type('text/plain').send('Unable to load the Qwen3 LoRA admin tool.');
      }
      return res.send(html);
    });
  }

  return res.status(500).json({
    error: 'Unexpected Qwen3 LoRA admin error. Check qwen3_lora_admin logs for details.',
  });
}

function routeGuard(action, handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      sendUnexpectedError(req, res, action, error);
    });
  };
}

async function renderQwen3LoraPage(req, res) {
  logger.notice('Rendering Qwen3 LoRA admin page', {
    category: 'qwen3_lora_admin',
    metadata: requestMetadata(req, {
      gatewayBaseUrl: qwen3LoraGateway.gatewayBaseUrl,
    }),
  });

  const trainingGroups = await trainingDataService.listGroupsWithStats({ includeInactive: false });

  return res.render('admin_qwen3_lora', {
    apiBase: qwen3LoraGateway.gatewayBaseUrl,
    servicePrefix: Qwen3LoraGatewayService.SERVICE_PREFIX,
    defaultTrainingParams: DEFAULT_TRAINING_PARAMS,
    maxCompareTargets: MAX_COMPARE_TARGETS,
    maxUploadMb: MAX_UPLOAD_MB,
    trainingGroups,
  }, (error, html) => {
    if (error) {
      return sendUnexpectedError(req, res, 'render', error);
    }
    return res.send(html);
  });
}

exports.render = routeGuard('render', renderQwen3LoraPage);

exports.trainingGroups = routeGuard('trainingGroups', async (req, res) => {
  const trainingGroups = await trainingDataService.listGroupsWithStats({ includeInactive: true });
  return res.render('admin_qwen3_lora_training_groups', {
    trainingGroups,
    status: {
      success: req.query.success || '',
      error: req.query.error || '',
    },
  }, (error, html) => {
    if (error) {
      return sendUnexpectedError(req, res, 'trainingGroups', error);
    }
    return res.send(html);
  });
});

exports.saveTrainingGroup = routeGuard('saveTrainingGroup', async (req, res) => {
  try {
    if (req.body?.id) {
      await trainingDataService.updateGroup({
        id: req.body.id,
        description: req.body.description,
        isActive: parseBoolean(req.body.is_active, false),
        updatedBy: req.user?.name || '',
      });
      return res.redirect(redirectTrainingGroups({ success: 'Training group updated.' }));
    }

    await trainingDataService.createGroup({
      groupId: req.body?.group_id,
      description: req.body?.description,
      createdBy: req.user?.name || '',
    });
    return res.redirect(redirectTrainingGroups({ success: 'Training group created.' }));
  } catch (error) {
    return res.redirect(redirectTrainingGroups({ error: error?.message || 'Unable to save training group.' }));
  }
});

exports.deleteTrainingGroup = routeGuard('deleteTrainingGroup', async (req, res) => {
  try {
    await trainingDataService.deleteGroup(req.params.id);
    return res.redirect(redirectTrainingGroups({ success: 'Training group deleted.' }));
  } catch (error) {
    return res.redirect(redirectTrainingGroups({ error: error?.message || 'Unable to delete training group.' }));
  }
});

exports.exportTrainingGroupCsv = routeGuard('exportTrainingGroupCsv', async (req, res) => {
  const result = await trainingDataService.buildCsvForGroup(req.params.groupId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(result.group.groupId)}"`);
  res.setHeader('X-Training-Rows', String(result.rows.length));
  res.setHeader('X-Training-Skipped', String(result.skipped.length));
  return res.send(result.csv);
});

exports.uploadTrainingGroupDataset = routeGuard('uploadTrainingGroupDataset', async (req, res) => {
  try {
    const dataset = await trainingDataService.buildDatasetFileForGroup(req.params.groupId);
    if (!dataset.rows.length) {
      return res.status(400).json({ error: 'Training group has no exportable rows.' });
    }
    const requestedName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : dataset.datasetName;
    logger.notice('Qwen3 LoRA training group dataset upload requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        groupId: dataset.group.groupId,
        rowCount: dataset.rows.length,
        skippedCount: dataset.skipped.length,
        name: requestedName,
      }),
    });
    const result = await qwen3LoraGateway.uploadDataset({
      file: dataset.file,
      name: requestedName,
    });
    return res.json({
      ...result,
      training_group_id: dataset.group.groupId,
      exported_rows: dataset.rows.length,
      skipped_entries: dataset.skipped,
    });
  } catch (error) {
    logger.warning('Qwen3 LoRA training group dataset upload failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        groupId: req.params.groupId,
        status: error?.response?.status || error?.statusCode || null,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to upload training group dataset.');
  }
});

exports.state = routeGuard('state', async (req, res) => {
  logger.debug('Fetching Qwen3 LoRA admin state', {
    category: 'qwen3_lora_admin',
    metadata: requestMetadata(req, {
      gatewayBaseUrl: qwen3LoraGateway.gatewayBaseUrl,
    }),
  });

  try {
    const state = await qwen3LoraGateway.getDashboardState();
    const errorKeys = Object.keys(state.errors || {});
    if (errorKeys.length) {
      logger.warning('Qwen3 LoRA admin state returned endpoint errors', {
        category: 'qwen3_lora_admin',
        metadata: requestMetadata(req, {
          failedEndpoints: errorKeys,
          errors: state.errors,
        }),
      });
    } else {
      logger.debug('Qwen3 LoRA admin state returned successfully', {
        category: 'qwen3_lora_admin',
        metadata: requestMetadata(req),
      });
    }
    return res.json(state);
  } catch (error) {
    logger.error('Failed to build Qwen3 LoRA admin state', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        message: error?.message || String(error),
        stack: error?.stack || null,
      }),
    });
    return sendControllerError(res, error, 'Unable to fetch Qwen3 LoRA state.');
  }
});

exports.containerAction = routeGuard('containerAction', async (req, res) => {
  const action = req.params?.action;
  try {
    logger.notice('Qwen3 LoRA container action requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        action,
        wait: parseBoolean(req.body?.wait, true),
      }),
    });
    const result = await qwen3LoraGateway.containerAction(action, {
      wait: parseBoolean(req.body?.wait, true),
    });
    logger.notice('Qwen3 LoRA container action completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, { action, result: sanitizeErrorDetail(result) }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA container action failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        action,
        status: error?.response?.status,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to update Qwen3 LoRA container.');
  }
});

exports.downloadModel = routeGuard('downloadModel', async (req, res) => {
  try {
    logger.notice('Qwen3 LoRA model cache verification requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req),
    });
    const result = await qwen3LoraGateway.downloadModel();
    logger.notice('Qwen3 LoRA model cache verification completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, { status: result?.status || null }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA model cache verification failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        status: error?.response?.status || null,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to download or verify the base model.');
  }
});

exports.unloadModel = routeGuard('unloadModel', async (req, res) => {
  try {
    logger.notice('Qwen3 LoRA model unload requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req),
    });
    const result = await qwen3LoraGateway.unloadModel();
    logger.notice('Qwen3 LoRA model unload completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA model unload failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        status: error?.response?.status || null,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to unload the model.');
  }
});

exports.uploadDataset = routeGuard('uploadDataset', async (req, res) => {
  try {
    logger.notice('Qwen3 LoRA dataset upload requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        fileName: req.file?.originalname || null,
        size: req.file?.size || req.file?.buffer?.length || null,
        name: req.body?.name || null,
      }),
    });
    const result = await qwen3LoraGateway.uploadDataset({
      file: req.file,
      name: req.body?.name,
    });
    logger.notice('Qwen3 LoRA dataset upload completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        datasetId: result?.dataset_id || null,
        rowCount: result?.row_count || null,
        formatReady: result?.format_ready === true,
      }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA dataset upload failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        fileName: req.file?.originalname || null,
        size: req.file?.size || req.file?.buffer?.length || null,
        status: error?.response?.status,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to upload dataset.');
  }
});

exports.deleteDataset = routeGuard('deleteDataset', async (req, res) => {
  const datasetId = req.params?.datasetId;
  try {
    logger.notice('Qwen3 LoRA dataset delete requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, { datasetId }),
    });
    const result = await qwen3LoraGateway.deleteDataset(datasetId);
    logger.notice('Qwen3 LoRA dataset delete completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, { datasetId }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA dataset delete failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        datasetId,
        status: error?.response?.status || null,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to delete dataset.');
  }
});

exports.createTrainingJob = routeGuard('createTrainingJob', async (req, res) => {
  try {
    const payload = buildTrainingPayload(req.body || {});
    logger.notice('Qwen3 LoRA training job requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        datasetId: payload.dataset_id,
        adapterName: payload.adapter_name || null,
        overwriteAdapter: payload.overwrite_adapter === true,
        params: payload.params || {},
      }),
    });
    const result = await qwen3LoraGateway.createTrainingJob(payload);
    logger.notice('Qwen3 LoRA training job created', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        jobId: result?.job_id || null,
        adapterName: result?.adapter_name || payload.adapter_name || null,
        status: result?.status || null,
      }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA training job creation failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        datasetId: req.body?.dataset_id || null,
        adapterName: req.body?.adapter_name || null,
        status: error?.response?.status,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to start training job.');
  }
});

exports.getTrainingJob = routeGuard('getTrainingJob', async (req, res) => {
  const jobId = req.params?.jobId;
  try {
    const result = await qwen3LoraGateway.getTrainingJob(jobId);
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA training job fetch failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        jobId,
        status: error?.response?.status || null,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to fetch training job.');
  }
});

exports.generate = routeGuard('generate', async (req, res) => {
  try {
    const payload = buildGenerationPayload(req.body || {});
    logger.notice('Qwen3 LoRA generation requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        adapterName: payload.adapter_name || null,
        promptLength: payload.prompt ? payload.prompt.length : null,
        messageCount: Array.isArray(payload.messages) ? payload.messages.length : null,
        maxNewTokens: payload.max_new_tokens || null,
        temperature: payload.temperature ?? null,
      }),
    });
    const result = await qwen3LoraGateway.generate(payload);
    logger.notice('Qwen3 LoRA generation completed', {
      category: 'qwen3_lora_admin',
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
    logger.warning('Qwen3 LoRA generation failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        adapterName: req.body?.adapter_name || null,
        status: error?.response?.status,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to run Qwen3 LoRA generation.');
  }
});

exports.compare = routeGuard('compare', async (req, res) => {
  try {
    const targets = normalizeCompareTargets(req.body?.targets);
    const payload = buildGenerationPayload({
      ...req.body,
      adapter_name: undefined,
    });
    logger.notice('Qwen3 LoRA comparison requested', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        targetCount: targets.length,
        targets: targets.map((target) => target.adapter_name || 'base'),
        promptLength: payload.prompt ? payload.prompt.length : null,
        maxNewTokens: payload.max_new_tokens || null,
        temperature: payload.temperature ?? null,
      }),
    });
    const result = await qwen3LoraGateway.compareGenerations({ targets, payload });
    logger.notice('Qwen3 LoRA comparison completed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        targetCount: targets.length,
        successCount: Array.isArray(result?.results) ? result.results.filter((entry) => entry.ok).length : null,
        failedCount: Array.isArray(result?.results) ? result.results.filter((entry) => !entry.ok).length : null,
      }),
    });
    return res.json(result);
  } catch (error) {
    logger.warning('Qwen3 LoRA comparison failed', {
      category: 'qwen3_lora_admin',
      metadata: requestMetadata(req, {
        status: error?.response?.status,
        message: error?.message || String(error),
      }),
    });
    return sendControllerError(res, error, 'Unable to compare Qwen3 LoRA generations.');
  }
});
