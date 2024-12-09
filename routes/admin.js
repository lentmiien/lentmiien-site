const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/admincontroller');

/* GET home page. */
router.get('/', controller.manage_users);
router.post('/set_type', controller.set_type);
router.post('/reset_password', controller.reset_password);
router.post('/delete_user', controller.delete_user);
router.post('/create_user', controller.create_user);

router.get('/manage_roles', controller.manage_roles);
router.post('/update_role', controller.update_role);

router.get('/app_logs', controller.app_logs);
router.get('/log_file/:file', controller.log_file);
router.get('/delete_log_file/:file', controller.delete_log_file);

router.get('/openai_usage', controller.openai_usage);

module.exports = router;
