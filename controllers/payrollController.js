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

const MONTHS_IN_YEAR = 12;
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const sumYearArray = (arr = []) =>
  arr.reduce((sum, val) => sum + (val ?? 0), 0);
const avgNonNull = (arr = []) => {
  const values = arr.filter(v => v != null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
};
const averageDiff = (current = [], previous = []) => {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    const cur = current[i];
    const prev = previous[i];
    if (cur != null && prev != null) {
      sum += (cur - prev);
      count++;
    }
  }
  return count ? sum / count : 0;
};
const minutesToHours = (min = 0) => Number((min / 60).toFixed(1));

function aggregateByMonth(rows = []) {
  const byMonth = new Map();
  rows.forEach(doc => {
    const key = doc.month;
    if (!key) return;
    if (!byMonth.has(key))
      byMonth.set(key, {
        gross: 0,
        net: 0,
        year: Number(key.slice(0, 4)),
        mm: Number(key.slice(5, 7))
      });
    const bucket = byMonth.get(key);
    bucket.gross += doc.grossAmount;
    bucket.net   += doc.netAmount;
  });

  const monthlySeries = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, ...value }));

  return { byMonth, monthlySeries };
}

function buildYearMatrices(monthlySeries = []) {
  const yearGrossMap = new Map();
  const yearNetMap   = new Map();

  monthlySeries.forEach(({ year, mm, gross, net }) => {
    if (!yearGrossMap.has(year)) {
      yearGrossMap.set(year, Array(MONTHS_IN_YEAR).fill(null));
      yearNetMap.set(year,   Array(MONTHS_IN_YEAR).fill(null));
    }
    yearGrossMap.get(year)[mm - 1] = gross;
    yearNetMap.get(year)[mm - 1]   = net;
  });

  const yearsSorted = Array.from(yearGrossMap.keys()).sort((a, b) => a - b);
  return { yearGrossMap, yearNetMap, yearsSorted };
}

function buildYearSummary(yearGrossMap, yearNetMap, yearsSorted) {
  const rows = yearsSorted.map(year => ({
    year,
    label: String(year),
    gross: sumYearArray(yearGrossMap.get(year)),
    net:   sumYearArray(yearNetMap.get(year))
  }));

  rows.forEach((row, idx) => {
    if (idx === 0) return;
    const prev = rows[idx - 1];
    row.grossYoY = prev.gross ? ((row.gross - prev.gross) / prev.gross) * 100 : null;
    row.netYoY   = prev.net   ? ((row.net   - prev.net)   / prev.net)   * 100 : null;
  });

  return rows;
}

function buildSixMonthForecast(byMonth) {
  if (!byMonth.size) return [];

  const sortedKeys = Array.from(byMonth.keys()).sort();
  const latestKey  = sortedKeys[sortedKeys.length - 1];
  if (!latestKey) return [];

  const [latestYear, latestMonth] = latestKey.split('-').map(Number);

  const ratios = [];
  for (let i = 0; ratios.length < 6 && i < 12; i++) {
    const cursor = new Date(latestYear, latestMonth - 1 - i);
    const keyNow = cursor.toISOString().slice(0, 7);
    const prevCursor = new Date(cursor);
    prevCursor.setFullYear(prevCursor.getFullYear() - 1);
    const keyPrev = prevCursor.toISOString().slice(0, 7);
    if (byMonth.has(keyNow) && byMonth.has(keyPrev)) {
      const prevNet = byMonth.get(keyPrev).net;
      ratios.push(prevNet ? byMonth.get(keyNow).net / prevNet : 1);
    }
  }
  const avgRatio = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : 1;

  const forecast = [];
  for (let i = 1; i <= 6; i++) {
    const cursor = new Date(latestYear, latestMonth - 1 + i);
    const keyNext = cursor.toISOString().slice(0, 7);
    const prevCursor = new Date(cursor);
    prevCursor.setFullYear(prevCursor.getFullYear() - 1);
    const keyPrev = prevCursor.toISOString().slice(0, 7);
    const base    = byMonth.get(keyPrev)?.net ?? 0;
    forecast.push({ month: keyNext, predicted: Math.round(base * avgRatio) });
  }
  return forecast;
}

function buildPredictionRow({ monthlySeries, yearGrossMap, yearNetMap, currentYear }) {
  if (!monthlySeries.length) return null;

  const hasCurrentYearDecember = monthlySeries.some(
    m => m.year === currentYear && m.mm === 12
  );
  const predictionYear = hasCurrentYearDecember ? currentYear + 1 : currentYear;

  const grossTemplate = (yearGrossMap.get(predictionYear) || Array(MONTHS_IN_YEAR).fill(null)).slice();
  const netTemplate   = (yearNetMap.get(predictionYear)   || Array(MONTHS_IN_YEAR).fill(null)).slice();

  const baseYear = predictionYear - 1;
  const baselineGross = (yearGrossMap.get(baseYear) || Array(MONTHS_IN_YEAR).fill(null)).slice();
  const baselineNet   = (yearNetMap.get(baseYear)   || Array(MONTHS_IN_YEAR).fill(null)).slice();
  const priorGross    = (yearGrossMap.get(baseYear - 1) || Array(MONTHS_IN_YEAR).fill(null)).slice();
  const priorNet      = (yearNetMap.get(baseYear - 1)   || Array(MONTHS_IN_YEAR).fill(null)).slice();

  const deltaSourceGross = predictionYear === currentYear ? grossTemplate : baselineGross;
  const deltaSourceNet   = predictionYear === currentYear ? netTemplate   : baselineNet;
  const deltaBaseGross   = predictionYear === currentYear ? baselineGross : priorGross;
  const deltaBaseNet     = predictionYear === currentYear ? baselineNet   : priorNet;

  const avgGrossDelta = averageDiff(deltaSourceGross, deltaBaseGross);
  const avgNetDelta   = averageDiff(deltaSourceNet,   deltaBaseNet);

  const fallbackGross = avgNonNull(baselineGross) || avgNonNull(deltaSourceGross) || 0;
  const fallbackNet   = avgNonNull(baselineNet)   || avgNonNull(deltaSourceNet)   || 0;

  let predictedAny = false;
  for (let monthIdx = 0; monthIdx < MONTHS_IN_YEAR; monthIdx++) {
    if (grossTemplate[monthIdx] == null) {
      const baseVal = baselineGross[monthIdx];
      const estimate = (baseVal != null ? baseVal : fallbackGross) + avgGrossDelta;
      grossTemplate[monthIdx] = Math.max(0, Math.round(estimate));
      predictedAny = true;
    }
    if (netTemplate[monthIdx] == null) {
      const baseVal = baselineNet[monthIdx];
      const estimate = (baseVal != null ? baseVal : fallbackNet) + avgNetDelta;
      netTemplate[monthIdx] = Math.max(0, Math.round(estimate));
      predictedAny = true;
    }
  }

  if (!predictedAny) return null;

  const gross = sumYearArray(grossTemplate);
  const net   = sumYearArray(netTemplate);

  return {
    year: predictionYear,
    label: `Prediction ${predictionYear}`,
    gross,
    net,
    isPrediction: true
  };
}

function aggregateMoneyItemsByLabel(docs = [], field) {
  const totals = new Map();
  docs.forEach(doc => {
    (doc[field] || []).forEach(item => {
      if (!item?.label) return;
      totals.set(item.label, (totals.get(item.label) || 0) + (item.amount || 0));
    });
  });
  return Array.from(totals.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function buildYearComparison(baseYear, otherYear, yearGrossMap, yearNetMap) {
  if (!yearGrossMap.has(baseYear) || !yearGrossMap.has(otherYear)) return null;

  const baseGross = yearGrossMap.get(baseYear) || Array(MONTHS_IN_YEAR).fill(null);
  const baseNet   = yearNetMap.get(baseYear)   || Array(MONTHS_IN_YEAR).fill(null);
  const otherGross= yearGrossMap.get(otherYear) || Array(MONTHS_IN_YEAR).fill(null);
  const otherNet  = yearNetMap.get(otherYear)   || Array(MONTHS_IN_YEAR).fill(null);

  const indexes = [];
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    if (baseGross[i] != null && otherGross[i] != null) indexes.push(i);
  }
  if (!indexes.length) return null;

  const reduceWithIndexes = (arr) => indexes.reduce((sum, idx) => sum + (arr[idx] ?? 0), 0);
  const grossBase  = reduceWithIndexes(baseGross);
  const grossOther = reduceWithIndexes(otherGross);
  const netBase    = reduceWithIndexes(baseNet);
  const netOther   = reduceWithIndexes(otherNet);

  const firstIdx = indexes[0];
  const lastIdx  = indexes[indexes.length - 1];
  const rangeLabel = indexes.length === MONTHS_IN_YEAR
    ? 'Full year'
    : `${MONTH_LABELS[firstIdx]} - ${MONTH_LABELS[lastIdx]}`;

  return {
    year: otherYear,
    monthsCompared: indexes.length,
    rangeLabel,
    partial: indexes.length < MONTHS_IN_YEAR,
    gross: {
      base: grossBase,
      other: grossOther,
      diff: grossBase - grossOther,
      pct: grossOther ? ((grossBase - grossOther) / grossOther) * 100 : null
    },
    net: {
      base: netBase,
      other: netOther,
      diff: netBase - netOther,
      pct: netOther ? ((netBase - netOther) / netOther) * 100 : null
    }
  };
}

const formatMonthStat = entry => {
  if (!entry) return null;
  return {
    key: entry.key,
    net: entry.net,
    gross: entry.gross,
    label: `${MONTH_LABELS[entry.mm - 1]} ${entry.year}`
  };
};

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
    const { byMonth, monthlySeries } = aggregateByMonth(rows);
    const { yearGrossMap, yearNetMap, yearsSorted } = buildYearMatrices(monthlySeries);

    const yearSummary = buildYearSummary(yearGrossMap, yearNetMap, yearsSorted);
    const predictionRow = buildPredictionRow({
      monthlySeries,
      yearGrossMap,
      yearNetMap,
      currentYear: new Date().getFullYear()
    });
    if (predictionRow) {
      const prevActual = yearSummary.find(r => r.year === predictionRow.year - 1 && !r.isPrediction);
      if (prevActual?.gross) {
        predictionRow.grossYoY = ((predictionRow.gross - prevActual.gross) / prevActual.gross) * 100;
      }
      if (prevActual?.net) {
        predictionRow.netYoY = ((predictionRow.net - prevActual.net) / prevActual.net) * 100;
      }
      yearSummary.push(predictionRow);
    }

    const forecast = buildSixMonthForecast(byMonth);

    const chartDatasets = yearsSorted.map((year, idx) => ({
      label: String(year),
      data: yearNetMap.get(year),
      borderColor: `hsl(${idx * 60},70%,40%)`,
      spanGaps: true,
      fill: false
    }));

    const forecastByYear = new Map();
    forecast.forEach(item => {
      const [yearStr, monthStr] = item.month.split('-');
      const year = Number(yearStr);
      const monthIdx = Number(monthStr) - 1;
      if (!forecastByYear.has(year))
        forecastByYear.set(year, Array(MONTHS_IN_YEAR).fill(null));
      forecastByYear.get(year)[monthIdx] = item.predicted;
    });
    forecastByYear.forEach((data, year) => {
      chartDatasets.push({
        label: `${year} forecast`,
        data,
        borderColor: '#999',
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        tension: 0.3
      });
    });

    res.render('payroll/dashboard', {
      yearsSorted,
      chartData: JSON.stringify(chartDatasets),
      yearSummary,
      forecast
    });
  } catch(e){ next(e); }
};

exports.yearSummary = async (req, res, next) => {
  try {
    const requestedYear = Number(req.params.year || req.query.year);
    const rows = await Payroll.find().lean();
    const { monthlySeries } = aggregateByMonth(rows);
    const { yearGrossMap, yearNetMap, yearsSorted } = buildYearMatrices(monthlySeries);

    const latestYear = yearsSorted[yearsSorted.length - 1];
    const fallbackYear = Number.isFinite(requestedYear) ? requestedYear :
                         (latestYear ?? new Date().getFullYear());
    const year = yearsSorted.includes(fallbackYear)
      ? fallbackYear
      : (latestYear ?? fallbackYear);

    const yearDocs = rows.filter(doc => doc.month.startsWith(String(year)));
    const monthlyGross = (yearGrossMap.get(year) || Array(MONTHS_IN_YEAR).fill(null)).slice();
    const monthlyNet   = (yearNetMap.get(year)   || Array(MONTHS_IN_YEAR).fill(null)).slice();
    const monthsWithData = monthlyNet.filter(v => v != null).length;

    const grossTotal = sumYearArray(monthlyGross);
    const netTotal   = sumYearArray(monthlyNet);
    const deductionsTotal = yearDocs.reduce((sum, doc) => sum + (doc.totalDeductions || 0), 0);

    const netValuesSorted = monthlyNet.filter(v => v != null).sort((a, b) => a - b);
    const medianNet = netValuesSorted.length
      ? netValuesSorted[Math.floor(netValuesSorted.length / 2)]
      : 0;

    const stats = {
      grossTotal,
      netTotal,
      deductionsTotal,
      monthsWithData,
      avgNet: monthsWithData ? Math.round(netTotal / monthsWithData) : 0,
      medianNet
    };

    const currentYearSeries = monthlySeries.filter(item => item.year === year);
    const bestMonth = formatMonthStat(
      currentYearSeries.reduce((best, entry) => {
        if (!entry) return best;
        if (!best || entry.net > best.net) return entry;
        return best;
      }, null)
    );
    const worstMonth = formatMonthStat(
      currentYearSeries.reduce((worst, entry) => {
        if (!entry) return worst;
        if (!worst || entry.net < worst.net) return entry;
        return worst;
      }, null)
    );

    const earningsBreakdownRaw   = aggregateMoneyItemsByLabel(yearDocs, 'earnings');
    const deductionsBreakdownRaw = aggregateMoneyItemsByLabel(yearDocs, 'deductions');
    const earningsTotal = earningsBreakdownRaw.reduce((sum, item) => sum + item.total, 0);
    const deductionBreakdownTotal = deductionsBreakdownRaw.reduce((sum, item) => sum + item.total, 0);
    const earningsBreakdown = earningsBreakdownRaw.map(item => ({
      ...item,
      percent: earningsTotal ? (item.total / earningsTotal) * 100 : 0
    }));
    const deductionsBreakdown = deductionsBreakdownRaw.map(item => ({
      ...item,
      percent: deductionBreakdownTotal ? (item.total / deductionBreakdownTotal) * 100 : 0
    }));

    const comparisons = {
      prev: buildYearComparison(year, year - 1, yearGrossMap, yearNetMap),
      next: buildYearComparison(year, year + 1, yearGrossMap, yearNetMap)
    };

    const chartPayload = JSON.stringify({
      labels: MONTH_LABELS,
      gross: monthlyGross.map(v => v ?? null),
      net: monthlyNet.map(v => v ?? null)
    });

    res.render('payroll/yearSummary', {
      year,
      availableYears: yearsSorted,
      hasData: yearDocs.length > 0,
      stats,
      bestMonth,
      worstMonth,
      earningsBreakdown,
      deductionsBreakdown,
      comparisons,
      chartPayload
    });
  } catch (e) { next(e); }
};

exports.attendanceStats = async (req, res, next) => {
  try {
    const docs = await Payroll.find().sort({ month: 1 }).lean();
    if (!docs.length) {
      return res.render('payroll/attendance', {
        hasData: false,
        yearsInScope: [],
        yearRangeLabel: '',
        summary: {},
        yearRows: [],
        dayChartPayload: 'null',
        timeChartPayload: 'null',
        remainingChartPayload: 'null',
        coverage: { availableMonths: 0, missingMonths: 0 }
      });
    }

    const yearSet = Array.from(new Set(docs.map(doc => Number(doc.month.slice(0, 4)))))
                         .sort((a, b) => a - b);
    const latestYear = yearSet[yearSet.length - 1] || new Date().getFullYear();
    const startYear = latestYear - 4;
    const yearsInScope = [];
    for (let y = startYear; y <= latestYear; y++) yearsInScope.push(y);

    const metricsConfig = [
      { key: 'daysWorked', label: 'Days worked', type: 'sum', unit: 'days' },
      { key: 'daysOff', label: 'Days off', type: 'sum', unit: 'days' },
      { key: 'paidLeaveDays', label: 'Paid leave days', type: 'sum', unit: 'days' },
      { key: 'absenceDays', label: 'Absence days', type: 'sum', unit: 'days' },
      { key: 'remainingLeaveDays', label: 'Remaining leave days', type: 'avg', unit: 'days' },
      { key: 'workingMinutes', label: 'Working minutes', type: 'sum', unit: 'minutes' },
      { key: 'regularOvertimeMinutes', label: 'Overtime minutes', type: 'sum', unit: 'minutes' },
      { key: 'lateEarlyMinutes', label: 'Late/Early minutes', type: 'sum', unit: 'minutes' }
    ];

    const attendanceByYear = new Map();
    yearsInScope.forEach(year => {
      attendanceByYear.set(year, {
        months: 0,
        sums: Object.fromEntries(metricsConfig.map(m => [m.key, 0])),
        last: Object.fromEntries(metricsConfig.map(m => [m.key, 0]))
      });
    });

    docs.forEach(doc => {
      const year = Number(doc.month.slice(0, 4));
      if (year < startYear || year > latestYear) return;
      const bucket = attendanceByYear.get(year);
      if (!bucket) return;
      const att = doc.attendance || {};
      bucket.months += 1;
      metricsConfig.forEach(metric => {
        const value = att[metric.key] ?? 0;
        bucket.sums[metric.key] += value;
        bucket.last[metric.key] = value;
      });
    });

    const statsPerYear = yearsInScope.map(year => {
      const bucket = attendanceByYear.get(year);
      const result = { year, monthsRecorded: bucket.months };
      metricsConfig.forEach(metric => {
        if (metric.type === 'sum' || metric.type === 'sumMinutes') {
          result[metric.key] = bucket.sums[metric.key];
        } else if (metric.type === 'avg') {
          result[metric.key] = bucket.months ? bucket.sums[metric.key] / bucket.months : 0;
        } else if (metric.type === 'latest') {
          result[metric.key] = bucket.last[metric.key];
        }
      });
      return result;
    });

    const latestStats = statsPerYear[statsPerYear.length - 1] || {};
    const prevStats = statsPerYear[statsPerYear.length - 2] || null;
    const yearsWithData = statsPerYear.filter(r => r.monthsRecorded);
    const summary = {
      latestYear: latestYear,
      latestDaysWorked: latestStats.daysWorked || 0,
      daysWorkedYoY: prevStats
        ? (latestStats.daysWorked || 0) - (prevStats.daysWorked || 0)
        : null,
      avgOvertimeHours: yearsWithData.length
        ? minutesToHours(yearsWithData.reduce((sum, row) => sum + (row.regularOvertimeMinutes || 0), 0) / yearsWithData.length)
        : 0,
      remainingLeaveDays: Number((latestStats.remainingLeaveDays || 0).toFixed(1)),
      paidLeaveDaysTotal: statsPerYear.reduce((sum, row) => sum + (row.paidLeaveDays || 0), 0)
    };

    const yearRows = statsPerYear.map(row => ({
      year: row.year,
      monthsRecorded: row.monthsRecorded,
      daysWorked: row.daysWorked || 0,
      daysOff: row.daysOff || 0,
      paidLeaveDays: row.paidLeaveDays || 0,
      absenceDays: row.absenceDays || 0,
      workingHours: minutesToHours(row.workingMinutes || 0),
      overtimeHours: minutesToHours(row.regularOvertimeMinutes || 0),
      lateEarlyHours: minutesToHours(row.lateEarlyMinutes || 0),
      remainingLeaveDays: Number((row.remainingLeaveDays || 0).toFixed(1))
    }));

    const dayChartPayload = JSON.stringify({
      labels: yearsInScope,
      datasets: [
        { label: 'Days worked', data: statsPerYear.map(r => r.daysWorked || 0) },
        { label: 'Days off', data: statsPerYear.map(r => r.daysOff || 0) },
        { label: 'Paid leave', data: statsPerYear.map(r => r.paidLeaveDays || 0) }
      ]
    });

    const timeChartPayload = JSON.stringify({
      labels: yearsInScope,
      working: statsPerYear.map(r => minutesToHours(r.workingMinutes || 0)),
      overtime: statsPerYear.map(r => minutesToHours(r.regularOvertimeMinutes || 0)),
      late: statsPerYear.map(r => minutesToHours(r.lateEarlyMinutes || 0))
    });

    const remainingChartPayload = JSON.stringify({
      labels: yearsInScope,
      remainingDays: statsPerYear.map(r => Number((r.remainingLeaveDays || 0).toFixed(1)))
    });

    const availableMonths = statsPerYear.reduce((sum, row) => sum + row.monthsRecorded, 0);
    const missingMonths = statsPerYear.reduce((sum, row) => sum + Math.max(0, 12 - row.monthsRecorded), 0);

    res.render('payroll/attendance', {
      hasData: statsPerYear.some(r => r.monthsRecorded),
      yearsInScope,
      yearRangeLabel: `${yearsInScope[0]} - ${yearsInScope[yearsInScope.length - 1]}`,
      summary,
      yearRows,
      dayChartPayload,
      timeChartPayload,
      remainingChartPayload,
      coverage: { availableMonths, missingMonths }
    });
  } catch (e) { next(e); }
};
