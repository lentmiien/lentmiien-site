const express  = require('express');
const router   = express.Router();
const ctl      = require('../controllers/payrollController');
const methodOverride = require('method-override');

router.use(methodOverride('_method'));

/* ---- list / analytics BEFORE :id ----- */
router.get('/',            ctl.list);
router.get('/new',         ctl.renderNewForm);
router.get('/analytics',   ctl.analytics);
router.get('/dashboard',   ctl.dashboard);
router.get('/year/:year?', ctl.yearSummary);
router.get('/attendance',  ctl.attendanceStats);

/* create */
router.post('/',           ctl.create);

/* edit / update */
router.get('/:id/edit',    ctl.renderEditForm);
router.put('/:id',         ctl.update);

/* details must stay last */
router.get('/:id',         ctl.details);

module.exports = router;
