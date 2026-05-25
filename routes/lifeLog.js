const express = require('express');
const multer = require('multer');

const lifeLogController = require('../controllers/mylifelogcontroller');
const lifeLogReminderController = require('../controllers/myLifeLogReminderController');

const router = express.Router();

const lifeLogCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const isCsv = name.toLowerCase().endsWith('.csv')
      || file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel';
    if (!isCsv) {
      return cb(new Error('Only CSV files can be imported.'));
    }
    return cb(null, true);
  },
});

const lifeLogCsvUploadMiddleware = (req, res, next) => {
  lifeLogCsvUpload.single('csv_file')(req, res, (error) => {
    if (error) {
      return res.status(400).render('error_page', { error: error.message || 'Unable to upload CSV file.' });
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
router.post('/import/preview', lifeLogCsvUploadMiddleware, lifeLogController.life_log_import_preview);
router.post('/import', lifeLogController.life_log_import);
router.post('/format', lifeLogController.life_log_format);

module.exports = router;
