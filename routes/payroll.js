const express  = require('express');
const router   = express.Router();
const ctl      = require('../controllers/payrollController');

/* /payroll/ ---- */
router.get('/',        ctl.list);
router.get('/new',     ctl.renderNewForm);
router.post('/',       ctl.create);
router.get('/:id',     ctl.details);

module.exports = router;
