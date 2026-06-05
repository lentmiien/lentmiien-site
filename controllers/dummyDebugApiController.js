const logger = require('../utils/logger');
const { recordDummyApiRequest } = require('../services/dummyApiLogService');

const CLARIS_SAMPLE_TOKEN = 'c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110';

const CLARIS_SESSION_RESPONSE = {
  response: {
    token: CLARIS_SAMPLE_TOKEN,
  },
  messages: [
    {
      message: 'OK',
      code: '0',
    },
  ],
};

const CLARIS_CREATE_RECORD_RESPONSE = {
  response: {
    recordId: '324',
    modId: '0',
  },
  messages: [
    {
      code: '0',
      message: 'OK',
    },
  ],
};

const CLARIS_UPLOAD_CONTAINER_RESPONSE = {
  response: {},
  messages: [
    {
      code: '0',
      message: 'OK',
    },
  ],
};

async function logDummyRequest(req) {
  try {
    const result = await recordDummyApiRequest(req, {
      settings: req.dummyApiEndpointSettings,
    });
    if (result.logged) {
      logger.debug('Dummy debug API request logged', {
        category: 'dummy_api',
        metadata: {
          method: req.method,
          path: req.originalUrl || req.url || req.path,
        },
      });
    }
  } catch (error) {
    logger.error('Failed to log dummy debug API request', {
      category: 'dummy_api',
      metadata: {
        error: error.message,
        method: req.method,
        path: req.originalUrl || req.url || req.path,
      },
    });
  }
}

exports.ok = async (req, res) => {
  await logDummyRequest(req);

  res.type('text/plain');
  res.send('OK');
};

exports.clarisSession = async (req, res) => {
  await logDummyRequest(req);

  res.set('X-FM-Data-Access-Token', CLARIS_SAMPLE_TOKEN);
  res.json(CLARIS_SESSION_RESPONSE);
};

exports.clarisCreateRecord = async (req, res) => {
  await logDummyRequest(req);

  res.json(CLARIS_CREATE_RECORD_RESPONSE);
};

exports.clarisUploadContainer = async (req, res) => {
  await logDummyRequest(req);

  res.json(CLARIS_UPLOAD_CONTAINER_RESPONSE);
};

exports.CLARIS_SAMPLE_TOKEN = CLARIS_SAMPLE_TOKEN;
exports.CLARIS_SESSION_RESPONSE = CLARIS_SESSION_RESPONSE;
exports.CLARIS_CREATE_RECORD_RESPONSE = CLARIS_CREATE_RECORD_RESPONSE;
exports.CLARIS_UPLOAD_CONTAINER_RESPONSE = CLARIS_UPLOAD_CONTAINER_RESPONSE;
