const logger = require('../utils/logger');
const Trellis2Job = require('../models/trellis2_job');
const Pixal3dJob = require('../models/pixal3d_job');
const { buildVisibleTrellis2JobsQuery } = require('../utils/trellis2');
const { buildVisiblePixal3dJobsQuery } = require('../utils/pixal3d');

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MODEL_SOURCES = Object.freeze({
  trellis2: Object.freeze({
    JobModel: Trellis2Job,
    label: 'TRELLIS.2',
    backUrl: '/trellis2',
    downloadBase: '/trellis2/jobs/',
    buildVisibleJobsQuery: buildVisibleTrellis2JobsQuery,
  }),
  pixal3d: Object.freeze({
    JobModel: Pixal3dJob,
    label: 'Pixal3D',
    backUrl: '/pixal3d',
    downloadBase: '/pixal3d/jobs/',
    buildVisibleJobsQuery: buildVisiblePixal3dJobsQuery,
  }),
});

function renderNotFound(res) {
  return res.status(404).render('error_page', {
    error: 'Completed 3D model not found or you do not have access to it.',
  });
}

async function renderPreview(req, res) {
  const source = String(req.params.source || '').toLowerCase();
  const jobId = String(req.params.jobId || '');
  const sourceConfig = MODEL_SOURCES[source];
  if (!sourceConfig || !JOB_ID_PATTERN.test(jobId)) {
    return renderNotFound(res);
  }

  try {
    const job = await sourceConfig.JobModel.findOne({
      $and: [
        { _id: jobId },
        sourceConfig.buildVisibleJobsQuery(req.user),
        { status: 'completed' },
        { 'outputModel.fileName': { $exists: true, $ne: '' } },
      ],
    }).lean().exec();
    if (!job) return renderNotFound(res);

    const encodedJobId = encodeURIComponent(jobId);
    const modelName = job.inputImage?.originalName || `${sourceConfig.label} model`;
    const downloadUrl = `${sourceConfig.downloadBase}${encodedJobId}/download`;
    return res.render('model_previewer', {
      pageTitle: `${modelName} · 3D model preview`,
      bodyClass: 'model-previewer-body',
      contentContainerClass: 'model-previewer-container',
      hideLayoutFooterSpacer: true,
      preview: {
        source,
        sourceLabel: sourceConfig.label,
        backUrl: sourceConfig.backUrl,
        jobId,
        modelName,
        modelUrl: downloadUrl,
        downloadUrl,
      },
    });
  } catch (error) {
    logger.error('Unable to render 3D model preview', {
      category: 'model_previewer',
      metadata: {
        source,
        jobId,
        user: req.user?.name || null,
        message: error.message,
      },
    });
    return res.status(500).render('error_page', {
      error: 'Unable to load the 3D model preview right now.',
    });
  }
}

module.exports = {
  JOB_ID_PATTERN,
  MODEL_SOURCES,
  renderPreview,
};
