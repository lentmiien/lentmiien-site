const express = require('express');

const router = express.Router();
const controller = require('../controllers/bookmarkcontroller');

router.get('/', controller.list);
router.post('/add', controller.add);
router.post('/:id/update', controller.update);
router.post('/:id/delete', controller.remove);

module.exports = router;
