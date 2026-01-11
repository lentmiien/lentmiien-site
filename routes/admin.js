const express = require('express');
const multer = require('multer');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/admincontroller');
const messageInboxController = require('../controllers/messageInboxAdminController');

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

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const handleAsrUpload = (req, res, next) => {
  audioUpload.single('file')(req, res, (err) => {
    if (err) {
      const wantsJson = String(req.headers?.accept || '').includes('application/json');
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Audio file exceeds the 25MB limit.'
        : 'Unable to process the uploaded audio.';
      if (wantsJson) {
        return res.status(400).json({ error: message });
      }
      req.asrError = message;
      res.status(400);
      return controller.asr_test_page(req, res, next);
    }
    return controller.asr_test_transcribe(req, res, next);
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
router.get('/ai-gateway', controller.ai_gateway_dashboard);
router.get('/database_usage', controller.database_usage);
router.get('/database-viewer', controller.database_viewer_page);
router.get('/database-viewer/data', controller.database_viewer_data);
router.post('/database-viewer/delete', controller.database_viewer_delete);
router.get('/api-debug-logs', controller.api_debug_logs);
router.post('/api-debug-logs/prune', controller.prune_api_debug_logs);

router.get('/embedding-test', controller.embedding_test_page);
router.post('/embedding-test', controller.embedding_test_generate);
router.post('/embedding-test/search', controller.embedding_test_search);
router.post('/embedding-test/delete', controller.embedding_test_delete);
router.get('/rag-memory', controller.rag_memory_page);
router.post('/rag-memory', controller.rag_memory_recall);
router.get('/html-pages', controller.html_pages);
router.post('/html-pages/upload-text', controller.create_html_page_from_text);
router.post('/html-pages/upload-file', handleHtmlUpload);
router.post('/html-pages/delete', controller.delete_html_page);
router.post('/html-pages/rating', controller.update_html_page_rating);

router.get('/asr-test', controller.asr_test_page);
router.post('/asr-test', handleAsrUpload);

router.get('/tts-test', controller.tts_test_page);
router.post('/tts-test', controller.tts_test_generate);
router.get('/tts-test/status/:id', controller.tts_test_status);

/* Message inbox */
router.get('/message-inbox', messageInboxController.renderMessageInbox);
router.post('/message-inbox/update', messageInboxController.updateMessage);
router.post('/message-inbox/delete', messageInboxController.deleteMessage);
router.get('/message-inbox/:messageId', messageInboxController.renderSingleMessage);

/* Message filters */
router.get('/message-filters', messageInboxController.renderFilters);
router.post('/message-filters/save', messageInboxController.saveFilter);
router.post('/message-filters/delete', messageInboxController.deleteFilter);
router.post('/message-filters/add-label', messageInboxController.addLabelRule);
router.post('/message-filters/remove-label', messageInboxController.removeLabelRule);

/* Message thread */
router.get('/message-thread/:threadId', messageInboxController.renderThread);

/* Agent5 */
router.get('/agent5', controller.agent5_page);
router.post('/agent5/create', controller.agent5_create_agent);
router.post('/agent5/behavior', controller.agent5_save_behavior);

module.exports = router;
