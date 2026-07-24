const logger = require('../utils/logger');
const {
  BACKGROUND_OPTIONS,
  MODERATION_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  SIZE_PRESETS,
} = require('../services/gptImageService');
const {
  DEFAULT_FORM_VALUES,
  DEFAULT_PIXAL3D_PARAMETERS,
  promptTo3dJobService,
  serializeJob,
} = require('../services/promptTo3dJobService');

async function renderIndex(req, res) {
  try {
    const activeJob = await promptTo3dJobService.getActiveJob(req.user);
    return res.render('prompt_to_3d/index', {
      pageTitle: 'Prompt to 3D',
      imageDefaults: DEFAULT_FORM_VALUES,
      pixal3dDefaults: DEFAULT_PIXAL3D_PARAMETERS,
      imageOptions: {
        qualities: QUALITY_OPTIONS,
        backgrounds: BACKGROUND_OPTIONS,
        outputFormats: OUTPUT_FORMAT_OPTIONS,
        moderations: MODERATION_OPTIONS,
        sizes: SIZE_PRESETS,
      },
      pageConfig: {
        createEndpoint: '/prompt-to-3d/jobs',
        currentJob: serializeJob(activeJob),
        pollIntervalMs: 4000,
      },
    });
  } catch (error) {
    logger.error('Unable to render Prompt to 3D', {
      category: 'prompt_to_3d',
      metadata: { user: req.user?.name || null, message: error.message },
    });
    return res.status(500).render('error_page', {
      error: 'Unable to load the Prompt to 3D tool right now.',
    });
  }
}

async function createJob(req, res) {
  try {
    const job = await promptTo3dJobService.createJob({
      raw: req.body || {},
      user: req.user,
    });
    return res.status(202).json({
      ok: true,
      job: serializeJob(job),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = status < 500
      ? error.message
      : 'Unable to queue the Prompt to 3D job right now.';
    logger.warning('Prompt to 3D submission failed', {
      category: 'prompt_to_3d',
      metadata: {
        user: req.user?.name || null,
        status,
        message: error.message,
      },
    });
    return res.status(status).json({
      ok: false,
      error: message,
      job: serializeJob(error.job),
    });
  }
}

async function getJob(req, res) {
  try {
    const job = await promptTo3dJobService.getOwnedJob(req.params.jobId, req.user);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Prompt to 3D job not found.' });
    }
    return res.json({ ok: true, job: serializeJob(job) });
  } catch (error) {
    logger.warning('Unable to read Prompt to 3D job', {
      category: 'prompt_to_3d',
      metadata: {
        jobId: req.params.jobId,
        user: req.user?.name || null,
        message: error.message,
      },
    });
    return res.status(500).json({
      ok: false,
      error: 'Unable to load the Prompt to 3D job right now.',
    });
  }
}

module.exports = {
  createJob,
  getJob,
  renderIndex,
};
