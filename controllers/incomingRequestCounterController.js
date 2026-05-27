const logger = require('../utils/logger');
const {
  getCurrentRequestCounterStatus,
  recordAndEvaluateRequest,
} = require('../services/incomingRequestCounterService');

async function check(req, res) {
  try {
    const result = await recordAndEvaluateRequest(req, {
      endpointPath: req.baseUrl,
    });

    res
      .status(result.responseStatusCode)
      .set('Cache-Control', 'no-store')
      .type('text/plain')
      .send(result.responseText);
  } catch (error) {
    logger.error('Incoming request counter failed', {
      category: 'incoming-request-counter',
      metadata: { error: error.message },
    });

    res
      .status(500)
      .set('Cache-Control', 'no-store')
      .type('text/plain')
      .send('NG');
  }
}

async function status(req, res) {
  try {
    const result = await getCurrentRequestCounterStatus(req.baseUrl);

    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .json({
        status: result.status,
        countInWindow: result.countInWindow,
        limit: result.limit,
        remaining: result.remaining,
        windowMinutes: result.windowMinutes,
        windowStart: result.windowStart.toISOString(),
        checkedAt: result.checkedAt.toISOString(),
        wouldReturnStatusCode: result.wouldReturnStatusCode,
      });
  } catch (error) {
    logger.error('Incoming request counter status failed', {
      category: 'incoming-request-counter',
      metadata: { error: error.message },
    });

    res
      .status(500)
      .set('Cache-Control', 'no-store')
      .json({ status: 'NG', error: 'Unable to load request counter status.' });
  }
}

module.exports = {
  check,
  status,
};
