const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/quicknotecontroller');

/* GET top page */
router.get('/', controller.quick_note);

router.post('/add', controller.add);
router.get('/get_all', controller.get_all);
router.delete('/delete/:id', controller.delete);
router.delete('/delete_old', controller.delete_old);

router.post('/add_location', controller.add_location);

router.get('/navigate_to_location', controller.navigate_to_location);

module.exports = router;
