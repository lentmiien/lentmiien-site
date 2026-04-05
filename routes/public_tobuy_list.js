const express = require('express');
const router = express.Router();

const controller = require('../controllers/publicTobuyListController');

router.get('/', controller.renderPublicPage);
router.post('/', controller.addPublicTask);

module.exports = router;
