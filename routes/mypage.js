const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({ dest: './tmp_data/' });
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

// Require controller modules.
const controller = require('../controllers/mypagecontroller');
const lifeLogController = require('../controllers/mylifelogcontroller');

/* GET home page. */
router.get('/', controller.mypage);

router.get('/embedding-search', controller.embedding_search_page);
router.post('/embedding-search', controller.embedding_search);

// Blogpost
router.get('/blogpost', controller.blogpost);
router.post('/post_blogpost', controller.post_blogpost);
router.get('/delete_blogpost', controller.delete_blogpost);

router.get('/speektome', controller.speektome);
router.post('/speektome', controller.speektome_post);
router.get('/showtome', controller.showtome);
router.post('/showtome', controller.showtome_post);

router.get('/pdf_to_jpg', controller.pdf_to_jpg);
router.post('/convert_pdf_to_jpg', upload.single('pdf'), controller.convert_pdf_to_jpg)
router.post('/pdf_to_chat', controller.pdf_to_chat)

/****
 * TEST GitHub
 */
router.get('/github', controller.github);
router.get('/getfolder', controller.getfolder);
router.get('/updatefolder', controller.updatefolder);
router.get('/getfile', controller.getfile);

// My life log
router.get('/life_log', lifeLogController.life_log_page);
router.get('/life_log/analytics', lifeLogController.life_log_analytics_page);
router.get('/life_log/entries', lifeLogController.life_log_entries);
router.post('/life_log/entry', lifeLogController.life_log_add_entry);
router.delete('/life_log/entry/:id', lifeLogController.life_log_delete_entry);
router.post('/life_log/import/preview', lifeLogCsvUploadMiddleware, lifeLogController.life_log_import_preview);
router.post('/life_log/import', lifeLogController.life_log_import);
router.post('/life_log/format', lifeLogController.life_log_format);

module.exports = router;
