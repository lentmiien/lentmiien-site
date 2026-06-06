const express = require('express');
const controller = require('../controllers/minuteLoggerController');

const router = express.Router();

router.post('/', controller.log);

module.exports = router;
