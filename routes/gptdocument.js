const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/gptdocumentcontroller');

/* GET home page. */
router.get('/', controller.index);
router.post('/create_document', controller.create_document);
router.get('/document', controller.document);
router.get('/branch', controller.branch);
router.post('/generate_text_node', controller.generate_text_node);
router.post('/save_text_node', controller.save_text_node);

router.get('/specifications', controller.specifications);

router.get('/deletedocument', controller.deletedocument);

module.exports = router;
