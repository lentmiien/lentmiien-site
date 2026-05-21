const express = require('express');
const controller = require('../controllers/qwen3LoraController');

const router = express.Router();

router.get('/', controller.render);
router.get('/state', controller.state);
router.post('/generate', controller.generate);

module.exports = router;
