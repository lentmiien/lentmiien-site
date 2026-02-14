const express = require('express');
const router = express.Router();

const controller = require('../controllers/shoppinglistcontroller');

router.get('/', controller.shopping_list);

module.exports = router;
