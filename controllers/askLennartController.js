const HumanToolRequestService = require('../services/humanToolRequestService');
const logger = require('../utils/logger');

const service = new HumanToolRequestService();

function parseFeedback(req) {
  const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
  const message = typeof req.query?.message === 'string' ? req.query.message.trim().slice(0, 500) : '';
  if (!['success', 'error'].includes(status) || !message) return null;
  return { status, message };
}

function redirectWithFeedback(res, status, message) {
  return res.redirect(
    `/admin/ask-lennart?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`
  );
}

exports.index = async (req, res) => {
  try {
    const requests = await service.listForAdmin({ user: req.user });
    return res.render('admin_ask_lennart', {
      pageTitle: 'Ask Lennart Requests',
      pendingRequests: requests.pending,
      recentRequests: requests.recent,
      feedback: parseFeedback(req),
      maxResponseChars: HumanToolRequestService.MAX_TEXT_CHARS,
      autoRefreshMs: 30000,
    });
  } catch (error) {
    logger.error('Failed to render human tool request page', {
      category: 'human_tool_request',
      metadata: {
        status: error?.statusCode || 500,
        errorName: error?.name || 'Error',
      },
    });
    return res.status(error?.statusCode || 500).render('error_page', {
      error: error?.statusCode && error.statusCode < 500
        ? error.message
        : 'Unable to load human requests right now.',
    });
  }
};

exports.respond = async (req, res) => {
  try {
    await service.respond(req.params.requestId, req.body?.response, { user: req.user });
    return redirectWithFeedback(res, 'success', 'Response sent back to the waiting chat.');
  } catch (error) {
    logger.warning('Failed to answer human tool request', {
      category: 'human_tool_request',
      metadata: {
        requestId: String(req.params.requestId || '').slice(0, 80),
        status: error?.statusCode || 500,
        errorName: error?.name || 'Error',
      },
    });
    const message = error?.statusCode && error.statusCode < 500
      ? error.message
      : 'Unable to save the response right now.';
    return redirectWithFeedback(res, 'error', message);
  }
};
