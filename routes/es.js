const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/escontroller');

router.get('/es_dashboard', controller.es_dashboard);
router.get('/es_view_stock', controller.es_view_stock);
router.post('/edit_category', controller.edit_category);
router.post('/add_item', controller.add_item);
router.post('/adjust_item', controller.adjust_item);
router.post('/resolve_item', controller.resolve_item);
router.post('/inspect_item', controller.inspect_item);
router.post('/review_stock', controller.review_stock);
router.post('/set_applicability', controller.set_applicability);
router.post('/classify_food_item', controller.classify_food_item);
router.post('/convert_unit', controller.convert_unit);
router.post('/edit_profile', controller.edit_profile);
router.post('/update_requirement', controller.update_requirement);
router.post('/save_menu_entry', controller.save_menu_entry);
router.post('/delete_menu_entry', controller.delete_menu_entry);

module.exports = router;
