const codexToolService = require('../services/codexToolService');
const codexQueueWorker = require('../services/codexQueueWorker');
const logger = require('../utils/logger');

function stringifyForScript(data) {
  return JSON.stringify(data || {}).replace(/</g, '\\u003c');
}

function wantsJson(req) {
  return String(req.headers.accept || '').includes('application/json') ||
    String(req.get('content-type') || '').includes('application/json') ||
    String(req.originalUrl || '').includes('/api/');
}

function renderPageError(req, res, error, fallbackMessage) {
  const status = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  logger.warning('Codex page request failed', {
    category: 'codex_tool',
    metadata: {
      path: req.originalUrl,
      user: req.user?.name || null,
      status,
      error: message,
    },
  });
  return res.status(status).render('error_page', { error: message });
}

function renderJsonError(req, res, error, fallbackMessage) {
  const status = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  logger.warning('Codex API request failed', {
    category: 'codex_tool',
    metadata: {
      path: req.originalUrl,
      user: req.user?.name || null,
      status,
      error: message,
    },
  });
  return res.status(status).json({ ok: false, error: message });
}

function renderError(req, res, error, fallbackMessage) {
  if (wantsJson(req)) {
    return renderJsonError(req, res, error, fallbackMessage);
  }
  return renderPageError(req, res, error, fallbackMessage);
}

exports.renderHome = async (req, res) => {
  try {
    const state = await codexToolService.getDashboardState();
    return res.render('codex/index', {
      pageTitle: 'Codex Workspace Assistant',
      codexState: state,
      codexStateJson: stringifyForScript(state),
    });
  } catch (error) {
    return renderPageError(req, res, error, 'Unable to load Codex workspace assistant.');
  }
};

exports.renderSession = async (req, res) => {
  try {
    const state = await codexToolService.getSessionDetail(req.params.sessionId);
    return res.render('codex/session', {
      pageTitle: state.session ? state.session.title : 'Codex session',
      codexState: state,
      codexStateJson: stringifyForScript(state),
    });
  } catch (error) {
    return renderPageError(req, res, error, 'Unable to load Codex session.');
  }
};

exports.renderTurn = async (req, res) => {
  try {
    const state = await codexToolService.getTurnDetail(req.params.turnId);
    return res.render('codex/turn', {
      pageTitle: `Codex turn ${state.turn ? state.turn.sequence : ''}`,
      codexState: state,
      codexStateJson: stringifyForScript(state),
    });
  } catch (error) {
    return renderPageError(req, res, error, 'Unable to load Codex turn.');
  }
};

exports.renderWorkspaces = async (req, res) => {
  try {
    const [workspaces, targets] = await Promise.all([
      codexToolService.listWorkspaces({ includeDisabled: true }),
      codexToolService.listTargets(),
    ]);
    const state = {
      workspaces,
      targets,
      config: codexToolService.publicConfig(),
    };
    return res.render('codex/workspaces', {
      pageTitle: 'Codex Workspaces',
      codexState: state,
      codexStateJson: stringifyForScript(state),
    });
  } catch (error) {
    return renderPageError(req, res, error, 'Unable to load Codex workspaces.');
  }
};

exports.createSession = async (req, res) => {
  try {
    const result = await codexToolService.createSession(req.body || {}, req.user);
    return res.status(202).json({ ok: true, ...result });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to create Codex session.');
  }
};

exports.createFollowupTurn = async (req, res) => {
  try {
    const result = await codexToolService.createFollowupTurn(req.params.sessionId, req.body || {}, req.user);
    return res.status(202).json({ ok: true, ...result });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to create Codex follow-up.');
  }
};

exports.listSessions = async (req, res) => {
  try {
    const sessions = await codexToolService.listSessions({
      limit: req.query.limit,
      workspaceId: req.query.workspaceId,
      includeArchived: req.query.includeArchived === '1',
    });
    return res.json({ ok: true, sessions });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to list Codex sessions.');
  }
};

exports.getSession = async (req, res) => {
  try {
    const state = await codexToolService.getSessionDetail(req.params.sessionId);
    return res.json({ ok: true, ...state });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex session.');
  }
};

exports.archiveSession = async (req, res) => {
  try {
    const session = await codexToolService.archiveSession(req.params.sessionId);
    return res.json({ ok: true, session });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to archive Codex session.');
  }
};

exports.getTurn = async (req, res) => {
  try {
    const state = await codexToolService.getTurnDetail(req.params.turnId);
    return res.json({ ok: true, ...state });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex turn.');
  }
};

exports.getTurnEvents = async (req, res) => {
  try {
    const events = await codexToolService.listTurnEvents(req.params.turnId, {
      afterSeq: req.query.afterSeq,
      limit: req.query.limit,
    });
    return res.json({ ok: true, events });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex events.');
  }
};

exports.cancelTurn = async (req, res) => {
  try {
    const turn = await codexToolService.cancelTurn(req.params.turnId);
    return res.json({ ok: true, turn });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to cancel Codex turn.');
  }
};

exports.retryTurn = async (req, res) => {
  try {
    const result = await codexToolService.retryTurn(req.params.turnId, req.user);
    return res.status(202).json({ ok: true, ...result });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to retry Codex turn.');
  }
};

exports.getQueue = async (req, res) => {
  try {
    const state = await codexToolService.getQueueState();
    return res.json({ ok: true, ...state });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex queue.');
  }
};

exports.getStats = async (req, res) => {
  try {
    const pricing = await codexToolService.getTokenPricing();
    const stats = await codexToolService.getDashboardStats({ pricing });
    return res.json({ ok: true, pricing, stats });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex statistics.');
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const pricing = await codexToolService.updateTokenPricing(req.body || {}, req.user);
    const stats = await codexToolService.getDashboardStats({ pricing });
    return res.json({ ok: true, pricing, stats });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to update Codex token prices.');
  }
};

exports.getHealth = async (req, res) => {
  try {
    const health = await codexToolService.getHealth(codexQueueWorker.getStatus());
    return res.json({ ok: true, health });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to load Codex health.');
  }
};

exports.listWorkspaces = async (req, res) => {
  try {
    const workspaces = await codexToolService.listWorkspaces({
      includeDisabled: req.query.includeDisabled === '1' && req.user?.type_user === 'admin',
    });
    return res.json({ ok: true, workspaces });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to list Codex workspaces.');
  }
};

exports.createWorkspace = async (req, res) => {
  try {
    const workspace = await codexToolService.createWorkspace(req.body || {});
    return res.status(201).json({ ok: true, workspace });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to create Codex workspace.');
  }
};

exports.updateWorkspace = async (req, res) => {
  try {
    const workspace = await codexToolService.updateWorkspace(req.params.workspaceId, req.body || {});
    return res.json({ ok: true, workspace });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to update Codex workspace.');
  }
};

exports.deleteWorkspace = async (req, res) => {
  try {
    const result = await codexToolService.deleteWorkspace(req.params.workspaceId);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return renderJsonError(req, res, error, 'Unable to disable Codex workspace.');
  }
};

exports.handleError = renderError;
