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
const asArray = v =>
  v == null              ? []          :
  Array.isArray(v)       ? v           :
  /* string/number etc. */ [ v ];
const mapLines = (lbls, amts) => {
  const labels  = asArray(lbls);
  const amounts = asArray(amts);

  return labels
    .map((label, i) => ({
        label,
        amount: parseMoney(amounts[i])
    }))
    .filter(x => x.label);          // keep only non-empty rows
};

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
    // const mapLines = (lbls = [], amts = []) =>
    //   lbls
    //     .map((lbl, i) => ({ label: lbl, amount: parseMoney(amts[i]) }))
    //     .filter(l => l.label);

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

    // const mapLines = (lbls = [], amts = []) =>
    //   lbls.map((l, i) => ({ label: l, amount: parseMoney(amts[i]) }))
    //       .filter(x => x.label);

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

/* ------------------------------------------------------------------------- *
 *  DASHBOARD   /payroll/dashboard
 * ------------------------------------------------------------------------- */
exports.dashboard = async (req, res, next) => {
  try {
    const rows = await Payroll.find().lean();

    /* 1. merge bonus+salary into single YYYY-MM bucket ---------------- */
    const byMonth = new Map();                        // 'YYYY-MM' -> {gross,net,year,mm}
    rows.forEach(r => {
      const key = r.month;
      if (!byMonth.has(key))
        byMonth.set(key, { gross:0, net:0, year:+key.slice(0,4), mm:+key.slice(5) });
      const x = byMonth.get(key);
      x.gross += r.grossAmount;
      x.net   += r.netAmount;
    });

    /* 2. split into yearly structure --------------------------------- */
    const yearMap = new Map();                        // 2024 -> [12 numbers]
    byMonth.forEach(({net,year,mm}) => {
      if (!yearMap.has(year))
        yearMap.set(year, Array(12).fill(null));
      yearMap.get(year)[mm-1] = net;
    });

    /* 3. yearly totals & YoY % --------------------------------------- */
    const yearsSorted = Array.from(yearMap.keys()).sort();
    const yearSummary = yearsSorted.map(y => {
      const gross = rows.filter(r => r.month.startsWith(y))
                        .reduce((s,r)=>s+r.grossAmount,0);
      const net   = (yearMap.get(y) || []).reduce((s,v)=>s+(v||0),0);
      return {year:y,gross,net};
    });
    yearSummary.forEach((r,i,arr)=>{
      if (i===0) return;
      r.grossYoY = arr[i-1].gross? ((r.gross-arr[i-1].gross)/arr[i-1].gross)*100: null;
      r.netYoY   = arr[i-1].net?   ((r.net  -arr[i-1].net  )/arr[i-1].net  )*100: null;
    });

    /* 4. forecast ----------------------------------------------------- */
    // find latest month we have
    const latestKey = Array.from(byMonth.keys()).sort().pop();   // e.g. '2025-04'
    const [latestYear, latestM] = latestKey.split('-').map(Number);

    // collect YoY ratios for the last (up to) 6 months that HAVE last-year data
    const ratios = [];
    for (let i=0; ratios.length<6 && i<12; i++) {
      const d = new Date(latestYear, latestM-1-i);               // go back month by month
      const keyThis = d.toISOString().slice(0,7);                // yyyy-mm
      d.setFullYear(d.getFullYear()-1);
      const keyPrev = d.toISOString().slice(0,7);
      if (byMonth.has(keyThis) && byMonth.has(keyPrev)) {
        const rNow = byMonth.get(keyThis).net;
        const rPrev= byMonth.get(keyPrev).net;
        ratios.push(rPrev? rNow/rPrev : 1);
      }
    }
    const avgRatio = ratios.length? ratios.reduce((s,v)=>s+v,0)/ratios.length : 1;

    // build 6-month forecast (array of {key, predictedNet})
    const forecast = [];
    for (let i=1;i<=6;i++){
      const d = new Date(latestYear, latestM-1+i);
      const keyNext = d.toISOString().slice(0,7);
      const dPrev   = new Date(d); dPrev.setFullYear(dPrev.getFullYear()-1);
      const keyPrev = dPrev.toISOString().slice(0,7);
      const base    = byMonth.get(keyPrev)?.net ?? 0;
      forecast.push({month:keyNext, predicted: Math.round(base*avgRatio)});
    }

    /* 5. prep data for Chart.js -------------------------------------- */
    const chartDatasets = yearsSorted.map((y,idx) => ({
      label : String(y),
      data  : yearMap.get(y),
      borderColor : `hsl(${idx*60},70%,40%)`,
      spanGaps: true,
      fill:false
    }));
    // add forecast as dashed line
    chartDatasets.push({
      label: 'Forecast',
      data : forecast.reduce((arr,f)=>{
                const [yy,mm]=f.month.split('-').map(Number);
                if (!yearMap.has(yy)) yearMap.set(yy, Array(12).fill(null));
                yearMap.get(yy)[mm-1] = f.predicted;
                return arr;
             },[]), // we don't use this array directly
      borderColor:'black',
      borderDash:[5,5],
      fill:false,
      pointRadius:0
    });

    res.render('payroll/dashboard', {
      yearsSorted,
      chartData : JSON.stringify(chartDatasets),
      yearSummary,
      forecast
    });
  } catch(e){ next(e); }
};
