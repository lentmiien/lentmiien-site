var express = require('express');
var router = express.Router();

// Require controller modules.
var controller = require('../controllers/budget2controller');

/* GET home page */
router.get('/', controller.index);
router.get('/delete/:id', controller.delete);

module.exports = router;
