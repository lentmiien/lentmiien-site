const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/blogcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/:category/list', controller.list);
router.get('/:id/view', controller.view);

module.exports = router;
