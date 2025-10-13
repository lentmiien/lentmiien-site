var express = require('express');
var multer = require('multer');
var router = express.Router();

// Require controller modules.
var controller = require('../controllers/budget2controller');

var upload = multer({ storage: multer.memoryStorage() });

/* GET home page */
router.get('/', controller.index);
router.get('/delete/:id', controller.delete);
router.get('/review', controller.reviewTransactions);
router.get('/review/:year/:month', controller.reviewTransactions);

/* ── Credit card tracker ───────────────── */
router.get('/cards', controller.creditCardsDashboard);
router.get('/cards/month/:year/:month', controller.creditCardsMonthPage);
router.get('/cards/api/cards', controller.creditCardsList);
router.get('/cards/api/overview', controller.creditCardsOverview);
router.get('/cards/api/month/:year/:month', controller.creditCardsMonthData);
router.post('/cards/api/transaction', controller.creditCardsCreateTransaction);
router.delete('/cards/api/transaction/:transactionId', controller.creditCardsDeleteTransaction);
router.post('/cards/api/month/:year/:month/confirm', controller.creditCardsConfirmMonth);
router.patch('/cards/api/card/:cardId', controller.creditCardsUpdateCard);
router.delete('/cards/api/card/:cardId/data', controller.creditCardsClearData);
router.post('/cards/api/import', upload.single('file'), controller.creditCardsImportCsv);
router.post('/cards/api/card', controller.creditCardsCreateCard);

/* ── REST –––––––––––––––––––––––––––––––– E*/
router.get('/api/summary',              controller.summary);          // ?category=x
router.get('/api/breakdown/:cat/:y/:m', controller.breakdown);        // cat, year, month
router.get('/api/business',             controller.businessList);     // ?term=abc
router.get('/api/business/values',      controller.businessDefaults); // ?name=Seven-Eleven
router.post('/api/transaction',         controller.newTransaction);   // create
router.get ('/api/lists',               controller.lists);

module.exports = router;
