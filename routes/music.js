const express = require('express');
const router = express.Router();

const controller = require('../controllers/musiccontroller');

router.get('/', controller.music_page);
router.post('/generate', controller.music_generate);
router.post('/generate-ai', controller.music_generate_ai);
router.get('/status/:id', controller.music_status);
router.get('/output', controller.music_output);
router.get('/library', controller.music_library_list);
router.get('/library/random', controller.music_library_random);
router.post('/library/:id/rating', controller.music_library_rate);
router.post('/library/:id/played', controller.music_library_played);

module.exports = router;
