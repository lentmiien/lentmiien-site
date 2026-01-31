const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/indexcontroller');

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
router.get('/electricity_usage', controller.electricity_usage);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/mpu6050', controller.mpu6050);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/dht22', controller.dht22);

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

module.exports = router;
