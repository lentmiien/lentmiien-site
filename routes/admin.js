const express = require('express');
const multer = require('multer');
const router = express.Router();
const logger = require('../utils/logger');

// Require controller modules.
const controller = require('../controllers/admincontroller');
const learningAdminController = require('../controllers/learningAdminController');
const messageInboxController = require('../controllers/messageInboxAdminController');
const toolManagerController = require('../controllers/toolManagerController');
const audioWorkflowController = require('../controllers/audioWorkflowController');
const qwen3LoraAdminController = require('../controllers/qwen3LoraAdminController');
const tapoController = require('../controllers/tapoController');
const requestCounterAdminController = require('../controllers/requestCounterAdminController');
const lifeLogRouter = require('./lifeLog');

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

const qwen3LoraMaxUploadMb = (() => {
  const parsed = Number.parseInt(process.env.QWEN3_LORA_CSV_UPLOAD_MAX_MB, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
})();

const qwen3LoraUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: qwen3LoraMaxUploadMb * 1024 * 1024,
  },
});

const svgUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024,
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

const handleLearningArtUpload = (req, res, next) => {
  svgUpload.single('svgFile')(req, res, (err) => {
    if (err) {
      req.learningArtUploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'SVG upload exceeds the 1MB limit.'
        : 'Unable to process the uploaded SVG file.';
    }

    return learningAdminController.upload_art_asset(req, res, next);
  });
};

const handleQwen3LoraDatasetUpload = (req, res, next) => {
  qwen3LoraUpload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `CSV upload exceeds the ${qwen3LoraMaxUploadMb}MB limit.`
        : 'Unable to process the uploaded CSV file.';
      logger.warning('Qwen3 LoRA CSV upload rejected before controller', {
        category: 'qwen3_lora_admin',
        metadata: {
          path: req.originalUrl || req.url,
          user: req.user?.name || null,
          code: err.code || null,
          message: err.message || String(err),
        },
      });
      return res.status(400).json({ error: message });
    }
    return qwen3LoraAdminController.uploadDataset(req, res, next);
  });
};

/* GET home page. */
router.get('/', controller.manage_users);
router.post('/openai_usage/refresh', controller.refresh_openai_usage);
router.post('/openai_usage/subscription-plans', controller.save_openai_subscription_plan);
router.post('/model-lists/refresh', controller.refresh_model_lists);
router.post('/set_type', controller.set_type);
router.post('/reset_password', controller.reset_password);
router.post('/delete_user', controller.delete_user);
router.post('/create_user', controller.create_user);

router.get('/manage_roles', controller.manage_roles);
router.post('/update_role', controller.update_role);

router.get('/learning', learningAdminController.dashboard);
router.post('/learning/topics/save', learningAdminController.save_topic);
router.post('/learning/topics/delete', learningAdminController.delete_topic);
router.post('/learning/subtopics/save', learningAdminController.save_subtopic);
router.post('/learning/subtopics/delete', learningAdminController.delete_subtopic);
router.post('/learning/items/save', learningAdminController.save_item);
router.post('/learning/items/delete', learningAdminController.delete_item);
router.post('/learning/templates/save', learningAdminController.save_template_profile);
router.post('/learning/templates/delete', learningAdminController.delete_template_profile);
router.get('/learning/art', learningAdminController.art_library);
router.post('/learning/art/upload', handleLearningArtUpload);
router.get('/learning/users', learningAdminController.users);
router.get('/learning/users/:userId', learningAdminController.user_profile);

router.get('/app_logs', controller.app_logs);
router.get('/log_file/:file', controller.log_file);
router.get('/delete_log_file/:file', controller.delete_log_file);

router.get('/openai_usage', controller.openai_usage);
router.get('/ai-gateway', controller.ai_gateway_dashboard);
router.get('/ai-gateway/containers', controller.ai_gateway_containers);
router.post('/ai-gateway/containers/reset-defaults', controller.ai_gateway_containers_reset_defaults);
router.post('/ai-gateway/containers/:id/:action', controller.ai_gateway_container_action);
router.post('/ai-gateway/auto-stop', controller.ai_gateway_auto_stop_update);
router.post('/ai-gateway/monitor', controller.ai_gateway_monitor_update);
router.get('/performance', controller.performance_dashboard);
router.get('/request-counter', requestCounterAdminController.dashboard);
router.post('/request-counter/settings', requestCounterAdminController.updateSettings);
router.get('/database_usage', controller.database_usage);
router.get('/database-viewer', controller.database_viewer_page);
router.get('/database-viewer/data', controller.database_viewer_data);
router.post('/database-viewer/delete', controller.database_viewer_delete);
router.get('/tapo', tapoController.dashboard);
router.get('/api-debug-logs', controller.api_debug_logs);
router.post('/api-debug-logs/prune', controller.prune_api_debug_logs);
router.get('/tools', toolManagerController.index);
router.post('/tools/save', toolManagerController.save);
router.post('/tools/seed', toolManagerController.seed);
router.post('/tools/test', toolManagerController.test);
router.post('/tools/:id/toggle', toolManagerController.toggle);
router.post('/tools/:id/delete', toolManagerController.delete);

router.get('/audio-workflow', audioWorkflowController.renderAdmin);
router.post('/audio-workflow/jobs/:jobId/quality-rating', audioWorkflowController.rateJobQuality);
router.post('/audio-workflow/triggers/save', audioWorkflowController.saveTrigger);
router.post('/audio-workflow/triggers/:id/toggle', audioWorkflowController.toggleTrigger);
router.post('/audio-workflow/triggers/:id/delete', audioWorkflowController.deleteTrigger);
router.use('/life_log', lifeLogRouter);

router.get('/embedding-test', controller.embedding_test_page);
router.post('/embedding-test', controller.embedding_test_generate);
router.post('/embedding-test/search', controller.embedding_test_search);
router.post('/embedding-test/delete', controller.embedding_test_delete);
router.get('/rag-memory', controller.rag_memory_page);
router.post('/rag-memory', controller.rag_memory_recall);
router.get('/html-pages', controller.html_pages);
router.get('/project-docs', controller.project_docs);
router.post('/html-pages/upload-text', controller.create_html_page_from_text);
router.post('/html-pages/upload-file', handleHtmlUpload);
router.post('/html-pages/delete', controller.delete_html_page);
router.post('/html-pages/rating', controller.update_html_page_rating);

router.get('/asr-test', controller.asr_test_page);
router.post('/asr-test', handleAsrUpload);

router.get('/tts-test', controller.tts_test_page);
router.post('/tts-test', controller.tts_test_generate);
router.get('/tts-test/status/:id', controller.tts_test_status);
router.get('/music-test', controller.music_test_page);
router.post('/music-test', controller.music_test_generate);
router.get('/music-test/status/:id', controller.music_test_status);
router.get('/music-test/output', controller.music_test_output);

router.get('/qwen3-lora', qwen3LoraAdminController.render);
router.get('/qwen3-lora/state', qwen3LoraAdminController.state);
router.post('/qwen3-lora/container/:action', qwen3LoraAdminController.containerAction);
router.post('/qwen3-lora/model/download', qwen3LoraAdminController.downloadModel);
router.post('/qwen3-lora/model/unload', qwen3LoraAdminController.unloadModel);
router.post('/qwen3-lora/datasets/upload', handleQwen3LoraDatasetUpload);
router.delete('/qwen3-lora/datasets/:datasetId', qwen3LoraAdminController.deleteDataset);
router.post('/qwen3-lora/datasets/:datasetId/delete', qwen3LoraAdminController.deleteDataset);
router.post('/qwen3-lora/train/jobs', qwen3LoraAdminController.createTrainingJob);
router.get('/qwen3-lora/train/jobs/:jobId', qwen3LoraAdminController.getTrainingJob);
router.post('/qwen3-lora/generate', qwen3LoraAdminController.generate);
router.post('/qwen3-lora/compare', qwen3LoraAdminController.compare);

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
