const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/embeddingcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/update', controller.update);
router.post('/query', controller.query);
router.post('/find', controller.find);

module.exports = router;
