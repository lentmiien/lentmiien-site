const logger = require('../utils/logger');
const {
  getCurrentDeviceUsageStatus,
  recordAndEvaluateDeviceUsage,
} = require('../services/deviceUsageService');

async function check(req, res) {
  try {
    const result = await recordAndEvaluateDeviceUsage(req, {
      endpointPath: req.baseUrl,
    });

    return res
      .status(result.responseStatusCode)
      .set('Cache-Control', 'no-store')
      .json(result.responsePayload);
  } catch (error) {
    logger.error('Device usage request failed', {
      category: 'device-usage',
      metadata: { error: error.message },
    });

    return res
      .status(500)
      .set('Cache-Control', 'no-store')
      .json({
        version: 1,
        status: 'NG',
        allowed: false,
        action: 'wait',
        reasonCode: 'server_error',
        messages: {
          en: 'Device usage service failed.',
          ja: '端末利用サービスでエラーが発生しました。',
        },
      });
  }
}

async function status(req, res) {
  try {
    const result = await getCurrentDeviceUsageStatus(req.baseUrl, req.query || {});

    return res
      .status(result.responseStatusCode)
      .set('Cache-Control', 'no-store')
      .json(result.responsePayload);
  } catch (error) {
    logger.error('Device usage status failed', {
      category: 'device-usage',
      metadata: { error: error.message },
    });

    return res
      .status(500)
      .set('Cache-Control', 'no-store')
      .json({
        version: 1,
        status: 'NG',
        allowed: false,
        action: 'wait',
        reasonCode: 'server_error',
        messages: {
          en: 'Device usage service failed.',
          ja: '端末利用サービスでエラーが発生しました。',
        },
      });
  }
}

module.exports = {
  check,
  status,
};
