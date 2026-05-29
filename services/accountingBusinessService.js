const mongoose = require('mongoose');
const AccountingBusinessMapping = require('../models/accounting_business_mapping');
const AccountDBModel = require('../models/account_db');
const TransactionDBModel = require('../models/transaction_db');
const CreditCardTransaction = require('../models/credit_card_transaction');
const finance = require('../utils/finance');

const DEFAULT_GROUP = 'Other';
const SOURCE_BUDGET = 'budget';
const SOURCE_CREDIT_CARD = 'credit_card';
const VALID_SOURCES = new Set([SOURCE_BUDGET, SOURCE_CREDIT_CARD]);
const CREDIT_BRIDGE_GROUPS = new Set(['credit card repayments', 'repayment']);
const SAVINGS_GROUP = 'savings';
const FAMILY_GROUP = 'family';
const SELF_BUSINESS = 'self';

function cleanBusinessName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeBusinessName(value) {
  return cleanBusinessName(value).toLowerCase();
}

function cleanGroupName(value) {
  if (typeof value !== 'string') return DEFAULT_GROUP;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || DEFAULT_GROUP;
}

function cleanGroupFilterName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSource(value) {
  if (!value || !VALID_SOURCES.has(value)) return null;
  return value;
}

function normalizeComparableName(value) {
  return cleanBusinessName(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeMapping(mapping) {
  if (!mapping) return null;
  const plain = typeof mapping.toObject === 'function' ? mapping.toObject() : mapping;
  return {
    id: plain._id ? plain._id.toString() : null,
    name: plain.name,
    normalizedName: plain.normalizedName,
    groupName: plain.groupName || DEFAULT_GROUP,
    sources: Array.isArray(plain.sources) ? plain.sources : [],
    lastSeenAt: plain.lastSeenAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function uniqueBusinessNames(values) {
  const seen = new Set();
  const out = [];
  (values || []).forEach((value) => {
    const name = cleanBusinessName(value);
    const normalizedName = normalizeBusinessName(name);
    if (!name || !normalizedName || seen.has(normalizedName)) return;
    seen.add(normalizedName);
    out.push({ name, normalizedName });
  });
  return out;
}

function buildExactNameQuery(field, names) {
  const clauses = uniqueBusinessNames(names).map(({ name }) => ({
    [field]: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
  }));
  if (!clauses.length) {
    return { _id: { $exists: false } };
  }
  return { $or: clauses };
}

function budgetTransactionAmount(row) {
  return Number(row.amount || 0) + Number(row.from_fee || 0) + Number(row.to_fee || 0);
}

function budgetFeeAmount(row) {
  return Number(row.from_fee || 0) + Number(row.to_fee || 0);
}

function budgetTrackedCashImpact(row) {
  const amount = Number(row.amount || 0);
  const fromFee = Number(row.from_fee || 0);
  const toFee = Number(row.to_fee || 0);
  if (row.from_account === 'EXT' && row.to_account !== 'EXT') {
    return amount - toFee;
  }
  if (row.to_account === 'EXT' && row.from_account !== 'EXT') {
    return 0 - amount - fromFee;
  }
  if (row.from_account !== 'EXT' && row.to_account !== 'EXT') {
    return 0 - fromFee - toFee;
  }
  return 0;
}

function resolveBudgetType(row) {
  const explicit = typeof row.type === 'string' ? row.type.trim().toLowerCase() : '';
  if (explicit) return explicit;
  if (row.from_account === 'EXT') return 'income';
  if (row.to_account === 'EXT') return 'expense';
  return 'saving';
}

function budgetDateParts(dateInt) {
  const normalized = Number.parseInt(dateInt, 10);
  if (!Number.isFinite(normalized)) {
    return { year: null, month: null, isoDate: null, sortValue: 0 };
  }
  const year = Math.floor(normalized / 10000);
  const month = Math.floor((normalized % 10000) / 100);
  const isoDate = finance.intDateToISO(normalized);
  return {
    year,
    month,
    isoDate,
    sortValue: normalized,
  };
}

function cardDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { year: null, month: null, isoDate: null, sortValue: 0 };
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    isoDate: date.toISOString().slice(0, 10),
    sortValue: date.getTime(),
  };
}

function serializeBudgetTransaction(row, mappingByName) {
  const amount = budgetTransactionAmount(row);
  const type = resolveBudgetType(row);
  const dateParts = budgetDateParts(row.date);
  const mapping = mappingByName.get(normalizeBusinessName(row.transaction_business)) || null;
  const spendAmount = type === 'expense' ? amount : 0;
  const incomeAmount = type === 'income' ? amount : 0;
  return {
    id: row._id ? row._id.toString() : null,
    source: SOURCE_BUDGET,
    sourceLabel: 'Budget',
    business: row.transaction_business,
    groupName: mapping ? mapping.groupName : DEFAULT_GROUP,
    type,
    amount,
    spendAmount,
    incomeAmount,
    netCashImpact: incomeAmount - spendAmount,
    trackedCashImpact: budgetTrackedCashImpact(row),
    feeAmount: budgetFeeAmount(row),
    year: dateParts.year,
    month: dateParts.month,
    monthLabel: dateParts.year && dateParts.month ? finance.monthKey(dateParts.year, dateParts.month) : null,
    isoDate: dateParts.isoDate,
    sortValue: dateParts.sortValue,
    fromAccount: row.from_account,
    toAccount: row.to_account,
    details: row.categories || '',
  };
}

function serializeCardTransaction(row, mappingByName) {
  const amount = Number(row.amount || 0);
  const dateParts = cardDateParts(row.transactionDate);
  const mapping = mappingByName.get(normalizeBusinessName(row.label)) || null;
  const spendAmount = amount > 0 ? amount : 0;
  const incomeAmount = amount < 0 ? Math.abs(amount) : 0;
  return {
    id: row._id ? row._id.toString() : null,
    source: SOURCE_CREDIT_CARD,
    sourceLabel: 'Credit card',
    business: row.label,
    groupName: mapping ? mapping.groupName : DEFAULT_GROUP,
    type: amount >= 0 ? 'card_spend' : 'card_credit',
    amount,
    spendAmount,
    incomeAmount,
    netCashImpact: incomeAmount - spendAmount,
    trackedCashImpact: 0,
    cardLiabilityImpact: amount,
    feeAmount: 0,
    year: dateParts.year,
    month: dateParts.month,
    monthLabel: dateParts.year && dateParts.month ? finance.monthKey(dateParts.year, dateParts.month) : null,
    isoDate: dateParts.isoDate,
    sortValue: dateParts.sortValue,
    details: row.external ? 'External' : '',
  };
}

function buildPeriodRows(transactions, keyFn, labelFn) {
  const rowsByKey = new Map();
  transactions.forEach((tx) => {
    const key = keyFn(tx);
    if (!key) return;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        label: labelFn(tx),
        budgetSpend: 0,
        creditSpend: 0,
        incomeCredits: 0,
        totalSpend: 0,
        netCashImpact: 0,
        count: 0,
      });
    }
    const row = rowsByKey.get(key);
    if (tx.source === SOURCE_BUDGET) row.budgetSpend += tx.spendAmount;
    if (tx.source === SOURCE_CREDIT_CARD) row.creditSpend += tx.spendAmount;
    row.incomeCredits += tx.incomeAmount;
    row.totalSpend += tx.spendAmount;
    row.netCashImpact += tx.netCashImpact;
    row.count += 1;
  });
  return Array.from(rowsByKey.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => row);
}

function buildSourceBreakdown(transactions) {
  const sources = [
    { source: SOURCE_BUDGET, label: 'Budget', count: 0, totalSpend: 0, incomeCredits: 0 },
    { source: SOURCE_CREDIT_CARD, label: 'Credit card', count: 0, totalSpend: 0, incomeCredits: 0 },
  ];
  const lookup = new Map(sources.map((source) => [source.source, source]));
  transactions.forEach((tx) => {
    const source = lookup.get(tx.source);
    if (!source) return;
    source.count += 1;
    source.totalSpend += tx.spendAmount;
    source.incomeCredits += tx.incomeAmount;
  });
  return sources;
}

function buildBusinessBreakdown(transactions) {
  const rowsByName = new Map();
  transactions.forEach((tx) => {
    const key = normalizeBusinessName(tx.business);
    if (!key) return;
    if (!rowsByName.has(key)) {
      rowsByName.set(key, {
        business: tx.business,
        groupName: tx.groupName,
        totalSpend: 0,
        incomeCredits: 0,
        count: 0,
      });
    }
    const row = rowsByName.get(key);
    row.totalSpend += tx.spendAmount;
    row.incomeCredits += tx.incomeAmount;
    row.count += 1;
  });
  return Array.from(rowsByName.values())
    .sort((a, b) => b.totalSpend - a.totalSpend || a.business.localeCompare(b.business));
}

function buildEmptyAnalytics(scope, value) {
  return {
    scope,
    value: value || '',
    label: value || '',
    mappings: [],
    summary: {
      transactionCount: 0,
      totalSpend: 0,
      incomeCredits: 0,
      netCashImpact: 0,
      activeMonths: 0,
      averageMonthlySpend: 0,
      averageTransactionSpend: 0,
      firstDate: null,
      latestDate: null,
      largestTransaction: null,
    },
    monthly: [],
    yearly: [],
    sourceBreakdown: buildSourceBreakdown([]),
    businessBreakdown: [],
    transactions: [],
  };
}

function emptyOverallAnalytics() {
  const currentYear = new Date().getUTCFullYear();
  return {
    summary: {
      transactionCount: 0,
      firstDate: null,
      latestDate: null,
      currentTrackedCash: 0,
      hasTrackedCashAnchor: false,
      latestWorthEstimate: 0,
      worthChangeTotal: 0,
      income: 0,
      operatingExpense: 0,
      refundsCredits: 0,
      savingsContribution: 0,
      internalTransferNet: 0,
      bridgeCash: 0,
      bridgeCard: 0,
      estimatedCardLiability: 0,
      savingsRate: null,
      expenseRatio: null,
    },
    monthly: [],
    yearly: [],
    groupBreakdown: [],
    specialBreakdown: [],
    prediction: buildEmptyPrediction(currentYear),
  };
}

function buildEmptyPrediction(currentYear) {
  return {
    baseMonths: 0,
    anchorMonth: null,
    averageMonthlyNet: 0,
    monthlyNetStdDev: 0,
    averageMonthlyIncome: 0,
    averageMonthlyExpense: 0,
    averageMonthlySavings: 0,
    targets: [
      {
        label: `End ${currentYear}`,
        year: currentYear,
        monthsProjected: 0,
        projectedWorth: 0,
        projectedNetChange: 0,
        lowWorth: 0,
        highWorth: 0,
        projectedIncome: 0,
        projectedExpense: 0,
        projectedSavings: 0,
      },
      {
        label: `End ${currentYear + 1}`,
        year: currentYear + 1,
        monthsProjected: 0,
        projectedWorth: 0,
        projectedNetChange: 0,
        lowWorth: 0,
        highWorth: 0,
        projectedIncome: 0,
        projectedExpense: 0,
        projectedSavings: 0,
      },
    ],
    scenarios: [],
  };
}

function isCreditBridge(tx) {
  const group = normalizeComparableName(tx.groupName);
  const business = normalizeComparableName(tx.business);
  return CREDIT_BRIDGE_GROUPS.has(group) || CREDIT_BRIDGE_GROUPS.has(business);
}

function isSavingsTransfer(tx) {
  return normalizeComparableName(tx.groupName) === SAVINGS_GROUP;
}

function isFamilySelfTransfer(tx) {
  return normalizeComparableName(tx.groupName) === FAMILY_GROUP
    && normalizeComparableName(tx.business) === SELF_BUSINESS;
}

function isInternalBudgetTransfer(tx) {
  return tx.source === SOURCE_BUDGET && tx.type === 'saving';
}

function monthIndex(year, month) {
  return (Number(year) * 12) + Number(month) - 1;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, label: finance.monthKey(year, month) };
}

function monthsThroughEndYear(anchor, targetYear) {
  if (!anchor || !anchor.year || !anchor.month) return 0;
  const start = monthIndex(anchor.year, anchor.month) + 1;
  const end = monthIndex(targetYear, 12);
  return Math.max(0, end - start + 1);
}

function createMonthlyRow(year, month) {
  return {
    year,
    month,
    label: finance.monthKey(year, month),
    transactionCount: 0,
    income: 0,
    operatingExpense: 0,
    refundsCredits: 0,
    savingsContribution: 0,
    internalTransferNet: 0,
    bridgeCash: 0,
    bridgeCard: 0,
    trackedCashImpact: 0,
    cardLiabilityImpact: 0,
    economicNet: 0,
    cumulativeEconomicNet: 0,
    cumulativeTrackedCashImpact: 0,
    knownSavingsBalance: 0,
    creditCardLiability: 0,
    liquidCashEstimate: 0,
    worthEstimate: 0,
  };
}

function createGroupRow(groupName) {
  return {
    groupName,
    transactionCount: 0,
    sources: [],
    income: 0,
    operatingExpense: 0,
    refundsCredits: 0,
    savingsContribution: 0,
    internalTransferNet: 0,
    bridgeCash: 0,
    bridgeCard: 0,
    economicNet: 0,
    shareOfExpense: 0,
    role: 'Operating',
  };
}

function applyTransactionToReport(tx, monthlyRow, groupRow) {
  monthlyRow.transactionCount += 1;
  groupRow.transactionCount += 1;
  if (!groupRow.sources.includes(tx.source)) {
    groupRow.sources.push(tx.source);
  }

  if (tx.source === SOURCE_BUDGET) {
    const cashImpact = Number(tx.trackedCashImpact || 0);
    monthlyRow.trackedCashImpact += cashImpact;

    if (isCreditBridge(tx)) {
      monthlyRow.bridgeCash += 0 - cashImpact;
      groupRow.bridgeCash += 0 - cashImpact;
      return;
    }
    if (isSavingsTransfer(tx)) {
      monthlyRow.savingsContribution += 0 - cashImpact;
      groupRow.savingsContribution += 0 - cashImpact;
      return;
    }
    if (isFamilySelfTransfer(tx) || isInternalBudgetTransfer(tx)) {
      monthlyRow.internalTransferNet += cashImpact;
      groupRow.internalTransferNet += cashImpact;
      return;
    }
    if (cashImpact >= 0) {
      monthlyRow.income += cashImpact;
      groupRow.income += cashImpact;
    } else {
      monthlyRow.operatingExpense += Math.abs(cashImpact);
      groupRow.operatingExpense += Math.abs(cashImpact);
    }
    return;
  }

  if (tx.source === SOURCE_CREDIT_CARD) {
    const liabilityImpact = Number(tx.cardLiabilityImpact || 0);
    monthlyRow.cardLiabilityImpact += liabilityImpact;
    if (isCreditBridge(tx)) {
      monthlyRow.bridgeCard += 0 - liabilityImpact;
      groupRow.bridgeCard += 0 - liabilityImpact;
      return;
    }
    if (liabilityImpact >= 0) {
      monthlyRow.operatingExpense += liabilityImpact;
      groupRow.operatingExpense += liabilityImpact;
    } else {
      monthlyRow.refundsCredits += Math.abs(liabilityImpact);
      groupRow.refundsCredits += Math.abs(liabilityImpact);
    }
  }
}

function finalizeReportRows(monthlyRows, groupRows, currentTrackedCash) {
  let cumulativeEconomicNet = 0;
  let cumulativeTrackedCashImpact = 0;
  let cumulativeSavingsBalance = 0;
  let cumulativeCardLiability = 0;

  monthlyRows.forEach((row) => {
    row.economicNet = row.income + row.refundsCredits - row.operatingExpense + row.internalTransferNet;
    cumulativeEconomicNet += row.economicNet;
    cumulativeTrackedCashImpact += row.trackedCashImpact;
    cumulativeSavingsBalance += row.savingsContribution;
    cumulativeCardLiability += row.cardLiabilityImpact;
    row.cumulativeEconomicNet = cumulativeEconomicNet;
    row.cumulativeTrackedCashImpact = cumulativeTrackedCashImpact;
    row.knownSavingsBalance = cumulativeSavingsBalance;
    row.creditCardLiability = cumulativeCardLiability;
  });

  const lastRow = monthlyRows[monthlyRows.length - 1] || null;
  const latestKnownWorth = lastRow
    ? currentTrackedCash + lastRow.knownSavingsBalance - lastRow.creditCardLiability
    : currentTrackedCash;
  const latestEconomicNet = lastRow ? lastRow.cumulativeEconomicNet : 0;
  const latestCashImpact = lastRow ? lastRow.cumulativeTrackedCashImpact : 0;

  monthlyRows.forEach((row) => {
    row.worthEstimate = latestKnownWorth - (latestEconomicNet - row.cumulativeEconomicNet);
    row.liquidCashEstimate = currentTrackedCash - (latestCashImpact - row.cumulativeTrackedCashImpact);
  });

  groupRows.forEach((row) => {
    row.economicNet = row.income + row.refundsCredits - row.operatingExpense + row.internalTransferNet;
  });
}

function currentAccountBalance(accounts, budgetRows) {
  if (!Array.isArray(accounts) || !accounts.length) return { total: 0, hasAnchor: false };
  const rows = Array.isArray(budgetRows) ? budgetRows : [];
  const accountMap = new Map(accounts.map((account) => {
    const id = account._id ? account._id.toString() : null;
    return [id, {
      id,
      balance: Number(account.balance || 0),
      balanceDate: Number(account.balance_date || 0),
    }];
  }).filter(([id]) => Boolean(id)));

  rows.forEach((row) => {
    const date = Number(row.date || 0);
    const amount = Number(row.amount || 0);
    const fromFee = Number(row.from_fee || 0);
    const toFee = Number(row.to_fee || 0);
    const from = accountMap.get(row.from_account);
    const to = accountMap.get(row.to_account);
    if (from && date > from.balanceDate) {
      from.balance -= amount + fromFee;
    }
    if (to && date > to.balanceDate) {
      to.balance += amount - toFee;
    }
  });

  return {
    total: Array.from(accountMap.values()).reduce((sum, account) => sum + account.balance, 0),
    hasAnchor: accountMap.size > 0,
  };
}

function summarizeRows(rows, field) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function sampleStdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildPrediction(monthlyRows, latestWorthEstimate) {
  const currentYear = new Date().getUTCFullYear();
  if (!monthlyRows.length) return buildEmptyPrediction(currentYear);

  const nonEmptyRows = monthlyRows.filter((row) => row.transactionCount > 0);
  const baseRows = (nonEmptyRows.length ? nonEmptyRows : monthlyRows).slice(-12);
  const baseMonths = baseRows.length;
  const netValues = baseRows.map((row) => Number(row.economicNet || 0));
  const averageMonthlyNet = baseMonths ? netValues.reduce((sum, value) => sum + value, 0) / baseMonths : 0;
  const monthlyNetStdDev = sampleStdDev(netValues);
  const averageMonthlyIncome = baseMonths ? summarizeRows(baseRows, 'income') / baseMonths : 0;
  const averageMonthlyExpense = baseMonths ? summarizeRows(baseRows, 'operatingExpense') / baseMonths : 0;
  const averageMonthlySavings = baseMonths ? summarizeRows(baseRows, 'savingsContribution') / baseMonths : 0;
  const lastRow = monthlyRows[monthlyRows.length - 1];
  const anchor = { year: lastRow.year, month: lastRow.month, label: lastRow.label };
  const targetYears = [Math.max(currentYear, lastRow.year), Math.max(currentYear + 1, lastRow.year + 1)];

  const targets = targetYears.map((year) => {
    const monthsProjected = monthsThroughEndYear(anchor, year);
    const projectedNetChange = averageMonthlyNet * monthsProjected;
    const interval = monthlyNetStdDev * Math.sqrt(monthsProjected) * 1.28;
    return {
      label: `End ${year}`,
      year,
      monthsProjected,
      projectedWorth: latestWorthEstimate + projectedNetChange,
      projectedNetChange,
      lowWorth: latestWorthEstimate + projectedNetChange - interval,
      highWorth: latestWorthEstimate + projectedNetChange + interval,
      projectedIncome: averageMonthlyIncome * monthsProjected,
      projectedExpense: averageMonthlyExpense * monthsProjected,
      projectedSavings: averageMonthlySavings * monthsProjected,
    };
  });

  return {
    baseMonths,
    anchorMonth: anchor.label,
    averageMonthlyNet,
    monthlyNetStdDev,
    averageMonthlyIncome,
    averageMonthlyExpense,
    averageMonthlySavings,
    targets,
    scenarios: [
      {
        label: 'Conservative',
        monthlyNet: averageMonthlyNet - monthlyNetStdDev,
        endNextYearWorth: latestWorthEstimate + ((averageMonthlyNet - monthlyNetStdDev) * (targets[1] ? targets[1].monthsProjected : 0)),
      },
      {
        label: 'Base',
        monthlyNet: averageMonthlyNet,
        endNextYearWorth: targets[1] ? targets[1].projectedWorth : latestWorthEstimate,
      },
      {
        label: 'Optimistic',
        monthlyNet: averageMonthlyNet + monthlyNetStdDev,
        endNextYearWorth: latestWorthEstimate + ((averageMonthlyNet + monthlyNetStdDev) * (targets[1] ? targets[1].monthsProjected : 0)),
      },
    ],
  };
}

function buildYearlyRows(monthlyRows) {
  const byYear = new Map();
  monthlyRows.forEach((row) => {
    const key = String(row.year);
    if (!byYear.has(key)) {
      byYear.set(key, {
        label: key,
        year: row.year,
        transactionCount: 0,
        income: 0,
        operatingExpense: 0,
        refundsCredits: 0,
        savingsContribution: 0,
        internalTransferNet: 0,
        bridgeCash: 0,
        bridgeCard: 0,
        economicNet: 0,
        endingWorthEstimate: 0,
      });
    }
    const target = byYear.get(key);
    target.transactionCount += row.transactionCount;
    target.income += row.income;
    target.operatingExpense += row.operatingExpense;
    target.refundsCredits += row.refundsCredits;
    target.savingsContribution += row.savingsContribution;
    target.internalTransferNet += row.internalTransferNet;
    target.bridgeCash += row.bridgeCash;
    target.bridgeCard += row.bridgeCard;
    target.economicNet += row.economicNet;
    target.endingWorthEstimate = row.worthEstimate;
  });
  return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
}

async function ensureBusiness(name, options = {}) {
  const item = uniqueBusinessNames([name])[0];
  if (!item) return null;
  const source = normalizeSource(options.source);
  const now = new Date();
  const update = {
    $setOnInsert: {
      name: item.name,
      normalizedName: item.normalizedName,
      groupName: DEFAULT_GROUP,
    },
    $set: {
      lastSeenAt: now,
    },
  };
  if (source) {
    update.$addToSet = { sources: source };
  }
  const doc = await AccountingBusinessMapping.findOneAndUpdate(
    { normalizedName: item.normalizedName },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return serializeMapping(doc);
}

async function ensureBusinesses(names, options = {}) {
  const items = uniqueBusinessNames(names);
  if (!items.length) {
    return { processed: 0, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }
  const source = normalizeSource(options.source);
  const now = new Date();
  const operations = items.map((item) => {
    const update = {
      $setOnInsert: {
        name: item.name,
        normalizedName: item.normalizedName,
        groupName: DEFAULT_GROUP,
      },
      $set: {
        lastSeenAt: now,
      },
    };
    if (source) {
      update.$addToSet = { sources: source };
    }
    return {
      updateOne: {
        filter: { normalizedName: item.normalizedName },
        update,
        upsert: true,
      },
    };
  });
  const result = await AccountingBusinessMapping.bulkWrite(operations, { ordered: false });
  return {
    processed: items.length,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  };
}

async function seedFromExistingTransactions() {
  const [budgetNames, cardLabels] = await Promise.all([
    TransactionDBModel.distinct('transaction_business', { transaction_business: { $nin: ['', null] } }),
    CreditCardTransaction.distinct('label', { label: { $nin: ['', null] } }),
  ]);
  const [budgetResult, creditCardResult] = await Promise.all([
    ensureBusinesses(budgetNames, { source: SOURCE_BUDGET }),
    ensureBusinesses(cardLabels, { source: SOURCE_CREDIT_CARD }),
  ]);
  const totalMappings = await AccountingBusinessMapping.countDocuments();
  return {
    budgetNames: uniqueBusinessNames(budgetNames).length,
    creditCardLabels: uniqueBusinessNames(cardLabels).length,
    budgetResult,
    creditCardResult,
    totalMappings,
  };
}

async function getFilterOptions(options = {}) {
  const limit = Math.max(20, Math.min(2000, Number(options.limit) || 1000));
  const [mappings, groupsRaw] = await Promise.all([
    AccountingBusinessMapping.find({})
      .sort({ name: 1 })
      .limit(limit)
      .lean(),
    AccountingBusinessMapping.distinct('groupName'),
  ]);
  const groups = Array.from(new Set([DEFAULT_GROUP, ...(groupsRaw || []).map(cleanGroupName)]))
    .sort((a, b) => {
      if (a === DEFAULT_GROUP) return -1;
      if (b === DEFAULT_GROUP) return 1;
      return a.localeCompare(b);
    });
  return {
    businesses: mappings.map(serializeMapping),
    groups,
  };
}

async function listMappings(options = {}) {
  const limit = Math.max(20, Math.min(2000, Number(options.limit) || 500));
  const query = {};
  if (options.groupName) {
    query.groupName = cleanGroupName(options.groupName);
  }
  const mappings = await AccountingBusinessMapping.find(query)
    .sort({ groupName: 1, name: 1 })
    .limit(limit)
    .lean();
  return mappings.map(serializeMapping);
}

async function updateMappingGroup(mappingId, groupName) {
  if (!mongoose.isValidObjectId(mappingId)) {
    throw new Error('Invalid business mapping id');
  }
  const nextGroup = cleanGroupName(groupName);
  const doc = await AccountingBusinessMapping.findByIdAndUpdate(
    mappingId,
    { $set: { groupName: nextGroup } },
    { new: true, runValidators: true },
  ).lean();
  if (!doc) {
    throw new Error('Business mapping not found');
  }
  return serializeMapping(doc);
}

async function getAnalytics(options = {}) {
  const scope = options.scope === 'group' ? 'group' : 'business';
  const value = scope === 'group'
    ? cleanGroupFilterName(options.value || options.group)
    : cleanBusinessName(options.value || options.business);
  if (!value) return buildEmptyAnalytics(scope, value);

  let mappings = [];
  if (scope === 'group') {
    mappings = await AccountingBusinessMapping.find({ groupName: value })
      .sort({ name: 1 })
      .lean();
  } else {
    const normalizedName = normalizeBusinessName(value);
    const mapping = await AccountingBusinessMapping.findOne({ normalizedName }).lean();
    mappings = mapping ? [mapping] : [{
      name: value,
      normalizedName,
      groupName: DEFAULT_GROUP,
      sources: [],
    }];
  }

  const businessNames = mappings.map((mapping) => mapping.name).filter(Boolean);
  if (scope === 'business' && !businessNames.some((name) => normalizeBusinessName(name) === normalizeBusinessName(value))) {
    businessNames.push(value);
  }
  if (!businessNames.length) return buildEmptyAnalytics(scope, value);

  const mappingByName = new Map(
    mappings.map((mapping) => [mapping.normalizedName || normalizeBusinessName(mapping.name), serializeMapping(mapping)]),
  );
  const [budgetRows, cardRows] = await Promise.all([
    TransactionDBModel.find(buildExactNameQuery('transaction_business', businessNames))
      .sort({ date: 1, transaction_business: 1 })
      .lean(),
    CreditCardTransaction.find(buildExactNameQuery('label', businessNames))
      .sort({ transactionDate: 1, label: 1 })
      .lean(),
  ]);

  const transactions = [
    ...budgetRows.map((row) => serializeBudgetTransaction(row, mappingByName)),
    ...cardRows.map((row) => serializeCardTransaction(row, mappingByName)),
  ].filter((tx) => tx.year && tx.month);

  transactions.sort((a, b) => {
    if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
    return a.business.localeCompare(b.business);
  });

  const totalSpend = transactions.reduce((sum, tx) => sum + tx.spendAmount, 0);
  const incomeCredits = transactions.reduce((sum, tx) => sum + tx.incomeAmount, 0);
  const netCashImpact = transactions.reduce((sum, tx) => sum + tx.netCashImpact, 0);
  const activeMonths = new Set(transactions.map((tx) => tx.monthLabel).filter(Boolean)).size;
  const sortedAscending = transactions.slice().sort((a, b) => a.sortValue - b.sortValue);
  const largestTransaction = transactions
    .slice()
    .sort((a, b) => Math.max(b.spendAmount, b.incomeAmount) - Math.max(a.spendAmount, a.incomeAmount))[0] || null;

  return {
    scope,
    value,
    label: scope === 'group' ? `${value} group` : value,
    mappings: mappings.map(serializeMapping),
    summary: {
      transactionCount: transactions.length,
      totalSpend,
      incomeCredits,
      netCashImpact,
      activeMonths,
      averageMonthlySpend: activeMonths ? totalSpend / activeMonths : 0,
      averageTransactionSpend: transactions.length ? totalSpend / transactions.length : 0,
      firstDate: sortedAscending[0] ? sortedAscending[0].isoDate : null,
      latestDate: transactions[0] ? transactions[0].isoDate : null,
      largestTransaction,
    },
    monthly: buildPeriodRows(
      transactions,
      (tx) => tx.monthLabel,
      (tx) => tx.monthLabel,
    ),
    yearly: buildPeriodRows(
      transactions,
      (tx) => tx.year ? String(tx.year) : null,
      (tx) => String(tx.year),
    ),
    sourceBreakdown: buildSourceBreakdown(transactions),
    businessBreakdown: buildBusinessBreakdown(transactions),
    transactions,
  };
}

async function getOverallAnalytics() {
  const [mappings, budgetRows, cardRows, accounts] = await Promise.all([
    AccountingBusinessMapping.find({})
      .sort({ groupName: 1, name: 1 })
      .lean(),
    TransactionDBModel.find({})
      .sort({ date: 1, transaction_business: 1 })
      .lean(),
    CreditCardTransaction.find({})
      .sort({ transactionDate: 1, label: 1 })
      .lean(),
    AccountDBModel.find({}).lean(),
  ]);

  const mappingByName = new Map(
    mappings.map((mapping) => [mapping.normalizedName || normalizeBusinessName(mapping.name), serializeMapping(mapping)]),
  );

  const transactions = [
    ...budgetRows.map((row) => serializeBudgetTransaction(row, mappingByName)),
    ...cardRows.map((row) => serializeCardTransaction(row, mappingByName)),
  ].filter((tx) => tx.year && tx.month && tx.monthLabel);

  if (!transactions.length) {
    return emptyOverallAnalytics();
  }

  transactions.sort((a, b) => {
    if (a.sortValue !== b.sortValue) return a.sortValue - b.sortValue;
    return a.business.localeCompare(b.business);
  });

  const first = transactions[0];
  const latest = transactions[transactions.length - 1];
  const monthlyByLabel = new Map();
  const startIndex = monthIndex(first.year, first.month);
  const endIndex = monthIndex(latest.year, latest.month);
  for (let index = startIndex; index <= endIndex; index += 1) {
    const month = monthFromIndex(index);
    monthlyByLabel.set(month.label, createMonthlyRow(month.year, month.month));
  }

  const groupByName = new Map();
  transactions.forEach((tx) => {
    const monthlyRow = monthlyByLabel.get(tx.monthLabel);
    if (!monthlyRow) return;
    const groupName = tx.groupName || DEFAULT_GROUP;
    if (!groupByName.has(groupName)) {
      groupByName.set(groupName, createGroupRow(groupName));
    }
    applyTransactionToReport(tx, monthlyRow, groupByName.get(groupName));
  });

  const accountSnapshot = currentAccountBalance(accounts, budgetRows);
  const monthly = Array.from(monthlyByLabel.values());
  const groupRows = Array.from(groupByName.values());
  finalizeReportRows(monthly, groupRows, accountSnapshot.total);

  const totalIncome = summarizeRows(monthly, 'income');
  const totalOperatingExpense = summarizeRows(monthly, 'operatingExpense');
  const totalRefundsCredits = summarizeRows(monthly, 'refundsCredits');
  const totalSavingsContribution = summarizeRows(monthly, 'savingsContribution');
  const totalInternalTransferNet = summarizeRows(monthly, 'internalTransferNet');
  const totalBridgeCash = summarizeRows(monthly, 'bridgeCash');
  const totalBridgeCard = summarizeRows(monthly, 'bridgeCard');
  const latestMonthly = monthly[monthly.length - 1];
  const latestWorthEstimate = latestMonthly ? latestMonthly.worthEstimate : accountSnapshot.total;
  const worthChangeTotal = latestMonthly ? latestMonthly.cumulativeEconomicNet : 0;
  const prediction = buildPrediction(monthly, latestWorthEstimate);

  groupRows.forEach((row) => {
    row.shareOfExpense = totalOperatingExpense > 0
      ? (row.operatingExpense / totalOperatingExpense) * 100
      : 0;
    if (isCreditBridge(row)) {
      row.role = 'Credit bridge';
    } else if (normalizeComparableName(row.groupName) === SAVINGS_GROUP) {
      row.role = 'Off-book savings';
    } else if (normalizeComparableName(row.groupName) === FAMILY_GROUP) {
      row.role = 'Family / internal';
    } else if (row.income > row.operatingExpense) {
      row.role = 'Revenue';
    }
  });

  const groupBreakdown = groupRows
    .filter((row) => row.role === 'Operating' || row.role === 'Revenue' || row.role === 'Family / internal')
    .sort((a, b) => {
      const aSize = Math.max(a.operatingExpense, a.income, Math.abs(a.economicNet));
      const bSize = Math.max(b.operatingExpense, b.income, Math.abs(b.economicNet));
      return bSize - aSize || a.groupName.localeCompare(b.groupName);
    });

  const specialBreakdown = groupRows
    .filter((row) => row.role === 'Credit bridge' || row.role === 'Off-book savings')
    .sort((a, b) => a.groupName.localeCompare(b.groupName));

  return {
    summary: {
      transactionCount: transactions.length,
      firstDate: first.isoDate,
      latestDate: latest.isoDate,
      currentTrackedCash: accountSnapshot.total,
      hasTrackedCashAnchor: accountSnapshot.hasAnchor,
      latestWorthEstimate,
      worthChangeTotal,
      income: totalIncome,
      operatingExpense: totalOperatingExpense,
      refundsCredits: totalRefundsCredits,
      savingsContribution: totalSavingsContribution,
      internalTransferNet: totalInternalTransferNet,
      bridgeCash: totalBridgeCash,
      bridgeCard: totalBridgeCard,
      estimatedCardLiability: latestMonthly ? latestMonthly.creditCardLiability : 0,
      savingsRate: totalIncome > 0 ? (totalSavingsContribution / totalIncome) * 100 : null,
      expenseRatio: totalIncome > 0 ? (totalOperatingExpense / totalIncome) * 100 : null,
    },
    monthly,
    yearly: buildYearlyRows(monthly),
    groupBreakdown,
    specialBreakdown,
    prediction,
  };
}

module.exports = {
  DEFAULT_GROUP,
  SOURCE_BUDGET,
  SOURCE_CREDIT_CARD,
  cleanBusinessName,
  cleanGroupName,
  ensureBusiness,
  ensureBusinesses,
  getAnalytics,
  getFilterOptions,
  getOverallAnalytics,
  listMappings,
  normalizeBusinessName,
  seedFromExistingTransactions,
  updateMappingGroup,
};
