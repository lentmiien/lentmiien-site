const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/admincontroller');

/* GET home page. */
router.get('/', controller.manage_users);
router.post('/set_type', controller.set_type);
router.post('/reset_password', controller.reset_password);

module.exports = router;
