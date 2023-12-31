const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/cookingcontroller');

/* GET home page. */
router.get('/', controller.index);

router.post('/update_cooking_calendar', controller.update_cooking_calendar);

module.exports = router;
