const BudgetService = require('../services/budgetService');

exports.index = async (req, res) => {
  const data = await BudgetService.getDashboardData();
  res.render('budget_dashboard', {data});
};

exports.delete = async (req, res) => {
  const id = req.params.id;
  await BudgetService.DeleteTransaction(id);
  res.json({deletedId: id});
}

exports.reviewTransactions = async (req, res) => {
  const period = resolvePeriodFromRequest(req);
  const canonicalPath = `/budget/review/${period.year}/${padMonth(period.month)}`;
  const hasParams = Boolean(req.params && req.params.year && req.params.month);
  const hasPeriodQuery = typeof req.query.period === 'string';
  const yearParam = hasParams ? req.params.year : null;
  const monthParam = hasParams ? req.params.month : null;

  if (!hasParams || hasPeriodQuery || yearParam !== String(period.year) || monthParam !== padMonth(period.month)) {
    return res.redirect(canonicalPath);
  }

  const { transactions, summary } = await BudgetService.getTransactionsByPeriod(period.year, period.month);
  res.render('budget_review', {
    transactions,
    summary,
    periodLabel: `${period.year}-${padMonth(period.month)}`,
    currentPeriod: period,
  });
};

/* ───────────────── API ───────────────── */

//   /budget/api/summary?category=Food
exports.summary = async (req,res)=>{
  const cat = req.query.category || null;
  const rows = await BudgetService.getCategoryMonthlyTotals(cat);
  res.json(rows);
};

//   /budget/api/breakdown/Food/2023/7
exports.breakdown = async (req,res)=>{
  const {cat,y,m} = req.params;
  const info = await BudgetService.getCategoryBreakdown(cat,parseInt(y),parseInt(m));
  res.json(info);
};

//   /budget/api/business?term=se
exports.businessList = async (req,res)=>{
  const list = await BudgetService.searchBusiness(req.query.term || '');
  res.json(list);
};

//   /budget/api/business/values?name=Seven-Eleven
exports.businessDefaults = async (req,res)=>{
  const obj = await BudgetService.businessLastValues(req.query.name || '');
  res.json(obj);
};

exports.newTransaction = async (req,res)=>{
  const t = await BudgetService.insertTransaction(req.body);
  res.status(201).json(t);
};

exports.lists = async (req,res)=>{
  res.json(await BudgetService.getReferenceLists());
};
function resolvePeriodFromRequest(req) {
  const now = new Date();
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 };

  const periodQuery = typeof req.query.period === 'string' ? req.query.period : null;
  if (periodQuery && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodQuery)) {
    const [queryYear, queryMonth] = periodQuery.split('-');
    return {
      year: Number.parseInt(queryYear, 10),
      month: Number.parseInt(queryMonth, 10),
    };
  }

  const params = req.params || {};
  if (params.year && params.month) {
    const yearNum = Number.parseInt(params.year, 10);
    const monthNum = Number.parseInt(params.month, 10);
    if (Number.isInteger(yearNum) && Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12) {
      return { year: yearNum, month: monthNum };
    }
  }

  return fallback;
}

function padMonth(month) {
  return month.toString().padStart(2, '0');
}

