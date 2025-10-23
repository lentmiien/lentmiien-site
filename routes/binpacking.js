const express = require('express');
const router = express.Router();

const controller = require('../controllers/binpackingcontroller');

router.get('/', controller.index);
router.post('/run', controller.run);

module.exports = router;
