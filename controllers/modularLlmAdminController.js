const logger = require('../utils/logger');
const ModularLlmAdminService = require('../services/modularLlmAdminService');
const ModularLlmGatewayService = require('../services/modularLlmGatewayService');

const ADMIN_BASE = '/admin/ai-gateway/modular-llm';
const DOCUMENTATION_PATH = '/admin/ai-gateway/documentation/modular-llm-gateway-usage.md';
const SERVICE_ID = ModularLlmGatewayService.SERVICE_ID;
const adminService = new ModularLlmAdminService();

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}

function formatDurationMs(value) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'N/A';
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
}

function formatDurationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 'N/A';
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}

function formatJson(value) {
  if (value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `Unable to serialize data: ${error.message}`;
  }
}

function textPreview(value, maxLength = 120) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function displayStatus(value) {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  return normalized
    .replace(/[:_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseFeedback(query = {}) {
  const rawStatus = typeof query.status === 'string' ? query.status : '';
  const message = typeof query.message === 'string' ? query.message.trim().slice(0, 500) : '';
  if (!message || !['success', 'error'].includes(rawStatus)) return null;
  return { status: rawStatus, message };
}

function redirectWithFeedback(res, status, message) {
  return res.redirect(
    `${ADMIN_BASE}?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`,
  );
}

function mapModelProfile(profile) {
  return {
    ...profile,
    id: String(profile._id || ''),
    displayName: profile.displayName || `${profile.stage || 'Stage'} · ${profile.modelId || 'Unknown'}`,
    stageDisplay: displayStatus(profile.stage),
    useCasesText: Array.isArray(profile.useCases) ? profile.useCases.join(', ') : '',
    lastSeenDisplay: formatDateTime(profile.lastSeenAt),
    tokenLimitsDisplay: [
      Number.isFinite(profile.maxInputTokens) ? `${profile.maxInputTokens.toLocaleString()} input` : null,
      Number.isFinite(profile.maxNewTokens) ? `${profile.maxNewTokens.toLocaleString()} new` : null,
    ].filter(Boolean).join(' · ') || 'N/A',
  };
}

function mapLocalRun(run) {
  return {
    ...run,
    id: String(run._id || ''),
    statusDisplay: displayStatus(run.status),
    operationDisplay: displayStatus(run.operation),
    inputPreview: textPreview(run.inputText),
    outputPreview: textPreview(run.output),
    createdAtDisplay: formatDateTime(run.createdAt || run.startedAt),
    durationDisplay: formatDurationMs(run.durationMs),
    detailPath: `${ADMIN_BASE}/runs/${encodeURIComponent(String(run._id || ''))}`,
    gatewayDetailPath: run.gatewayRunId
      ? `${ADMIN_BASE}/gateway-runs/${encodeURIComponent(run.gatewayRunId)}`
      : null,
  };
}

function mapGatewayRun(run) {
  const runId = typeof run?.run_id === 'string' ? run.run_id : '';
  return {
    ...run,
    runId,
    kindDisplay: displayStatus(run?.kind),
    statusDisplay: displayStatus(run?.status),
    createdAtDisplay: formatDateTime(run?.created_at),
    durationDisplay: formatDurationSeconds(run?.total_sec),
    detailPath: runId
      ? `${ADMIN_BASE}/gateway-runs/${encodeURIComponent(runId)}`
      : null,
  };
}

function mapLiveModelStages(models) {
  const stages = models?.bundle?.stages;
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) return [];
  return Object.entries(stages).map(([stage, config]) => ({
    stage,
    stageDisplay: displayStatus(stage),
    modelId: config?.model_id || 'Unknown',
    revision: config?.revision || 'N/A',
    dtype: config?.dtype || 'N/A',
    attention: config?.attention || 'N/A',
    adapterPath: config?.adapter_path || '',
    tokenLimitsDisplay: [
      Number.isFinite(config?.max_input_tokens)
        ? `${config.max_input_tokens.toLocaleString()} input`
        : null,
      Number.isFinite(config?.max_new_tokens)
        ? `${config.max_new_tokens.toLocaleString()} new`
        : null,
    ].filter(Boolean).join(' · ') || 'N/A',
  }));
}

function mapDashboardState(state = {}) {
  const service = state.service || {};
  const health = state.health || {};
  const bundle = state.models?.bundle || {};
  return {
    ...state,
    service,
    health,
    bundle,
    serviceName: service.service || SERVICE_ID,
    serviceStatus: health.status || (health.ok === true ? 'ready' : 'unknown'),
    serviceStatusDisplay: displayStatus(health.status || (health.ok === true ? 'ready' : 'unknown')),
    containerState: health.container_state || service.container_state || 'unknown',
    containerStateDisplay: displayStatus(health.container_state || service.container_state),
    running: service.running === true,
    runtimeMode: service.runtime_mode || bundle.runtime_mode || 'unknown',
    runtimeModeDisplay: displayStatus(service.runtime_mode || bundle.runtime_mode),
    bundleId: bundle.id || service.bundle_id || 'Unknown',
    modelStages: mapLiveModelStages(state.models),
    schemas: Array.isArray(state.schemas?.schemas) ? state.schemas.schemas : [],
    gatewayRuns: (Array.isArray(state.runs) ? state.runs : []).map(mapGatewayRun),
    fetchedAtDisplay: formatDateTime(state.fetchedAt),
  };
}

function mapLocalRunDetail(run) {
  const mapped = mapLocalRun(run);
  const response = run.response || null;
  return {
    ...mapped,
    source: 'local',
    title: `Admin test ${mapped.id}`,
    input: run.inputText || '',
    output: run.output || '',
    errorMessage: run.errorMessage || '',
    errorJson: run.errorDetails ? formatJson(run.errorDetails) : '',
    diagnosticsJson: response?.stages || response?.stage
      ? formatJson(response.stages || response.stage)
      : '',
    rawJson: formatJson(response || run.errorDetails || run),
    startedAtDisplay: formatDateTime(run.startedAt),
    completedAtDisplay: formatDateTime(run.completedAt),
    httpStatusDisplay: run.httpStatus || 'N/A',
    requestedByDisplay: run.requestedBy || 'Unknown',
  };
}

function mapGatewayRunDetail(run, linkedLocalRun = null) {
  const mapped = mapGatewayRun(run);
  const output = run?.output ?? run?.content ?? '';
  const error = run?.error || null;
  return {
    ...mapped,
    source: 'gateway',
    id: mapped.runId,
    title: `Gateway run ${mapped.runId}`,
    operationDisplay: mapped.kindDisplay,
    input: typeof run?.input === 'string' ? run.input : formatJson(run?.input),
    output: typeof output === 'string' ? output : formatJson(output),
    errorMessage: typeof error === 'string' ? error : (error?.message || ''),
    errorJson: error ? formatJson(error) : '',
    diagnosticsJson: run?.stages || run?.stage ? formatJson(run.stages || run.stage) : '',
    rawJson: formatJson(run),
    startedAtDisplay: formatDateTime(run?.created_at),
    completedAtDisplay: formatDateTime(run?.finished_at),
    httpStatusDisplay: 'Gateway artifact',
    requestedByDisplay: 'Gateway',
    gatewayRunId: mapped.runId,
    gatewayDetailPath: mapped.detailPath,
    linkedLocalRun: linkedLocalRun ? mapLocalRun(linkedLocalRun) : null,
  };
}

function wantsJson(req) {
  const accept = typeof req.get === 'function' ? req.get('accept') : req.headers?.accept;
  return String(accept || '').includes('application/json');
}

function gatewayHttpStatus(error, fallback = 502) {
  if (error?.statusCode) return error.statusCode;
  const status = Number(error?.response?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

exports.index = async (req, res) => {
  const [liveResult, profilesResult, runsResult] = await Promise.allSettled([
    adminService.getDashboardState(),
    adminService.listModelProfiles(),
    adminService.listTestRuns(30),
  ]);
  const databaseErrors = [];
  if (profilesResult.status === 'rejected') databaseErrors.push('model catalog');
  if (runsResult.status === 'rejected') databaseErrors.push('test history');

  if (liveResult.status === 'rejected') {
    logger.warning('Failed to build Modular LLM live dashboard state', {
      category: 'modular_llm_admin',
      metadata: { error: liveResult.reason?.message || String(liveResult.reason) },
    });
  }
  if (databaseErrors.length) {
    logger.error('Failed to load Modular LLM admin database state', {
      category: 'modular_llm_admin',
      metadata: {
        sections: databaseErrors,
        errors: [profilesResult, runsResult]
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason?.message || String(result.reason)),
      },
    });
  }

  const liveState = liveResult.status === 'fulfilled'
    ? liveResult.value
    : {
      baseUrl: adminService.gateway.gatewayBaseUrl,
      errors: { dashboard: 'Unable to load live Gateway state.' },
    };
  const live = mapDashboardState(liveState);
  const gatewayErrorKeys = Object.keys(live.errors || {});
  if (gatewayErrorKeys.length) {
    logger.warning('Modular LLM dashboard loaded with Gateway endpoint failures', {
      category: 'modular_llm_admin',
      metadata: { failedEndpoints: gatewayErrorKeys, errors: live.errors },
    });
  }

  return res
    .status(databaseErrors.length ? 500 : 200)
    .set('Cache-Control', 'no-store')
    .render('admin_modular_llm', {
      pageTitle: 'Modular LLM - Admin',
      adminBase: ADMIN_BASE,
      documentationPath: DOCUMENTATION_PATH,
      servicePrefix: ModularLlmGatewayService.SERVICE_PREFIX,
      live,
      profiles: profilesResult.status === 'fulfilled'
        ? profilesResult.value.map(mapModelProfile)
        : [],
      localRuns: runsResult.status === 'fulfilled'
        ? runsResult.value.map(mapLocalRun)
        : [],
      feedback: parseFeedback(req.query),
      databaseError: databaseErrors.length
        ? `Unable to load the ${databaseErrors.join(' and ')} collection${databaseErrors.length > 1 ? 's' : ''}.`
        : null,
      modelProfileCollection: ModularLlmAdminService.MODEL_PROFILE_COLLECTION,
      testRunCollection: ModularLlmAdminService.TEST_RUN_COLLECTION,
      maxTestInputLength: ModularLlmAdminService.MAX_TEST_INPUT_LENGTH,
    });
};

exports.state = async (req, res) => {
  try {
    const state = await adminService.getRuntimeState();
    const hasServiceState = Boolean(state.service || state.health);
    return res
      .status(hasServiceState ? 200 : 502)
      .set('Cache-Control', 'no-store')
      .json({ ok: hasServiceState, ...mapDashboardState(state) });
  } catch (error) {
    return res
      .status(502)
      .set('Cache-Control', 'no-store')
      .json({ ok: false, error: ModularLlmGatewayService.gatewayResponseError(error) });
  }
};

exports.syncModels = async (req, res) => {
  try {
    const result = await adminService.syncModelCatalog({
      updatedBy: req.user?.name || '',
    });
    return redirectWithFeedback(
      res,
      'success',
      `Synced ${result.stageCount} stage model${result.stageCount === 1 ? '' : 's'} from ${result.bundleId}.`,
    );
  } catch (error) {
    logger.warning('Failed to sync the Modular LLM model catalog', {
      category: 'modular_llm_admin',
      metadata: {
        gatewayStatus: error?.response?.status || null,
        error: error?.message || String(error),
      },
    });
    return redirectWithFeedback(
      res,
      'error',
      ModularLlmGatewayService.gatewayResponseError(error, 'Unable to sync the model catalog.'),
    );
  }
};

exports.updateModel = async (req, res) => {
  try {
    await adminService.updateModelProfile(req.params.id, req.body || {}, {
      updatedBy: req.user?.name || '',
    });
    return redirectWithFeedback(res, 'success', 'Saved model profile metadata.');
  } catch (error) {
    const isExpected = error instanceof ModularLlmAdminService.ModularLlmInputError
      || error?.name === 'CastError'
      || error?.name === 'ValidationError';
    if (!isExpected) {
      logger.error('Failed to update a Modular LLM model profile', {
        category: 'modular_llm_admin',
        metadata: {
          profileId: String(req.params.id || '').slice(0, 100),
          error: error?.message || String(error),
        },
      });
    }
    return redirectWithFeedback(
      res,
      'error',
      isExpected ? error.message : 'Unable to save model profile metadata.',
    );
  }
};

exports.createRun = async (req, res) => {
  try {
    const run = await adminService.createPipelineTest(req.body || {}, {
      requestedBy: req.user?.name || '',
    });
    const detailUrl = `${ADMIN_BASE}/runs/${encodeURIComponent(String(run._id))}`;
    if (!wantsJson(req)) return res.redirect(detailUrl);

    const failedStatus = Number(run.httpStatus);
    const responseStatus = run.status === 'succeeded'
      ? 201
      : (Number.isInteger(failedStatus) && failedStatus >= 400 ? failedStatus : 502);
    return res.status(responseStatus).json({
      ok: run.status === 'succeeded',
      run: mapLocalRun(run),
      detailUrl,
      error: run.errorMessage || null,
    });
  } catch (error) {
    const status = gatewayHttpStatus(error, 500);
    const isInputError = error instanceof ModularLlmAdminService.ModularLlmInputError;
    if (!isInputError) {
      logger.error('Unable to create a Modular LLM pipeline test record', {
        category: 'modular_llm_admin',
        metadata: { error: error?.message || String(error) },
      });
    }
    const message = isInputError
      ? error.message
      : 'Unable to start the Modular LLM pipeline test.';
    if (wantsJson(req)) return res.status(isInputError ? 400 : status).json({ ok: false, error: message });
    return redirectWithFeedback(res, 'error', message);
  }
};

exports.showRun = async (req, res) => {
  try {
    const run = await adminService.getTestRun(req.params.id);
    if (!run) {
      return res.status(404).render('admin_modular_llm_run', {
        pageTitle: 'Modular LLM run not found',
        adminBase: ADMIN_BASE,
        documentationPath: DOCUMENTATION_PATH,
        run: null,
        errorMessage: 'The requested local Modular LLM test run was not found.',
      });
    }
    return res
      .set('Cache-Control', 'no-store')
      .render('admin_modular_llm_run', {
        pageTitle: `Modular LLM test ${run._id}`,
        adminBase: ADMIN_BASE,
        documentationPath: DOCUMENTATION_PATH,
        run: mapLocalRunDetail(run),
        errorMessage: null,
      });
  } catch (error) {
    logger.error('Failed to load a local Modular LLM test run', {
      category: 'modular_llm_admin',
      metadata: {
        runId: String(req.params.id || '').slice(0, 100),
        error: error?.message || String(error),
      },
    });
    return res.status(500).render('admin_modular_llm_run', {
      pageTitle: 'Modular LLM run error',
      adminBase: ADMIN_BASE,
      documentationPath: DOCUMENTATION_PATH,
      run: null,
      errorMessage: 'Unable to load the local Modular LLM test run.',
    });
  }
};

exports.showGatewayRun = async (req, res) => {
  let runId;
  try {
    runId = ModularLlmGatewayService.assertGatewayRunId(req.params.runId);
  } catch (error) {
    return res.status(400).render('admin_modular_llm_run', {
      pageTitle: 'Invalid Modular LLM Gateway run',
      adminBase: ADMIN_BASE,
      documentationPath: DOCUMENTATION_PATH,
      run: null,
      errorMessage: error.message,
    });
  }

  const [gatewayResult, localResult] = await Promise.allSettled([
    adminService.getGatewayRun(runId),
    adminService.findTestRunByGatewayRunId(runId),
  ]);
  if (gatewayResult.status === 'rejected') {
    const status = gatewayHttpStatus(gatewayResult.reason);
    logger.warning('Failed to load a Modular LLM Gateway run artifact', {
      category: 'modular_llm_admin',
      metadata: {
        gatewayRunId: runId,
        status,
        error: gatewayResult.reason?.message || String(gatewayResult.reason),
      },
    });
    return res.status(status).render('admin_modular_llm_run', {
      pageTitle: 'Modular LLM Gateway run error',
      adminBase: ADMIN_BASE,
      documentationPath: DOCUMENTATION_PATH,
      run: null,
      errorMessage: ModularLlmGatewayService.gatewayResponseError(
        gatewayResult.reason,
        'Unable to load the Gateway run artifact.',
      ),
    });
  }

  if (localResult.status === 'rejected') {
    logger.error('Failed to correlate a Modular LLM Gateway run with local history', {
      category: 'modular_llm_admin',
      metadata: { gatewayRunId: runId, error: localResult.reason?.message || String(localResult.reason) },
    });
  }

  return res
    .set('Cache-Control', 'no-store')
    .render('admin_modular_llm_run', {
      pageTitle: `Modular LLM Gateway run ${runId}`,
      adminBase: ADMIN_BASE,
      documentationPath: DOCUMENTATION_PATH,
      run: mapGatewayRunDetail(
        gatewayResult.value,
        localResult.status === 'fulfilled' ? localResult.value : null,
      ),
      errorMessage: null,
    });
};

exports._private = {
  displayStatus,
  formatDurationMs,
  mapDashboardState,
  mapGatewayRun,
  mapLocalRun,
  mapLocalRunDetail,
  parseFeedback,
};
