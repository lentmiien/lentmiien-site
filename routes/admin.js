const express = require('express');
const multer = require('multer');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/admincontroller');

const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const handleHtmlUpload = (req, res, next) => {
  htmlUpload.single('html_file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file exceeds the 5MB limit.'
        : 'Unable to process the uploaded file.';
      const location = `/admin/html-pages?status=error&message=${encodeURIComponent(message)}`;
      return res.redirect(location);
    }
    return controller.create_html_page_from_file(req, res, next);
  });
};

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
router.get('/api-debug-logs', controller.api_debug_logs);

router.get('/html-pages', controller.html_pages);
router.post('/html-pages/upload-text', controller.create_html_page_from_text);
router.post('/html-pages/upload-file', handleHtmlUpload);
router.post('/html-pages/delete', controller.delete_html_page);

module.exports = router;
