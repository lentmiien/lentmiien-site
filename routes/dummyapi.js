const express = require('express');
const multer = require('multer');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/dummyapicontroller');
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

const okMultipartUpload = multer({
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

async function parseOkMultipartWhenEnabled(req, res, next) {
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

  return okMultipartUpload.any()(req, res, (error) => {
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
  parseOkMultipartWhenEnabled,
  express.text({ type: ['text/*', 'application/xml', 'application/*+xml'], limit: '5mb' }),
  controller.ok
);
router.get('/identifiers', controller.shipping_identifiers);
router.post('/shipments', controller.shipping_labels);
router.post('/WEBAPI', controller.japanPostLabel);
router.get('/labels/:trackingNumber.pdf', controller.japanPostLabelPdf);

module.exports = router;
