const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/escontroller');

router.get('/es_dashboard', controller.es_dashboard);
router.get('/es_view_stock', controller.es_view_stock);
router.post('/edit_category', controller.edit_category);
router.post('/add_item', controller.add_item);

module.exports = router;
