const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({ dest: './tmp_data/' });

// Require controller modules.
const controller = require('../controllers/mypagecontroller');

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

module.exports = router;
