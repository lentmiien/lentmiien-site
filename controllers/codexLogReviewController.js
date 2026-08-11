const {
  codexLogReviewWorkflowService,
} = require('../services/codexLogReviewWorkflowService');
const logger = require('../utils/logger');

function redirectWithMessage(res, path, type, message) {
  const params = new URLSearchParams({ [type]: message });
  return res.redirect(`${path}?${params.toString()}`);
}

function renderError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).render('error_page', {
    error: error.message || fallbackMessage,
  });
}

exports.index = async (req, res) => {
  try {
    const state = await codexLogReviewWorkflowService.getDashboard();
    return res.render('codex_log_review/index', {
      pageTitle: 'Production Log Review',
      workflowState: state,
      notice: req.query.notice || '',
      errorMessage: req.query.error || '',
    });
  } catch (error) {
    logger.error('Unable to render the Codex log review dashboard', {
      category: 'codex_log_review',
      metadata: { error: error.message },
    });
    return renderError(res, error, 'Unable to load the production log review workflow.');
  }
};

exports.showRun = async (req, res) => {
  try {
    const [run, nextScheduledAt] = await Promise.all([
      codexLogReviewWorkflowService.getRun(req.params.runId),
      codexLogReviewWorkflowService.getNextScheduledAt(),
    ]);
    return res.render('codex_log_review/detail', {
      pageTitle: `Production Log Review ${String(run.id).slice(0, 8)}`,
      workflowState: {
        run,
        nextScheduledAt,
        config: codexLogReviewWorkflowService.publicConfig(),
      },
      notice: req.query.notice || '',
      errorMessage: req.query.error || '',
    });
  } catch (error) {
    logger.error('Unable to render a Codex log review run', {
      category: 'codex_log_review',
      metadata: { runId: req.params.runId, error: error.message },
    });
    return renderError(res, error, 'Unable to load the production log review run.');
  }
};

exports.startFix = async (req, res) => {
  const path = `/codex-log-review/runs/${encodeURIComponent(req.params.runId)}`;
  try {
    const run = await codexLogReviewWorkflowService.requestFix(
      req.params.runId,
      req.body && req.body.notes,
      req.user
    );
    const message = run.status === 'fix_pending'
      ? 'The fix request was saved and will retry automatically.'
      : 'The fix session was queued in Codex.';
    return redirectWithMessage(res, path, 'notice', message);
  } catch (error) {
    logger.warning('Unable to start the Codex log review fix phase', {
      category: 'codex_log_review',
      metadata: { runId: req.params.runId, error: error.message },
    });
    return redirectWithMessage(res, path, 'error', error.message || 'Unable to start the fix session.');
  }
};

exports.startCommit = async (req, res) => {
  const path = `/codex-log-review/runs/${encodeURIComponent(req.params.runId)}`;
  try {
    const run = await codexLogReviewWorkflowService.requestCommit(req.params.runId, req.user);
    const message = run.status === 'commit_pending'
      ? 'The commit request was saved and will retry automatically.'
      : 'The commit and push follow-up was queued in the fix session.';
    return redirectWithMessage(res, path, 'notice', message);
  } catch (error) {
    logger.warning('Unable to start the Codex log review commit phase', {
      category: 'codex_log_review',
      metadata: { runId: req.params.runId, error: error.message },
    });
    return redirectWithMessage(res, path, 'error', error.message || 'Unable to start commit and push.');
  }
};

exports.retryNow = async (req, res) => {
  const path = `/codex-log-review/runs/${encodeURIComponent(req.params.runId)}`;
  try {
    await codexLogReviewWorkflowService.retryNow(req.params.runId);
    return redirectWithMessage(res, path, 'notice', 'The pending Codex phase was retried.');
  } catch (error) {
    logger.warning('Unable to retry a Codex log review phase', {
      category: 'codex_log_review',
      metadata: { runId: req.params.runId, error: error.message },
    });
    return redirectWithMessage(res, path, 'error', error.message || 'Unable to retry the workflow phase.');
  }
};

module.exports.redirectWithMessage = redirectWithMessage;
