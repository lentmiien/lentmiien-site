var express = require('express');
var router = express.Router();

// Require controller modules.
var controller = require('../controllers/budget2controller');

/* GET home page */
router.get('/', controller.index);
router.get('/delete/:id', controller.delete);

/* ── REST ––––––––––––––––––––––––––––––––– */
router.get('/api/summary',              controller.summary);          // ?category=x
router.get('/api/breakdown/:cat/:y/:m', controller.breakdown);        // cat, year, month
router.get('/api/business',             controller.businessList);     // ?term=abc
router.get('/api/business/values',      controller.businessDefaults); // ?name=Seven-Eleven
router.post('/api/transaction',         controller.newTransaction);   // create
router.get ('/api/lists',               controller.lists);

module.exports = router;
