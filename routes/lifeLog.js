const express = require('express');
const multer = require('multer');

const lifeLogController = require('../controllers/mylifelogcontroller');
const lifeLogReminderController = require('../controllers/myLifeLogReminderController');

const router = express.Router();
const LIFE_LOG_IMPORT_FILE_SIZE_MB = 256;

const lifeLogImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIFE_LOG_IMPORT_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const isCsv = name.toLowerCase().endsWith('.csv')
      || file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel';
    const isZip = name.toLowerCase().endsWith('.zip')
      || file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed';
    if (!isCsv && !isZip) {
      return cb(new Error('Only CSV and ZIP files can be imported.'));
    }
    return cb(null, true);
  },
});

const lifeLogImportUploadMiddleware = (req, res, next) => {
  lifeLogImportUpload.single('csv_file')(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `Life log import files must be ${LIFE_LOG_IMPORT_FILE_SIZE_MB} MB or smaller.`
        : error.message || 'Unable to upload this import file.';
      return res.status(400).render('error_page', { error: message });
    }
    return next();
  });
};

router.get('/', lifeLogController.life_log_page);
router.get('/reminders', lifeLogReminderController.life_log_reminders_page);
router.post('/reminders', lifeLogReminderController.life_log_save_reminder);
router.post('/reminders/:id/delete', lifeLogReminderController.life_log_delete_reminder);
router.get('/analytics', lifeLogController.life_log_analytics_page);
router.get('/entries', lifeLogController.life_log_entries);
router.post('/entry', lifeLogController.life_log_add_entry);
router.delete('/entry/:id', lifeLogController.life_log_delete_entry);
router.post('/import/preview', lifeLogImportUploadMiddleware, lifeLogController.life_log_import_preview);
router.post('/import', lifeLogController.life_log_import);
router.post('/import/samsung-health', lifeLogController.life_log_samsung_health_import);
router.post('/format', lifeLogController.life_log_format);

module.exports = router;
