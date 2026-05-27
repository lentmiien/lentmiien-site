const express = require('express');
const controller = require('../controllers/incomingRequestCounterController');

const router = express.Router();

router.get('/', controller.check);

module.exports = router;
