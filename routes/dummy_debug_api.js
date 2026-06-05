const express = require('express');
const multer = require('multer');
const router = express.Router();

const controller = require('../controllers/dummyDebugApiController');
const { getDummyApiEndpointSettings } = require('../services/dummyApiLogService');

const discardFileStorage = {
  _handleFile(_req, file, cb) {
    let size = 0;
    let completed = false;

    const done = (error, info) => {
      if (completed) {
        return;
      }
      completed = true;
      cb(error, info);
    };

    file.stream.on('data', (chunk) => {
      size += chunk.length;
    });
    file.stream.on('error', (error) => done(error));
    file.stream.on('end', () => {
      done(null, { size });
    });
  },

  _removeFile(_req, _file, cb) {
    cb(null);
  },
};

const multipartUpload = multer({
  storage: discardFileStorage,
  limits: {
    files: 50,
    fields: 500,
    parts: 1000,
    fieldSize: 1024 * 1024,
  },
});

function isMultipartFormData(req) {
  const contentType = req.headers?.['content-type'] || '';
  return String(contentType).toLowerCase().includes('multipart/form-data');
}

async function parseMultipartWhenLoggingEnabled(req, res, next) {
  if (!isMultipartFormData(req)) {
    return next();
  }

  try {
    req.dummyApiEndpointSettings = await getDummyApiEndpointSettings();
  } catch (error) {
    req.dummyApiMultipartError = {
      message: 'Unable to load dummy API endpoint settings before multipart parsing.',
      detail: error.message,
    };
    return next();
  }

  if (!req.dummyApiEndpointSettings.enabled) {
    return next();
  }

  return multipartUpload.any()(req, res, (error) => {
    if (error) {
      req.dummyApiMultipartError = {
        name: error.name || null,
        code: error.code || null,
        field: error.field || null,
        message: error.message || String(error),
      };
    }
    return next();
  });
}

router.all(
  '/ok',
  parseMultipartWhenLoggingEnabled,
  express.text({ type: ['text/*', 'application/xml', 'application/*+xml'], limit: '5mb' }),
  controller.ok
);

router.post(
  '/fmi/data/:version/databases/:databaseName/sessions',
  parseMultipartWhenLoggingEnabled,
  controller.clarisSession
);

router.post(
  '/fmi/data/:version/databases/:databaseName/layouts/:layoutName/records',
  parseMultipartWhenLoggingEnabled,
  controller.clarisCreateRecord
);

router.post(
  '/fmi/data/:version/databases/:databaseName/layouts/:layoutName/records/:recordId/containers/:fieldName/:fieldRepetition',
  parseMultipartWhenLoggingEnabled,
  controller.clarisUploadContainer
);

module.exports = router;
