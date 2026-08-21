const express = require('express');
const multer = require('multer');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/indexcontroller');

const CSV_DIFF_MAX_INPUT_MB = 5;
const csvDiffUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CSV_DIFF_MAX_INPUT_MB * 1024 * 1024,
    fieldSize: CSV_DIFF_MAX_INPUT_MB * 1024 * 1024,
    files: 2,
    fields: 4,
    parts: 10,
  },
});

function csvDiffUploadMiddleware(req, res, next) {
  csvDiffUpload.fields([
    { name: 'aFile', maxCount: 1 },
    { name: 'bFile', maxCount: 1 },
  ])(req, res, (error) => {
    if (error) {
      req.csvDiffUploadError = ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code)
        ? `Each CSV input must be ${CSV_DIFF_MAX_INPUT_MB} MB or smaller.`
        : error.message || 'Unable to read the uploaded CSV files.';
    }
    next();
  });
}

/* GET home page. */
router.get('/', controller.index);
router.get('/login', controller.login);
router.get('/exchange-rates', controller.exchange_rates);
router.get('/exchange-rates/data', controller.exchange_rates_data);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/download_test', controller.download_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/scroll_test', controller.scroll_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/electricity_usage', (req, res) => {
  res.redirect(301, '/admin/tapo');
});

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/test_editor', controller.test_editor);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/api_test', controller.api_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/img_select', controller.img_select);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/diff', controller.diff);
router.post('/diff', controller.diff);
router.get('/csv-diff', controller.csvDiff);
router.post('/csv-diff', csvDiffUploadMiddleware, controller.csvDiff);

module.exports = router;
