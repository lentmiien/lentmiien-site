const express = require('express');

const controller = require('../controllers/pushoverReminderController');

const router = express.Router();

router.get('/', controller.index);
router.post('/', controller.create);
router.get('/history', controller.history);
router.get('/:id/edit', controller.edit);
router.post('/:id/update', controller.update);
router.post('/:id/delete', controller.remove);

module.exports = router;
