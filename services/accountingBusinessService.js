const mongoose = require('mongoose');
const AccountingBusinessMapping = require('../models/accounting_business_mapping');
const TransactionDBModel = require('../models/transaction_db');
const CreditCardTransaction = require('../models/credit_card_transaction');
const finance = require('../utils/finance');

const DEFAULT_GROUP = 'Other';
const SOURCE_BUDGET = 'budget';
const SOURCE_CREDIT_CARD = 'credit_card';
const VALID_SOURCES = new Set([SOURCE_BUDGET, SOURCE_CREDIT_CARD]);

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
    year: dateParts.year,
    month: dateParts.month,
    monthLabel: dateParts.year && dateParts.month ? finance.monthKey(dateParts.year, dateParts.month) : null,
    isoDate: dateParts.isoDate,
    sortValue: dateParts.sortValue,
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
  listMappings,
  normalizeBusinessName,
  seedFromExistingTransactions,
  updateMappingGroup,
};
