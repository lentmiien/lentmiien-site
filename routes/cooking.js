const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/cookingcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/edit_date', controller.edit_date);

router.post('/update_cooking_calendar', controller.update_cooking_calendar);

router.get('/cooking_statistics', controller.cooking_statistics);

module.exports = router;
