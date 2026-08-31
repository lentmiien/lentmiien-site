const logger = require('../utils/logger');
const {
  MINUTE_LOGGER_RESPONSE_BODY,
  recordMinuteLoggerRequest,
} = require('../services/minuteLoggerService');

function safeErrorCode(error) {
  if (typeof error?.code === 'number' && Number.isFinite(error.code)) return error.code;
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  return /^[A-Z][A-Z0-9_]{0,49}$/.test(code) ? code : null;
}

function safeErrorName(error) {
  const name = typeof error?.name === 'string' ? error.name.trim() : '';
  return /^[A-Z][A-Za-z0-9_.]{0,49}$/.test(name) ? name : 'Error';
}

async function log(req, res) {
  try {
    await recordMinuteLoggerRequest(req, {
      endpointPath: req.baseUrl,
    });
  } catch (error) {
    logger.error('Minute logger request failed to persist', {
      category: 'minute-logger',
      metadata: {
        errorName: safeErrorName(error),
        errorCode: safeErrorCode(error),
        method: req.method,
        route: req.route?.path || '/',
      },
    });

    return res
      .status(503)
      .set('Cache-Control', 'no-store')
      .set('Retry-After', '60')
      .json({ message: 'Service unavailable' });
  }

  return res
    .status(200)
    .set('Cache-Control', 'no-store')
    .json(MINUTE_LOGGER_RESPONSE_BODY);
}

module.exports = {
  log,
};
