const BudgetService = require('../services/budgetService');
const CreditCardService = require('../services/creditCardService');

const TRUTHY_LITERALS = new Set(['true', '1', 'yes', 'on', 'y', 't']);

function isTruthy(value) {
  if (typeof value === 'string') {
    return TRUTHY_LITERALS.has(value.trim().toLowerCase());
  }
  return Boolean(value);
}

exports.dashboard = async (req, res, next) => {
  try {
    const months = Number.parseInt(req.query.months, 10) || 6;
    const requestedCardId = req.query.cardId || null;
    const anomalyWindow = Number.parseInt(req.query.anomalyMonths, 10) || 4;
    const [budgetSummary, budgetAnomalies, creditSummary] = await Promise.all([
      BudgetService.getSummary({ months }),
      BudgetService.getAnomalies({ months: anomalyWindow }),
      CreditCardService.getSummary({ cardId: requestedCardId, months }),
    ]);
    const creditAnomalies = await CreditCardService.getAnomalies({
      cardId: creditSummary.activeCardId,
      months,
    });

    res.render('accounting_dashboard', {
      budgetSummary,
      creditSummary,
      anomalies: {
        budget: budgetAnomalies,
        credit: creditAnomalies,
      },
      cards: creditSummary.cards,
      activeCardId: creditSummary.activeCardId,
      data: {
        accounts: budgetSummary.accounts,
      },
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    res.status(500).json({ error: error.message });
  }
};

exports.index = exports.dashboard;

exports.accountingSummaryApi = async (req, res) => {
  try {
    const months = Number.parseInt(req.query.months, 10) || 6;
    const cardId = req.query.cardId || null;
    const [budgetSummary, creditSummary] = await Promise.all([
      BudgetService.getSummary({ months }),
      CreditCardService.getSummary({ cardId, months }),
    ]);
    res.json({ budgetSummary, creditSummary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.accountingAnalyticsApi = async (req, res) => {
  try {
    const months = Number.parseInt(req.query.months, 10) || 4;
    const cardId = req.query.cardId || null;
    const [budget, credit] = await Promise.all([
      BudgetService.getAnomalies({ months }),
      CreditCardService.getAnomalies({ cardId, months }),
    ]);
    res.json({ budget, credit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.accountingTransactionsApi = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const period = req.query.period || null;
    const cardId = req.query.cardId || null;
    const yearValue = req.query.year ? Number.parseInt(req.query.year, 10) : null;
    const monthValue = req.query.month ? Number.parseInt(req.query.month, 10) : null;
    const [budget, credit] = await Promise.all([
      BudgetService.getTransactions({ limit, period }),
      CreditCardService.getTransactions({
        cardId,
        year: yearValue,
        month: monthValue,
        limit,
      }),
    ]);
    res.json({ budget, credit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

/* ───────────────── Credit Card Tracker ───────────────── */

exports.creditCardsDashboard = async (req, res, next) => {
  try {
    const cards = await CreditCardService.listCards({ includeStats: true });
    const activeCardId = req.query.cardId || (cards[0] ? cards[0].id : null);
    res.render('credit_cards_dashboard', {
      cards,
      activeCardId,
    });
  } catch (err) {
    next(err);
  }
};

exports.creditCardsMonthPage = async (req, res, next) => {
  try {
    const { year, month } = req.params;
    const cards = await CreditCardService.listCards({ includeStats: true });
    const activeCardId = req.query.cardId || (cards[0] ? cards[0].id : null);
    res.render('credit_cards_month', {
      cards,
      activeCardId,
      year,
      month,
    });
  } catch (err) {
    next(err);
  }
};

exports.creditCardsList = async (req, res) => {
  try {
    const cards = await CreditCardService.listCards({ includeStats: true });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.creditCardsOverview = async (req, res) => {
  try {
    const { cardId = null, months = 6 } = req.query;
    const data = await CreditCardService.getOverview({ cardId, months });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsMonthData = async (req, res) => {
  try {
    const { year, month } = req.params;
    const { cardId = null } = req.query;
    const data = await CreditCardService.getMonthDetails({
      cardId,
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
    });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsCreateTransaction = async (req, res) => {
  try {
    const transaction = await CreditCardService.createTransaction(req.body);
    res.status(201).json(transaction);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsDeleteTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    await CreditCardService.deleteTransaction(transactionId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsConfirmMonth = async (req, res) => {
  try {
    const { year, month } = req.params;
    const { cardId = null } = req.body;
    const summary = await CreditCardService.confirmMonthlyBalance({
      cardId,
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
    });
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsUpdateCard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const { creditLimit = null } = req.body;
    const card = await CreditCardService.updateCardCreditLimit(cardId, creditLimit);
    res.json(card);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsClearData = async (req, res) => {
  try {
    const { cardId } = req.params;
    const result = await CreditCardService.clearCardData(cardId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsImportCsv = async (req, res) => {
  try {
    const { cardId = null, externalDefault = 'false', externalMultiplierDefault = '1' } = req.body;
    const cardIdTrimmed = typeof cardId === 'string' ? cardId.trim() : cardId;
    if (!cardIdTrimmed) {
      return res.status(400).json({ error: 'Card selection is required' });
    }
    let csvContent = '';
    if (req.file && req.file.buffer) {
      csvContent = req.file.buffer.toString('utf8');
    } else if (typeof req.body.csv === 'string') {
      csvContent = req.body.csv;
    }
    const result = await CreditCardService.importFromCsv({
      cardId: cardIdTrimmed,
      csv: csvContent,
      defaults: {
        externalDefault: isTruthy(externalDefault),
        externalMultiplierDefault: Number.parseFloat(externalMultiplierDefault) || 1,
      },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.creditCardsCreateCard = async (req, res) => {
  try {
    const card = await CreditCardService.createCard(req.body);
    res.status(201).json(card);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

