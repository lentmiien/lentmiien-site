const express = require('express');
const router = express.Router();

const controller = require('../controllers/cookingcontroller');

// Legacy v1 routes
router.get('/', controller.index);
router.get('/edit_date', controller.edit_date);
router.post('/update_cooking_calendar', controller.update_cooking_calendar);
router.get('/cooking_statistics', controller.cooking_statistics);

// Version 2 routes
router.get('/v2', controller.indexV2);
router.get('/v2/api/calendar', controller.calendarV2);
router.get('/v2/api/recipes', controller.recipesV2);
router.post('/v2/api/entries', controller.createEntryV2);
router.delete('/v2/api/entries/:date/:entryId', controller.deleteEntryV2);
router.get('/v2/api/statistics', controller.statisticsDataV2);
router.get('/v2/statistics', controller.cooking_statistics_v2);

module.exports = router;
