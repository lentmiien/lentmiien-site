/* eslint max-lines: off */
const { Payroll } = require('../database');

/* ------------------------------------------------------------------------- *
 *  CONSTANTS – because you only track your own payslip
 * ------------------------------------------------------------------------- */
const MY_INFO = Object.freeze({
  employeeNo:   process.env.employeeNo,
  employeeName: process.env.employeeName,
  department:   process.env.department
});

/* tiny helpers ------------------------------------------------------------ */
const toInt      = v => parseInt(v, 10) || 0;
const parseMoney = v => Number(v.toString().replace(/[, ]/g, '')) || 0;

/* HH:mm  -> minutes  (eg. “2:04” -> 124)                                   */
function timeToMin(str = '0:00') {
  const [h = 0, m = 0] = str.split(':').map(Number);
  return (h * 60) + m;
}

/* ------------------------------------------------------------------------- *
 *  CONTROLLER ACTIONS
 * ------------------------------------------------------------------------- */

/** GET /payroll             – list of months */
exports.list = async (req, res, next) => {
  try {
    const_docs = await Payroll.find()
                              .sort({ month: -1 })
                              .lean();
    res.render('payroll/list', { docs: const_docs });
  } catch (e) { next(e); }
};

/** GET /payroll/new         – input form     */
exports.renderNewForm = (req, res) => {
  res.render('payroll/form', {
    employee: MY_INFO,
    today    : new Date().toISOString().substring(0, 10) // yyyy-mm-dd
  });
};

/** POST /payroll            – create         */
exports.create = async (req, res, next) => {
  try {
    const b = req.body;

    /* build attendance object ------------------------------------------ */
    const attendance = {
      daysWorked              : toInt(b.daysWorked),
      daysOff                 : toInt(b.daysOff),
      specialHoliday          : toInt(b.specialHoliday),
      paidLeaveDays           : toInt(b.paidLeaveDays),
      absenceDays             : toInt(b.absenceDays),
      remainingLeaveDays      : toInt(b.remainingLeaveDays),

      paidLeaveMinutes        : timeToMin(b.paidLeaveMinutes),
      remainingLeaveMinutes   : timeToMin(b.remainingLeaveMinutes),
      remainingHourlyLeaveMin : timeToMin(b.remainingHourlyLeaveMin),
      workingMinutes          : timeToMin(b.workingMinutes),
      lateEarlyMinutes        : timeToMin(b.lateEarlyMinutes),
      regularOvertimeMinutes  : timeToMin(b.regularOvertimeMinutes)
    };

    /* earnings[] & deductions[] ---------------------------------------- */
    const mapLines = (lbls = [], amts = []) =>
      lbls
        .map((lbl, i) => ({ label: lbl, amount: parseMoney(amts[i]) }))
        .filter(l => l.label);

    const earnings    = mapLines(b.earnLabel, b.earnAmount);
    const deductions  = mapLines(b.deductLabel, b.deductAmount);

    /* Totals – user may type them, otherwise sum them automatically ---- */
    const gross       = b.grossAmount        ? parseMoney(b.grossAmount)
                                             : earnings.reduce((s, x) => s + x.amount, 0);
    const totalDeduct = b.totalDeductions    ? parseMoney(b.totalDeductions)
                                             : deductions.reduce((s, x) => s + x.amount, 0);
    const net         = gross - totalDeduct;

    /* build & save document -------------------------------------------- */
    await Payroll.create({
      ...MY_INFO,
      month          : b.month,                        // yyyy-MM
      payDate        : new Date(b.payDate),
      periodStart    : new Date(b.periodStart),
      periodEnd      : new Date(b.periodEnd),
      attendance,
      earnings,
      deductions,
      grossAmount        : gross,
      totalDeductions    : totalDeduct,
      netAmount          : net,
      bankTransferAmount : net,                        // assume same
      notes              : b.notes || ''
    });

    res.redirect('/payroll');
  } catch (e) {
    // duplicate month?
    if (e.code === 11000) {
      req.flash('error', 'That month already exists');
      return res.redirect('back');
    }
    next(e);
  }
};

/** GET /payroll/:id         – details        */
exports.details = async (req, res, next) => {
  try {
    const doc = await Payroll.findById(req.params.id).lean();
    if (!doc) return res.sendStatus(404);
    res.render('payroll/detail', { p: doc });
  } catch (e) { next(e); }
};

/* ------------------------------------------------------------------------- *
 *  EDIT  (reuse same helpers)
 * ------------------------------------------------------------------------- */

/** GET /payroll/:id/edit  – render pre-filled form */
exports.renderEditForm = async (req, res, next) => {
  try {
    const doc = await Payroll.findById(req.params.id).lean();
    if (!doc) return res.sendStatus(404);
    res.render('payroll/form', { employee: doc, doc, isEdit: true });
  } catch (e) { next(e); }
};

/** PUT /payroll/:id       – update in DB          */
exports.update = async (req, res, next) => {
  try {
    const b  = req.body;
    const id = req.params.id;

    /* identical build code as create() --------------------------------- */
    const attendance = {
      daysWorked              : toInt(b.daysWorked),
      daysOff                 : toInt(b.daysOff),
      specialHoliday          : toInt(b.specialHoliday),
      paidLeaveDays           : toInt(b.paidLeaveDays),
      absenceDays             : toInt(b.absenceDays),
      remainingLeaveDays      : toInt(b.remainingLeaveDays),

      paidLeaveMinutes        : timeToMin(b.paidLeaveMinutes),
      remainingLeaveMinutes   : timeToMin(b.remainingLeaveMinutes),
      remainingHourlyLeaveMin : timeToMin(b.remainingHourlyLeaveMin),
      workingMinutes          : timeToMin(b.workingMinutes),
      lateEarlyMinutes        : timeToMin(b.lateEarlyMinutes),
      regularOvertimeMinutes  : timeToMin(b.regularOvertimeMinutes)
    };

    const mapLines = (lbls = [], amts = []) =>
      lbls.map((l, i) => ({ label: l, amount: parseMoney(amts[i]) }))
          .filter(x => x.label);

    const earnings   = mapLines(b.earnLabel,   b.earnAmount);
    const deductions = mapLines(b.deductLabel, b.deductAmount);

    const gross       = parseMoney(b.grossAmount)     ||
                        earnings.reduce((s, x) => s + x.amount, 0);
    const totalDeduct = parseMoney(b.totalDeductions) ||
                        deductions.reduce((s, x) => s + x.amount, 0);
    const net         = gross - totalDeduct;

    await Payroll.findByIdAndUpdate(id, {
      month          : b.month,
      payDate        : new Date(b.payDate),
      periodStart    : new Date(b.periodStart),
      periodEnd      : new Date(b.periodEnd),
      attendance,
      earnings,
      deductions,
      grossAmount        : gross,
      totalDeductions    : totalDeduct,
      netAmount          : net,
      bankTransferAmount : net,
      notes              : b.notes || ''
    });

    res.redirect(`/payroll/${id}`);
  } catch (e) { next(e); }
};

/* ------------------------------------------------------------------------- *
 *  ANALYTICS
 * ------------------------------------------------------------------------- */
const monthKey = d => d.month;     // already 'YYYY-MM'

exports.analytics = async (req, res, next) => {
  try {
    /* fetch all docs & aggregate bonus and salary of same month */
    const docs = await Payroll.find().lean();

    // group by 'YYYY-MM'
    const grouped = new Map();
    docs.forEach(d => {
      const key = monthKey(d);
      if (!grouped.has(key))
        grouped.set(key, { gross: 0, net: 0 });
      const g = grouped.get(key);
      g.gross += d.grossAmount;
      g.net   += d.netAmount;
    });

    /* sort chronological ASC */
    const months = Array.from(grouped.keys()).sort();
    const series = months.map(m => ({ month: m, ...grouped.get(m) }));

    /* take last 12 months */
    const last12 = series.slice(-12);

    /* YoY diff */
    const gByKey = Object.fromEntries(series.map(r => [r.month, r.net]));
    last12.forEach(r => {
      const [y, mm] = r.month.split('-').map(Number);
      const prevKey = `${y - 1}-${mm.toString().padStart(2, '0')}`;
      r.prevNet = gByKey[prevKey] ?? null;
      r.diff    = r.prevNet != null ? r.net - r.prevNet : null;
    });

    /* arrays for Chart.js */
    const labels      = last12.map(r => r.month);
    const grossSeries = last12.map(r => r.gross);
    const netSeries   = last12.map(r => r.net);

    res.render('payroll/analytics', {
      labels: JSON.stringify(labels),
      grossSeries: JSON.stringify(grossSeries),
      netSeries:   JSON.stringify(netSeries),
      tableRows: last12.reverse()   // newest first in table
    });
  } catch (e) { next(e); }
};

