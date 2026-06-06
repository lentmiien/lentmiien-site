const logger = require('../utils/logger');
const {
  MINUTE_LOGGER_RESPONSE_BODY,
  recordMinuteLoggerRequest,
} = require('../services/minuteLoggerService');

async function log(req, res) {
  try {
    await recordMinuteLoggerRequest(req, {
      endpointPath: req.baseUrl,
    });
  } catch (error) {
    logger.error('Minute logger request failed to persist', {
      category: 'minute-logger',
      metadata: {
        error: error.message,
        method: req.method,
        path: req.originalUrl || req.url || req.path,
      },
    });
  }

  return res
    .status(200)
    .set('Cache-Control', 'no-store')
    .json(MINUTE_LOGGER_RESPONSE_BODY);
}

module.exports = {
  log,
};
