const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({
  dest: './tmp_data/',
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

// Require controller modules.
const controller = require('../controllers/mypagecontroller');

const requireAdminLifeLog = (req, res, next) => {
  if (req.user && req.user.type_user === 'admin') {
    return next();
  }
  const wantsJson = String(req.headers?.accept || '').includes('application/json')
    || String(req.headers?.['content-type'] || '').includes('application/json');
  if (wantsJson) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return res.redirect('/');
};

const redirectLegacyLifeLog = (req, res) => {
  const suffix = req.url === '/' ? '' : req.url;
  return res.redirect(307, `/admin/life_log${suffix}`);
};

/* GET home page. */
router.get('/', controller.mypage);
router.post('/icon-settings', controller.update_icon_settings);

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

// My Life Log moved to the admin router. Keep old links gated and redirected.
router.use('/life_log', requireAdminLifeLog, redirectLegacyLifeLog);

module.exports = router;
