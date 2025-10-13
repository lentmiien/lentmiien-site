const mongoose = require('mongoose');
const CreditCard = require('../models/credit_card');
const CreditCardTransaction = require('../models/credit_card_transaction');
const CreditCardMonthlyBalance = require('../models/credit_card_monthly_balance');

const { Types: { ObjectId } } = mongoose;

const TRUE_LITERALS = new Set(['true', '1', 'yes', 'on', 'y', 't']);

function isTruthy(value) {
  if (typeof value === 'string') {
    return TRUE_LITERALS.has(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function parseAmountInput(rawValue) {
  if (rawValue === null || rawValue === undefined) return Number.NaN;
  let value = String(rawValue).trim();
  if (!value) return Number.NaN;

  value = value.replace(/\u2212/g, '-'); // normalize unicode minus

  const parenthesesMatch = value.match(/^\((.*)\)$/);
  if (parenthesesMatch) {
    value = `-${parenthesesMatch[1].trim()}`;
  }

  value = value.replace(/[,\s]/g, '');
  value = value.replace(/[¥$]/g, '');

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.' || cleaned === '.-' || cleaned === '--') {
    return Number.NaN;
  }
  return Number(cleaned);
}

function parseCreditLimitInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error('Credit limit must be a non-negative number');
  }
  return numeric === 0 ? null : numeric;
}

function resolveCreditLimitValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function percentOfLimit(value, limit) {
  const numeric = Number(value);
  if (!limit || !Number.isFinite(numeric)) return null;
  return (numeric / limit) * 100;
}

function decorateSummaryWithCreditLimit(summary, creditLimit) {
  const limit = resolveCreditLimitValue(creditLimit);
  const percent = (val) => percentOfLimit(val, limit);
  summary.creditLimit = limit;
  summary.startingBalancePercent = percent(summary.startingBalance);
  summary.closingBalancePercent = percent(summary.closingBalance);
  summary.usagePercent = percent(summary.usageTotal);
  summary.repaymentPercent = percent(summary.repaymentTotal);
  summary.netPercent = percent(summary.netChange);
  return summary;
}

function serializeCard(card) {
  if (!card) return null;
  const plain = typeof card.toObject === 'function' ? card.toObject() : card;
  return {
    id: plain._id.toString(),
    name: plain.name,
    issuedDate: plain.issuedDate || null,
    creditLimit: plain.creditLimit ?? null,
    active: plain.active,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    hasTransactions: Boolean(plain.hasTransactions),
    hasMonthlyBalances: Boolean(plain.hasMonthlyBalances),
    hasHistory: Boolean(
      plain.hasHistory
      || plain.hasTransactions
      || plain.hasMonthlyBalances,
    ),
  };
}

function serializeTransaction(tx) {
  if (!tx) return null;
  const plain = typeof tx.toObject === 'function' ? tx.toObject() : tx;
  return {
    id: plain._id.toString(),
    creditCard: plain.creditCard.toString(),
    transactionDate: plain.transactionDate,
    label: plain.label,
    amount: plain.amount,
    external: Boolean(plain.external),
    externalMultiplier: typeof plain.externalMultiplier === 'number'
      ? plain.externalMultiplier
      : Number(plain.externalMultiplier) || 0,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function normalizeDateInput(dateInput) {
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === 'number') return new Date(dateInput);
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) throw new Error('Transaction date is required');
    const parts = trimmed.split('-').map((part) => parseInt(part, 10));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      throw new Error(`Invalid transaction date format: ${dateInput}`);
    }
    const [year, month, day] = parts;
    return new Date(Date.UTC(year, month - 1, day));
  }
  throw new Error('Invalid transaction date input');
}

function getMonthParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function monthKey(year, month) {
  return `${year}-${month.toString().padStart(2, '0')}`;
}

function compareYearMonth(aYear, aMonth, bYear, bMonth) {
  if (aYear === bYear && aMonth === bMonth) return 0;
  if (aYear < bYear || (aYear === bYear && aMonth < bMonth)) return -1;
  return 1;
}

function incrementMonth(year, month, delta = 1) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function decrementMonth(year, month, delta = 1) {
  return incrementMonth(year, month, -Math.abs(delta));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function computeMonthlyStats(transactions) {
  let usageTotal = 0;
  let repaymentTotal = 0;
  let externalPoints = 0;

  transactions.forEach((tx) => {
    const amount = Number(tx.amount) || 0;
    if (amount >= 0) usageTotal += amount;
    else repaymentTotal += Math.abs(amount);

    if (tx.external) {
      const multiplier = typeof tx.externalMultiplier === 'number'
        ? tx.externalMultiplier
        : Number(tx.externalMultiplier) || 0;
      if (amount > 0 && multiplier > 0) {
        externalPoints += amount * (multiplier / 100);
      }
    }
  });

  const netChange = usageTotal - repaymentTotal;

  return {
    usageTotal,
    repaymentTotal,
    netChange,
    externalPoints,
  };
}

function buildLabelSuggestions(transactions) {
  const counts = new Map();
  transactions.forEach((tx) => {
    const label = (tx.label || '').trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    })
    .map(([label, count]) => ({ label, count }));
}

async function sumTransactionsBefore(cardId, date) {
  const [result] = await CreditCardTransaction.aggregate([
    {
      $match: {
        creditCard: new ObjectId(cardId),
        transactionDate: { $lt: date },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);

  return result ? result.total : 0;
}

async function computeStartingBalance(cardId, monthStart) {
  const { year, month } = incrementMonth(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1,
    -1,
  );
  const previous = await CreditCardMonthlyBalance.findOne({
    creditCard: cardId,
    year,
    month,
  }).lean();

  if (previous) return previous.closingBalance;
  return sumTransactionsBefore(cardId, monthStart);
}

async function computeBasicMonthSummary(cardId, year, month, creditLimit = null) {
  if (!year || !month) return null;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [transactions, startingBalance, monthlyDoc] = await Promise.all([
    CreditCardTransaction.find({
      creditCard: cardId,
      transactionDate: { $gte: monthStart, $lt: monthEnd },
    }).sort({ transactionDate: 1 }).lean(),
    computeStartingBalance(cardId, monthStart),
    CreditCardMonthlyBalance.findOne({
      creditCard: cardId,
      year,
      month,
    }).lean(),
  ]);

  const stats = computeMonthlyStats(transactions);
  const closingBalance = monthlyDoc
    ? monthlyDoc.closingBalance
    : startingBalance + stats.netChange;

  const summary = {
    year,
    month,
    label: monthKey(year, month),
    startingBalance,
    closingBalance,
    usageTotal: stats.usageTotal,
    repaymentTotal: stats.repaymentTotal,
    netChange: stats.netChange,
    externalPoints: Math.round(stats.externalPoints),
    externalPointsExact: stats.externalPoints,
    confirmed: Boolean(monthlyDoc && monthlyDoc.confirmedAt),
    confirmedAt: monthlyDoc ? monthlyDoc.confirmedAt : null,
    transactionCount: transactions.length,
  };

  return decorateSummaryWithCreditLimit(summary, creditLimit);
}

const creditCardService = {
  async listCards(options = {}) {
    const { includeStats = false } = options;
    const cards = await CreditCard.find({ active: true }).sort({ createdAt: 1 }).lean();
    if (!includeStats || cards.length === 0) {
      return cards.map(serializeCard);
    }

    const cardIds = cards.map((card) => new ObjectId(card._id));
    const [transactionCounts, monthlyCounts] = await Promise.all([
      CreditCardTransaction.aggregate([
        { $match: { creditCard: { $in: cardIds } } },
        { $group: { _id: '$creditCard', count: { $sum: 1 } } },
      ]),
      CreditCardMonthlyBalance.aggregate([
        { $match: { creditCard: { $in: cardIds } } },
        { $group: { _id: '$creditCard', count: { $sum: 1 } } },
      ]),
    ]);

    const transactionMap = new Map();
    transactionCounts.forEach((row) => {
      transactionMap.set(row._id.toString(), row.count);
    });

    const monthlyMap = new Map();
    monthlyCounts.forEach((row) => {
      monthlyMap.set(row._id.toString(), row.count);
    });

    return cards.map((card) => serializeCard({
      ...card,
      hasTransactions: (transactionMap.get(card._id.toString()) || 0) > 0,
      hasMonthlyBalances: (monthlyMap.get(card._id.toString()) || 0) > 0,
      hasHistory: ((transactionMap.get(card._id.toString()) || 0) > 0)
        || ((monthlyMap.get(card._id.toString()) || 0) > 0),
    }));
  },

  async createCard({ name, issuedDate = null, creditLimit = null }) {
    if (!name || !name.trim()) {
      throw new Error('Card name is required');
    }
    let normalizedLimit;
    try {
      normalizedLimit = parseCreditLimitInput(creditLimit);
    } catch (err) {
      throw new Error(err.message);
    }
    const payload = {
      name: name.trim(),
      issuedDate: issuedDate ? normalizeDateInput(issuedDate) : null,
      creditLimit: normalizedLimit,
    };
    const card = await CreditCard.create(payload);
    return serializeCard(card);
  },

  async getCard(cardId) {
    if (!cardId) return null;
    const card = await CreditCard.findById(cardId);
    if (!card) return null;
    return serializeCard(card);
  },

  async _resolveCard(cardId) {
    let card;
    if (cardId) {
      card = await CreditCard.findById(cardId);
      if (!card) throw new Error('Credit card not found');
    } else {
      card = await CreditCard.findOne({ active: true }).sort({ createdAt: 1 });
      if (!card) throw new Error('No credit cards configured');
    }
    return card;
  },

  async getOverview({ cardId, months = 6 }) {
    const card = await this._resolveCard(cardId);
    const monthsCount = Math.max(1, Math.min(24, Number(months) || 6));

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const firstMonthDate = new Date(Date.UTC(currentYear, currentMonth - monthsCount, 1));
    const rangeEndExclusive = new Date(Date.UTC(currentYear, currentMonth, 1));

    const monthlyDocs = await CreditCardMonthlyBalance.find({
      creditCard: card._id,
    }).lean();

    const monthlyDocMap = new Map();
    monthlyDocs.forEach((doc) => {
      monthlyDocMap.set(monthKey(doc.year, doc.month), doc);
    });

    const baseDoc = monthlyDocs
      .filter((doc) => compareYearMonth(doc.year, doc.month, firstMonthDate.getUTCFullYear(), firstMonthDate.getUTCMonth() + 1) < 0)
      .sort((a, b) => compareYearMonth(a.year, a.month, b.year, b.month))
      .pop() || null;

    const transactionsStart = baseDoc
      ? new Date(Date.UTC(baseDoc.year, baseDoc.month, 1))
      : firstMonthDate;

    const [transactionsRaw, baseBalanceFromTransactions] = await Promise.all([
      CreditCardTransaction.find({
        creditCard: card._id,
        transactionDate: { $gte: transactionsStart, $lt: new Date(Date.UTC(currentYear, currentMonth + 1, 1)) },
      }).sort({ transactionDate: 1 }).lean(),
      baseDoc ? null : sumTransactionsBefore(card._id, firstMonthDate),
    ]);

    let runningBalance = baseDoc ? baseDoc.closingBalance : baseBalanceFromTransactions || 0;
    const monthTransactionMap = new Map();
    const inRangeTransactions = [];
    let preRangeNet = 0;

    transactionsRaw.forEach((tx) => {
      const txDate = new Date(tx.transactionDate);
      if (txDate < firstMonthDate) {
        preRangeNet += Number(tx.amount) || 0;
        return;
      }
      inRangeTransactions.push(tx);
      const { year, month } = getMonthParts(txDate);
      const key = monthKey(year, month);
      if (!monthTransactionMap.has(key)) monthTransactionMap.set(key, []);
      monthTransactionMap.get(key).push(tx);
    });

    runningBalance += preRangeNet;

    const monthsList = [];
    let cursorYear = firstMonthDate.getUTCFullYear();
    let cursorMonth = firstMonthDate.getUTCMonth() + 1;
    while (compareYearMonth(cursorYear, cursorMonth, currentYear, currentMonth) <= 0) {
      monthsList.push({ year: cursorYear, month: cursorMonth });
      const next = incrementMonth(cursorYear, cursorMonth);
      cursorYear = next.year;
      cursorMonth = next.month;
    }

    const monthlySummaries = [];
    const pendingConfirmations = [];
    monthsList.forEach(({ year, month }) => {
      const key = monthKey(year, month);
      const txs = monthTransactionMap.get(key) || [];
      const stats = computeMonthlyStats(txs);
      const doc = monthlyDocMap.get(key);
      const confirmed = Boolean(doc && doc.confirmedAt);
      const closingBalance = doc
        ? doc.closingBalance
        : runningBalance + stats.netChange;
      const summary = {
        year,
        month,
        label: key,
        usageTotal: stats.usageTotal,
        repaymentTotal: stats.repaymentTotal,
        netChange: stats.netChange,
        externalPoints: Math.round(stats.externalPoints),
        externalPointsExact: stats.externalPoints,
        startingBalance: runningBalance,
        closingBalance,
        confirmed,
        confirmedAt: doc ? doc.confirmedAt : null,
        transactionCount: txs.length,
      };
      decorateSummaryWithCreditLimit(summary, card.creditLimit);
      monthlySummaries.push(summary);
      if (!confirmed && compareYearMonth(year, month, currentYear, currentMonth) < 0) {
        pendingConfirmations.push(summary);
      }
      runningBalance = doc ? doc.closingBalance : closingBalance;
    });

    const currentKey = monthKey(currentYear, currentMonth);
    const currentSummary = monthlySummaries.find((m) => m.label === currentKey) || null;
    const currentTransactions = (monthTransactionMap.get(currentKey) || [])
      .slice()
      .sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
      .map(serializeTransaction);

    const suggestions = buildLabelSuggestions(inRangeTransactions);
    const previousSummary = monthlySummaries.find(
      (m) => compareYearMonth(m.year, m.month, currentYear, currentMonth) === -1,
    ) || null;

    return {
      card: serializeCard(card),
      months: monthlySummaries,
      currentMonth: currentSummary,
      previousMonth: previousSummary,
      currentBalance: currentSummary ? currentSummary.closingBalance : runningBalance,
      currentMonthTransactions: currentTransactions,
      labelSuggestions: suggestions,
      pendingConfirmations,
      range: {
        start: firstMonthDate.toISOString(),
        endExclusive: rangeEndExclusive.toISOString(),
      },
    };
  },

  async getMonthDetails({ cardId, year, month }) {
    if (!year || !month) {
      throw new Error('Year and month are required');
    }
    const card = await this._resolveCard(cardId);
    const yearNum = Number(year);
    const monthNum = Number(month);
    if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new Error('Invalid year or month');
    }

    const monthStart = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const monthEnd = new Date(Date.UTC(yearNum, monthNum, 1));

    const [transactions, startingBalance, monthDoc] = await Promise.all([
      CreditCardTransaction.find({
        creditCard: card._id,
        transactionDate: { $gte: monthStart, $lt: monthEnd },
      }).sort({ transactionDate: 1 }).lean(),
      computeStartingBalance(card._id, monthStart),
      CreditCardMonthlyBalance.findOne({
        creditCard: card._id,
        year: yearNum,
        month: monthNum,
      }).lean(),
    ]);

    const stats = computeMonthlyStats(transactions);
    const closingBalance = monthDoc
      ? monthDoc.closingBalance
      : startingBalance + stats.netChange;

    const days = daysInMonth(yearNum, monthNum);
    const dailySeries = [];
    let running = startingBalance;
    let txIndex = 0;
    let peakBalance = running;
    let peakBalanceDate = null;

    for (let day = 1; day <= days; day += 1) {
      while (
        txIndex < transactions.length
        && getMonthParts(new Date(transactions[txIndex].transactionDate)).day === day
      ) {
        const tx = transactions[txIndex];
        const amount = Number(tx.amount) || 0;
        running += amount;
        if (running > peakBalance) {
          peakBalance = running;
          peakBalanceDate = new Date(tx.transactionDate);
        }
        txIndex += 1;
      }
      dailySeries.push({
        date: new Date(Date.UTC(yearNum, monthNum - 1, day)).toISOString(),
        runningTotal: running,
      });
    }

    const previousParts = decrementMonth(yearNum, monthNum);
    const nextParts = incrementMonth(yearNum, monthNum);
    const previousSummary = await computeBasicMonthSummary(card._id, previousParts.year, previousParts.month, card.creditLimit);
    const summary = decorateSummaryWithCreditLimit({
      year: yearNum,
      month: monthNum,
      label: monthKey(yearNum, monthNum),
      startingBalance,
      closingBalance,
      usageTotal: stats.usageTotal,
      repaymentTotal: stats.repaymentTotal,
      netChange: stats.netChange,
      externalPoints: Math.round(stats.externalPoints),
      externalPointsExact: stats.externalPoints,
      confirmed: Boolean(monthDoc && monthDoc.confirmedAt),
      confirmedAt: monthDoc ? monthDoc.confirmedAt : null,
      transactionCount: transactions.length,
    }, card.creditLimit);

    summary.peakBalance = peakBalance;
    summary.peakBalancePercent = percentOfLimit(peakBalance, summary.creditLimit);
    summary.peakBalanceDate = peakBalanceDate ? peakBalanceDate.toISOString() : null;

    const comparison = previousSummary
      ? {
          previous: previousSummary,
          deltas: {
            usageTotal: summary.usageTotal - previousSummary.usageTotal,
            repaymentTotal: summary.repaymentTotal - previousSummary.repaymentTotal,
            netChange: summary.netChange - previousSummary.netChange,
            externalPoints: summary.externalPoints - previousSummary.externalPoints,
            closingBalance: summary.closingBalance - previousSummary.closingBalance,
          },
        }
      : null;

    const now = new Date();
    const nowYear = now.getUTCFullYear();
    const nowMonth = now.getUTCMonth() + 1;

    const navigation = {
      previous: {
        year: previousParts.year,
        month: previousParts.month,
        label: monthKey(previousParts.year, previousParts.month),
      },
      next: compareYearMonth(nextParts.year, nextParts.month, nowYear, nowMonth) <= 0
        ? {
            year: nextParts.year,
            month: nextParts.month,
            label: monthKey(nextParts.year, nextParts.month),
          }
        : null,
    };

    return {
      card: serializeCard(card),
      summary,
      transactions: transactions.map(serializeTransaction),
      dailySeries,
      comparison,
      navigation,
    };
  },

  async createTransaction(payload) {
    const {
      cardId,
      transactionDate,
      label,
      amount,
      external = false,
      externalMultiplier = 1,
    } = payload;

    const card = await this._resolveCard(cardId);

    if (!label || !label.trim()) {
      throw new Error('Label is required');
    }
    if (amount === undefined || amount === null || amount === '') {
      throw new Error('Amount is required');
    }

    const parsedAmount = parseAmountInput(amount);
    if (!Number.isFinite(parsedAmount)) {
      throw new Error('Amount must be a valid number');
    }
    const parsedDate = normalizeDateInput(transactionDate);
    const externalFlag = isTruthy(external);

    let multiplierValue = Number(externalMultiplier);
    if (Number.isNaN(multiplierValue)) multiplierValue = 0;
    if (multiplierValue < 0) multiplierValue = 0;

    const doc = await CreditCardTransaction.create({
      creditCard: card._id,
      transactionDate: parsedDate,
      label: label.trim(),
      amount: parsedAmount,
      external: externalFlag,
      externalMultiplier: externalFlag ? (multiplierValue || 1) : 0,
    });

    return serializeTransaction(doc);
  },

  async deleteTransaction(id) {
    const doc = await CreditCardTransaction.findByIdAndDelete(id);
    if (!doc) throw new Error('Transaction not found');
    return { id };
  },

  async confirmMonthlyBalance({ cardId, year, month }) {
    if (!year || !month) throw new Error('Year and month are required');
    const card = await this._resolveCard(cardId);
    const yearNum = Number(year);
    const monthNum = Number(month);
    if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new Error('Invalid year or month');
    }

    const summary = await computeBasicMonthSummary(card._id, yearNum, monthNum, card.creditLimit);
    if (!summary) {
      throw new Error('Unable to compute monthly summary');
    }

    const confirmationDate = new Date();
    const doc = await CreditCardMonthlyBalance.findOneAndUpdate(
      {
        creditCard: card._id,
        year: yearNum,
        month: monthNum,
      },
      {
        $set: {
          startingBalance: summary.startingBalance,
          usageTotal: summary.usageTotal,
          repaymentTotal: summary.repaymentTotal,
          externalPoints: summary.externalPoints,
          closingBalance: summary.closingBalance,
          confirmedAt: confirmationDate,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return {
      ...summary,
      confirmed: true,
      confirmedAt: confirmationDate,
      documentId: doc._id.toString(),
    };
  },

  async updateCardCreditLimit(cardId, creditLimit) {
    if (!cardId) throw new Error('Card id is required');
    const card = await CreditCard.findById(cardId);
    if (!card || !card.active) {
      throw new Error('Credit card not found');
    }
    let normalizedLimit;
    try {
      normalizedLimit = parseCreditLimitInput(creditLimit);
    } catch (err) {
      throw new Error(err.message);
    }
    card.creditLimit = normalizedLimit;
    await card.save();
    return serializeCard(card);
  },

  async clearCardData(cardId) {
    if (!cardId) throw new Error('Card id is required');
    const card = await CreditCard.findById(cardId);
    if (!card || !card.active) {
      throw new Error('Credit card not found');
    }

    const [txResult, balanceResult] = await Promise.all([
      CreditCardTransaction.deleteMany({ creditCard: card._id }),
      CreditCardMonthlyBalance.deleteMany({ creditCard: card._id }),
    ]);

    return {
      card: serializeCard(card),
      transactionsDeleted: txResult.deletedCount || 0,
      monthlyBalancesDeleted: balanceResult.deletedCount || 0,
    };
  },

  async importFromCsv({ cardId, csv, defaults = {} }) {
    if (!cardId) {
      throw new Error('Card selection is required for CSV upload');
    }

    const card = await CreditCard.findById(cardId);
    if (!card || !card.active) {
      throw new Error('Selected card was not found');
    }

    const [txCount, balanceCount] = await Promise.all([
      CreditCardTransaction.countDocuments({ creditCard: card._id }),
      CreditCardMonthlyBalance.countDocuments({ creditCard: card._id }),
    ]);

    if (txCount > 0 || balanceCount > 0) {
      throw new Error('CSV import is only allowed for cards without existing history');
    }

    if (!csv || !csv.trim()) {
      throw new Error('CSV content is empty');
    }

    const {
      externalDefault = false,
      externalMultiplierDefault = 1,
    } = defaults;
    const defaultExternalFlag = isTruthy(externalDefault);
    let defaultMultiplier = Number(externalMultiplierDefault);
    if (Number.isNaN(defaultMultiplier) || defaultMultiplier < 0) defaultMultiplier = 1;

    const lines = csv.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      throw new Error('CSV content has no rows');
    }

    const parseHeader = (line) => line.split(',').map((h) => h.trim().toLowerCase());
    const header = parseHeader(lines[0]);
    const hasHeader = header.includes('date') && header.includes('label') && header.includes('amount');
    const columns = hasHeader
      ? header
      : ['date', 'label', 'amount', 'is_external', 'external_multiplier'];

    const dateIndex = columns.indexOf('date');
    const labelIndex = columns.indexOf('label');
    const amountIndex = columns.indexOf('amount');
    const externalIndex = columns.indexOf('is_external') >= 0
      ? columns.indexOf('is_external')
      : columns.indexOf('external');
    const multiplierIndex = columns.indexOf('external_multiplier');

    if (dateIndex === -1 || labelIndex === -1 || amountIndex === -1) {
      throw new Error('CSV header must contain date, label, and amount columns');
    }

    const dataLines = hasHeader ? lines.slice(1) : lines;

    const prepared = [];
    const errors = [];
    let lineNumber = hasHeader ? 2 : 1;

    for (const line of dataLines) {
      const parts = line.split(',').map((part) => part.trim());
      if (parts.length < 3) {
        errors.push({ line: lineNumber, reason: 'Expected at least 3 columns (date,label,amount)' });
        lineNumber += 1;
        continue;
      }

      const dateStr = parts[dateIndex] || '';
      const labelRaw = parts[labelIndex] || '';
      const amountStr = parts[amountIndex] || '';
      const externalStr = externalIndex >= 0 ? (parts[externalIndex] || '') : '';
      const multiplierStr = multiplierIndex >= 0 ? (parts[multiplierIndex] || '') : '';
      if (!dateStr || !labelRaw || !amountStr) {
        errors.push({ line: lineNumber, reason: 'Missing date, label or amount' });
        lineNumber += 1;
        continue;
      }

      let parsedDate;
      try {
        parsedDate = normalizeDateInput(dateStr);
      } catch (err) {
        errors.push({ line: lineNumber, reason: err.message });
        lineNumber += 1;
        continue;
      }

      const parsedAmount = parseAmountInput(amountStr);
      if (!Number.isFinite(parsedAmount)) {
        errors.push({ line: lineNumber, reason: 'Amount must be a valid number' });
        lineNumber += 1;
        continue;
      }

      const label = labelRaw.trim();
      const externalFlag = externalStr
        ? isTruthy(externalStr)
        : defaultExternalFlag;
      let multiplierValue = multiplierStr
        ? Number(multiplierStr)
        : defaultMultiplier;
      if (Number.isNaN(multiplierValue) || multiplierValue < 0) multiplierValue = 0;

      prepared.push({
        creditCard: card._id,
        transactionDate: parsedDate,
        label,
        amount: parsedAmount,
        external: externalFlag,
        externalMultiplier: externalFlag ? (multiplierValue || 1) : 0,
      });

      lineNumber += 1;
    }

      const uniqueMap = new Map();
      prepared.forEach((item) => {
        const key = [
          item.transactionDate.toISOString(),
          item.label,
        item.amount,
      ].join('||');
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });
    const uniqueItems = Array.from(uniqueMap.values());

    let inserted = 0;
    let skipped = 0;

    for (const item of uniqueItems) {
      const existing = await CreditCardTransaction.findOne({
        creditCard: card._id,
        transactionDate: item.transactionDate,
        label: item.label,
        amount: item.amount,
      }).lean();

      if (existing) {
        skipped += 1;
        continue;
      }
      await CreditCardTransaction.create(item);
      inserted += 1;
    }

    return {
      inserted,
      skipped,
      errors,
      processed: uniqueItems.length,
    };
  },
};

module.exports = creditCardService;
