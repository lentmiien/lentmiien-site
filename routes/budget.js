var express = require('express');
var router = express.Router();

// Require controller modules.
var controller = require('../controllers/budgetcontroller');

/* GET home page */
router.get('/', controller.index);
router.get('/add_transaction', controller.add_transaction);
router.post('/add_transaction', controller.add_transaction_post);

router.get('/manage/accounts', controller.manage_accounts);
router.post('/api/accounts', controller.manage_accounts_api);
router.get('/manage/categories', controller.manage_categories);
router.post('/api/categories', controller.manage_categories_api);

router.get('/history', controller.history);
router.get('/delete/:id', controller.delete);

// For deleting test data
router.get('/delete_all', controller.delete_all);

module.exports = router;
