const logger = require('../utils/logger');
const Qwen3QloraGatewayService = require('../services/qwen3QloraGatewayService');
const TrainingDataService = require('../services/trainingDataService');
const {
  buildGenerationPayload,
  buildTrainingPayload,
  normalizeCompareTargets,
} = require('../utils/qwenAdapterPayload');

const qwen3QloraGateway = new Qwen3QloraGatewayService();
const trainingDataService = new TrainingDataService();
const LOG_CATEGORY = 'qwen3_qlora_admin';
const TOOL_NAME = 'Qwen3 QLoRA';
const ADMIN_BASE = '/admin/qwen3-qlora';
const MAX_COMPARE_TARGETS = readPositiveInteger(process.env.QWEN3_QLORA_MAX_COMPARE_TARGETS, 4);
const MAX_UPLOAD_MB = readPositiveInteger(process.env.QWEN3_QLORA_CSV_UPLOAD_MAX_MB, 200);
const DEFAULT_TRAINING_PARAMS = Object.freeze({
  num_train_epochs: 1,
  learning_rate: 0.0002,
  per_device_train_batch_size: 1,
  gradient_accumulation_steps: 16,
  max_seq_length: 512,
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

function log(level, message, req, metadata = {}) {
  logger[level](message, {
    category: LOG_CATEGORY,
    metadata: requestMetadata(req, metadata),
  });
}

function sendControllerError(res, error, fallback) {
  const status = error?.statusCode || error?.response?.status || 502;
  const detail = sanitizeErrorDetail(error?.response?.data || null);
  const message = error?.statusCode
    ? error.message
    : qwen3QloraGateway.gatewayErrorMessage(error, fallback);
  return res.status(status).json({ error: message, detail });
}

function sendUnexpectedError(req, res, action, error) {
  log('error', `Unhandled ${TOOL_NAME} admin route error`, req, {
    action,
    message: error?.message || String(error),
    stack: error?.stack || null,
  });

  if (res.headersSent) {
    return;
  }

  if (action === 'render') {
    return res.status(500).render('error_page', {
      error: `Unable to load the ${TOOL_NAME} admin tool. Check ${LOG_CATEGORY} logs for details.`,
    }, (renderError, html) => {
      if (renderError) {
        log('error', `Failed to render ${TOOL_NAME} fallback error page`, req, {
          action,
          message: renderError?.message || String(renderError),
        });
        return res.type('text/plain').send(`Unable to load the ${TOOL_NAME} admin tool.`);
      }
      return res.send(html);
    });
  }

  return res.status(500).json({
    error: `Unexpected ${TOOL_NAME} admin error. Check ${LOG_CATEGORY} logs for details.`,
  });
}

function routeGuard(action, handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      sendUnexpectedError(req, res, action, error);
    });
  };
}

function csvFilename(groupId) {
  const safeName = String(groupId || 'training-group')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'training-group';
  return `${safeName}.csv`;
}

exports.render = routeGuard('render', async (req, res) => {
  log('notice', `Rendering ${TOOL_NAME} admin page`, req, {
    gatewayBaseUrl: qwen3QloraGateway.gatewayBaseUrl,
  });

  const trainingGroups = await trainingDataService.listGroupsWithStats({ includeInactive: false });
  return res.render('admin_qwen3_lora', {
    pageTitle: `${TOOL_NAME} - Admin`,
    apiBase: qwen3QloraGateway.gatewayBaseUrl,
    servicePrefix: Qwen3QloraGatewayService.SERVICE_PREFIX,
    defaultTrainingParams: DEFAULT_TRAINING_PARAMS,
    maxCompareTargets: MAX_COMPARE_TARGETS,
    maxUploadMb: MAX_UPLOAD_MB,
    trainingGroups,
    toolName: TOOL_NAME,
    toolDescription: 'Train 4-bit QLoRA adapters for Qwen3 32B and compare their generations.',
    adminBase: ADMIN_BASE,
    trainingGroupBase: `${ADMIN_BASE}/training-groups`,
    trainingGroupManagePath: '/admin/qwen3-lora/training-groups',
    documentationPath: '/admin/ai-gateway/documentation/qwen3-qlora-gateway-usage.md',
    supportsContainerActions: false,
    supportsThinking: true,
    supportsGpuReservation: true,
    reservationContainerId: Qwen3QloraGatewayService.RESERVATION_SERVICE_ID,
    runtimeNotice: 'The Gateway starts this heavy service on demand and stops it after GPU work.',
    modelActionLabel: 'Download / verify model',
    modelActionHelp: 'An empty cache takes at least about 58 minutes at the enforced download rate.',
  }, (error, html) => {
    if (error) {
      return sendUnexpectedError(req, res, 'render', error);
    }
    return res.send(html);
  });
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
    log('notice', `${TOOL_NAME} training group dataset upload requested`, req, {
      groupId: dataset.group.groupId,
      rowCount: dataset.rows.length,
      skippedCount: dataset.skipped.length,
      name: requestedName,
    });
    const result = await qwen3QloraGateway.uploadDataset({
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
    log('warning', `${TOOL_NAME} training group dataset upload failed`, req, {
      groupId: req.params.groupId,
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to upload training group dataset.');
  }
});

exports.state = routeGuard('state', async (req, res) => {
  log('debug', `Fetching ${TOOL_NAME} admin state`, req, {
    gatewayBaseUrl: qwen3QloraGateway.gatewayBaseUrl,
  });

  try {
    const state = await qwen3QloraGateway.getDashboardState();
    const errorKeys = Object.keys(state.errors || {});
    if (errorKeys.length) {
      log('warning', `${TOOL_NAME} admin state returned endpoint errors`, req, {
        failedEndpoints: errorKeys,
        errors: state.errors,
      });
    }
    return res.json(state);
  } catch (error) {
    log('error', `Failed to build ${TOOL_NAME} admin state`, req, {
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    return sendControllerError(res, error, `Unable to fetch ${TOOL_NAME} state.`);
  }
});

exports.getReservation = routeGuard('getReservation', async (req, res) => {
  try {
    const reservation = await qwen3QloraGateway.getGpuReservation();
    return res.set('Cache-Control', 'no-store').json({ reservation });
  } catch (error) {
    log('warning', `${TOOL_NAME} GPU reservation fetch failed`, req, {
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to fetch the GPU reservation.');
  }
});

exports.reserveGpu = routeGuard('reserveGpu', async (req, res) => {
  const rawIdleTimeoutSec = req.body?.idle_timeout_sec;
  const idleTimeoutSec = rawIdleTimeoutSec === undefined || rawIdleTimeoutSec === null || rawIdleTimeoutSec === ''
    ? 900
    : Number(rawIdleTimeoutSec);
  if (!Number.isFinite(idleTimeoutSec) || idleTimeoutSec < 60 || idleTimeoutSec > 12 * 60 * 60) {
    return res.status(400).json({ error: 'Idle timeout must be between 60 and 43,200 seconds.' });
  }

  try {
    log('notice', `${TOOL_NAME} GPU reservation requested`, req, { idleTimeoutSec });
    const reservation = await qwen3QloraGateway.reserveGpu({ idleTimeoutSec });
    log('notice', `${TOOL_NAME} GPU reservation created`, req, {
      service: reservation?.service || null,
      idleTimeoutSec,
    });
    return res.json({ reservation });
  } catch (error) {
    log('warning', `${TOOL_NAME} GPU reservation failed`, req, {
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to reserve the QLoRA GPU service.');
  }
});

exports.releaseReservation = routeGuard('releaseReservation', async (req, res) => {
  try {
    log('notice', `${TOOL_NAME} GPU reservation release requested`, req);
    const reservation = await qwen3QloraGateway.releaseGpuReservation();
    log('notice', `${TOOL_NAME} GPU reservation released`, req, {
      active: reservation?.active === true,
    });
    return res.json({ reservation });
  } catch (error) {
    log('warning', `${TOOL_NAME} GPU reservation release failed`, req, {
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to release the QLoRA GPU reservation.');
  }
});

exports.downloadModel = routeGuard('downloadModel', async (req, res) => {
  try {
    log('notice', `${TOOL_NAME} model cache verification requested`, req);
    const result = await qwen3QloraGateway.downloadModel();
    log('notice', `${TOOL_NAME} model cache verification completed`, req, {
      status: result?.status || result?.download?.status || null,
      sourceId: result?.source_id || result?.model_source_id || null,
    });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} model cache verification failed`, req, {
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to download or verify the quantized base model.');
  }
});

exports.unloadModel = routeGuard('unloadModel', async (req, res) => {
  try {
    log('notice', `${TOOL_NAME} model unload requested`, req);
    const result = await qwen3QloraGateway.unloadModel();
    log('notice', `${TOOL_NAME} model unload completed`, req);
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} model unload failed`, req, {
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to unload the model.');
  }
});

exports.uploadDataset = routeGuard('uploadDataset', async (req, res) => {
  try {
    log('notice', `${TOOL_NAME} dataset upload requested`, req, {
      fileName: req.file?.originalname || null,
      size: req.file?.size || req.file?.buffer?.length || null,
      name: req.body?.name || null,
    });
    const result = await qwen3QloraGateway.uploadDataset({
      file: req.file,
      name: req.body?.name,
    });
    log('notice', `${TOOL_NAME} dataset upload completed`, req, {
      datasetId: result?.dataset_id || null,
      rowCount: result?.row_count || null,
      formatReady: result?.format_ready === true,
    });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} dataset upload failed`, req, {
      fileName: req.file?.originalname || null,
      size: req.file?.size || req.file?.buffer?.length || null,
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to upload dataset.');
  }
});

exports.deleteDataset = routeGuard('deleteDataset', async (req, res) => {
  const datasetId = req.params?.datasetId;
  try {
    log('notice', `${TOOL_NAME} dataset delete requested`, req, { datasetId });
    const result = await qwen3QloraGateway.deleteDataset(datasetId);
    log('notice', `${TOOL_NAME} dataset delete completed`, req, { datasetId });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} dataset delete failed`, req, {
      datasetId,
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to delete dataset.');
  }
});

exports.createTrainingJob = routeGuard('createTrainingJob', async (req, res) => {
  try {
    const payload = buildTrainingPayload(req.body || {});
    log('notice', `${TOOL_NAME} training job requested`, req, {
      datasetId: payload.dataset_id,
      adapterName: payload.adapter_name || null,
      overwriteAdapter: payload.overwrite_adapter === true,
      params: payload.params || {},
    });
    const result = await qwen3QloraGateway.createTrainingJob(payload);
    log('notice', `${TOOL_NAME} training job created`, req, {
      jobId: result?.job_id || null,
      adapterName: result?.adapter_name || payload.adapter_name || null,
      status: result?.status || null,
    });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} training job creation failed`, req, {
      datasetId: req.body?.dataset_id || null,
      adapterName: req.body?.adapter_name || null,
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to start QLoRA training job.');
  }
});

exports.getTrainingJob = routeGuard('getTrainingJob', async (req, res) => {
  const jobId = req.params?.jobId;
  try {
    const result = await qwen3QloraGateway.getTrainingJob(jobId);
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} training job fetch failed`, req, {
      jobId,
      status: error?.response?.status || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, 'Unable to fetch QLoRA training job.');
  }
});

exports.generate = routeGuard('generate', async (req, res) => {
  try {
    const payload = buildGenerationPayload(req.body || {}, { supportsThinking: true });
    log('notice', `${TOOL_NAME} generation requested`, req, {
      adapterName: payload.adapter_name || null,
      promptLength: payload.prompt ? payload.prompt.length : null,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : null,
      maxNewTokens: payload.max_new_tokens || null,
      temperature: payload.temperature ?? null,
      enableThinking: payload.enable_thinking === true,
    });
    const result = await qwen3QloraGateway.generate(payload);
    log('notice', `${TOOL_NAME} generation completed`, req, {
      adapterName: result?.adapter_name || payload.adapter_name || null,
      promptTokens: result?.usage?.prompt_tokens || null,
      completionTokens: result?.usage?.completion_tokens || null,
      totalTokens: result?.usage?.total_tokens || null,
      hasReasoning: Boolean(result?.reasoning_content),
      toolCallCount: Array.isArray(result?.tool_calls) ? result.tool_calls.length : null,
    });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} generation failed`, req, {
      adapterName: req.body?.adapter_name || null,
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, `Unable to run ${TOOL_NAME} generation.`);
  }
});

exports.compare = routeGuard('compare', async (req, res) => {
  try {
    const targets = normalizeCompareTargets(req.body?.targets, MAX_COMPARE_TARGETS);
    const payload = buildGenerationPayload({
      ...req.body,
      adapter_name: undefined,
    }, { supportsThinking: true });
    log('notice', `${TOOL_NAME} comparison requested`, req, {
      targetCount: targets.length,
      targets: targets.map((target) => target.adapter_name || 'base'),
      promptLength: payload.prompt ? payload.prompt.length : null,
      maxNewTokens: payload.max_new_tokens || null,
      temperature: payload.temperature ?? null,
      enableThinking: payload.enable_thinking === true,
    });
    const result = await qwen3QloraGateway.compareGenerations({ targets, payload });
    log('notice', `${TOOL_NAME} comparison completed`, req, {
      targetCount: targets.length,
      successCount: Array.isArray(result?.results)
        ? result.results.filter((entry) => entry.ok).length
        : null,
      failedCount: Array.isArray(result?.results)
        ? result.results.filter((entry) => !entry.ok).length
        : null,
    });
    return res.json(result);
  } catch (error) {
    log('warning', `${TOOL_NAME} comparison failed`, req, {
      status: error?.response?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    return sendControllerError(res, error, `Unable to compare ${TOOL_NAME} generations.`);
  }
});

exports.DEFAULT_TRAINING_PARAMS = DEFAULT_TRAINING_PARAMS;
exports.MAX_COMPARE_TARGETS = MAX_COMPARE_TARGETS;
exports.MAX_UPLOAD_MB = MAX_UPLOAD_MB;
