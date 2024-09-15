const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/productdetailscontroller');

/* GET home page. */
router.get('/', controller.product);
router.post('/upload_product_data', controller.upload_product_data);
router.post('/update_product', controller.update_product);
router.post('/delete_product', controller.delete_product);

module.exports = router;
