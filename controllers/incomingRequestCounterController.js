const logger = require('../utils/logger');
const { recordAndEvaluateRequest } = require('../services/incomingRequestCounterService');

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

module.exports = {
  check,
};
