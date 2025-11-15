// services/budgetService.js

// (OLD)
const AccountModel = require('../models/account');
const TransactionModel = require('../models/transaction');
const TypecategoryModel = require('../models/typecategory');
const TypetagModel = require('../models/typetag');
// (NEW)
const AccountDBModel = require('../models/account_db');
const CategoryDBModel = require('../models/category_db');
const TransactionDBModel = require('../models/transaction_db');

const { Receipt, Payroll } = require('../database');
const finance = require('../utils/finance');

const budgetService = {
  async getAccounts() {
    const accounts = [];
    const accountIndex = [];
    const id_to_account_index = {};
    const accounts1 = await AccountModel.find();
    const accounts2 = await AccountDBModel.find();
    accounts1.forEach(d => {
      const index = accountIndex.indexOf(d.account_name);
      if (index === -1) {
        accounts.push({
          name: d.account_name,
          balance: 0,
          balance_date: 20000101,
          new_balance_date: 20000101,
        });
        accountIndex.push(d.account_name);
      }
    });
    accounts2.forEach(d => {
      const index = accountIndex.indexOf(d.name);
      if (index === -1) {
        id_to_account_index[d._id.toString()] = accounts.length;
        accounts.push({
          name: d.name,
          balance: d.balance,
          balance_date: d.balance_date,
          new_balance_date: d.balance_date,
        });
        accountIndex.push(d.name);
      } else {
        id_to_account_index[d._id.toString()] = index;
        accounts[index].balance = d.balance;
        accounts[index].balance_date = d.balance_date;
        accounts[index].new_balance_date = d.balance_date;
      }
    });
    return {accounts, id_to_account_index};
  },
  async getDashboardData() {
    const start = new Date(Date.now() - (1000*60*60*24*30));
    const receipts = await Receipt.find({date: { $gte: start }}).sort('-date');
    const receiptLookup = {}
    for (const r of receipts) {
      const date = parseInt(r.date.toISOString().split('T')[0].split('-').join(''));
      const amount = r.amount;
      if (receiptLookup[date]) receiptLookup[date][amount] = r._id.toString();
      else receiptLookup[date] = {[amount]: r._id.toString()};
    }

    // Payroll.payDate within last 30 days
    const pays = await Payroll.find({payDate: {$gte: start}});
    const payLookup = {};
    for (const p of pays) {
      const date = parseInt(p.payDate.toISOString().split('T')[0].split('-').join(''));
      const amount = p.bankTransferAmount;
      if (payLookup[date]) payLookup[date][amount] = p._id.toString();
      else payLookup[date] = {[amount]: p._id.toString()};
    }

    const dashboardData = {};
    const a = await this.getAccounts();
    const d = new Date()
    const one_month_ago = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const lower = (one_month_ago.getFullYear() * 10000) + ((one_month_ago.getMonth()+1) * 100);
    const higher = (one_month_ago.getFullYear() * 10000) + ((one_month_ago.getMonth()+1) * 100) + 32;
    const last_30_days = new Date(d.getFullYear(), d.getMonth(), d.getDate()-30);
    const last_30_limit = (last_30_days.getFullYear() * 10000) + ((last_30_days.getMonth()+1) * 100) + last_30_days.getDate();
    for (let i = 0; i < a.accounts.length; i++) {
      a.accounts[i]["change_last_month"] = 0;
      a.accounts[i]["last_30_days_transactions"] = [];
    }
    // Load all new transactions
    const transactions = await TransactionDBModel.find();
    // Update `balance` in `accounts`
    transactions.forEach(t => {
      if (a.id_to_account_index.hasOwnProperty(t.from_account)) {
        const account_index = a.id_to_account_index[t.from_account];
        if (t.date > a.accounts[account_index].balance_date) {
          a.accounts[account_index].balance -= t.from_fee + t.amount;
          if (t.date > a.accounts[account_index].new_balance_date) {
            a.accounts[account_index].new_balance_date = t.date;
          }
        }
        if (t.date > lower && t.date < higher) {
          a.accounts[account_index].change_last_month -= t.from_fee + t.amount;
        }
        if (t.date > last_30_limit) {
          a.accounts[account_index].last_30_days_transactions.push({
            id: t._id.toString(),
            amount: 0 - t.from_fee - t.amount,
            date: t.date,
            label: t.transaction_business,
            hasReceipt: receiptLookup[t.date] && receiptLookup[t.date][t.amount] ? true : false,
            receiptId: receiptLookup[t.date] && receiptLookup[t.date][t.amount] ? receiptLookup[t.date][t.amount] : null,
            hasPay: payLookup[t.date] && payLookup[t.date][t.amount] ? true : false,
            payId: payLookup[t.date] && payLookup[t.date][t.amount] ? payLookup[t.date][t.amount] : null,
          });
        }
      }
      if (a.id_to_account_index.hasOwnProperty(t.to_account)) {
        const account_index = a.id_to_account_index[t.to_account];
        if (t.date > a.accounts[account_index].balance_date) {
          a.accounts[account_index].balance += t.amount - t.to_fee;
          if (t.date > a.accounts[account_index].new_balance_date) {
            a.accounts[account_index].new_balance_date = t.date;
          }
          if (t.date > lower && t.date < higher) {
            a.accounts[account_index].change_last_month += t.amount - t.to_fee;
          }
          if (t.date > last_30_limit) {
            a.accounts[account_index].last_30_days_transactions.push({
              id: t._id.toString(),
              amount: t.amount - t.to_fee,
              date: t.date,
              label: t.transaction_business,
              hasReceipt: receiptLookup[t.date] && receiptLookup[t.date][t.amount] ? true : false,
              receiptId: receiptLookup[t.date] && receiptLookup[t.date][t.amount] ? receiptLookup[t.date][t.amount] : null,
              hasPay: payLookup[t.date] && payLookup[t.date][t.amount] ? true : false,
              payId: payLookup[t.date] && payLookup[t.date][t.amount] ? payLookup[t.date][t.amount] : null,
            });
          }
        }
      }
    });
    // Sort transactions
    for (let i = 0; i < a.accounts.length; i++) {
      a.accounts[i].last_30_days_transactions.sort((a,b) => {
        if (a.date > b.date) return -1;
        if (a.date < b.date) return 1;
        return 0;
      });
    }
    dashboardData["accounts"] = a.accounts;
    return dashboardData;
  },
  async UpdateBalance() {
    // Load new accounts
    // Load all new transactions after the `balance_date` date
    // Update all transactions up to end of last month
  },
  async DeleteTransaction(id) {
    await TransactionDBModel.deleteOne({_id: id});
  },
};

 /* ──────────────────────────────
    1) MONTHLY CATEGORY TOTALS
    ──────────────────────────────*/

function catPipe(category){
  const pipe=[
    {$match: category ? {categories: category} : {}},
    {$addFields:{
        year : {$floor: {$divide: ['$date',10000]}},
        month: {$floor: {$divide:[{$mod:['$date',10000]},100]}}
    }},
    {$group:{
        _id:{year:'$year',month:'$month',cat:'$categories'},
        total:{$sum:'$amount'}
    }},
    {$sort:{'_id.cat':1,'_id.year':1,'_id.month':1}}
  ];
  return pipe;
}

async function aggTotals(category){
  const rows = await TransactionDBModel.aggregate(catPipe(category));
  // reshape to {cat: {year: [12 numbers]}}
  const out = {};
  rows.forEach(r=>{
     const {cat,year,month} = r._id;
     if(!out[cat]) out[cat]={};
     if(!out[cat][year]) out[cat][year]=Array(12).fill(0);
     out[cat][year][month-1]= r.total;       // month is 1-12
  });
  return out;                       // convenient for the graph code
}

/* 2)  BREAKDOWN for single month */
async function breakdown(cat,year,month){
  const lower = year*10000 + month*100;         // yyyy mm 01
  const upper = lower+32;                       // a bit sloppy but OK
  const rows= await TransactionDBModel.aggregate([
    {$match:{
      categories: { $regex: `^${cat}` },         // begin with objectId
      date      : { $gte: lower, $lt: upper }
    }},
    {$group:{_id:'$transaction_business', total:{$sum:'$amount'}}},
    {$sort:{total:-1}}
  ]);
  /* ---------- statistics ---------- */
  const numbers = rows.map(r=>r.total);
  const stats   = { date: `${year}-${month}`, count: numbers.length };
  if (numbers.length) {
    stats.sum = numbers.reduce((a,b)=>a+b,0);
    stats.min = Math.min(...numbers);
    stats.max = Math.max(...numbers);
    stats.avg = stats.sum / stats.count;
    const variance = numbers.reduce((s,x)=>s + Math.pow(x-stats.avg,2),0) / stats.count;
    stats.std  = Math.sqrt(variance);
    stats.outlierThreshold = stats.avg + 2*stats.std;
  } else {
    Object.assign(stats,{sum:0,min:null,max:null,avg:0,std:0,outlierThreshold:0});
  }
  return {rows,stats};
}

/* 3)  Business Name Helpers */
async function searchBusiness(term){
  if(!term) return [];
  return TransactionDBModel.aggregate([
     {$match:{transaction_business:{$regex:term,$options:'i'}}},
     {$group:{_id:'$transaction_business'}},
     {$limit:8},
     {$project:{_id:0,name:'$_id'}}
  ]);
}

async function businessLastValues(name){
  if(!name) return {};
  const rows = await TransactionDBModel.find({transaction_business:name})
        .sort({date:-1}).limit(10).lean();
  if(!rows.length) return {};
  const fields = ['from_account','to_account','from_fee','to_fee','categories','tags','type'];
  const out={};
  fields.forEach(f=>{
     const uniq=[...new Set(rows.map(r=>r[f]))];
     if(uniq.length===1) out[f]=uniq[0];           // force fill
     else                out[f]=null;              // user must choose
  });
  // give also the usual amount range
  out.amountAvg = rows.reduce((a,b)=>a+b.amount,0)/rows.length;
  return out;
}

/* 4)  Insert new transaction  */
async function insertTransaction(body){
  const t = new TransactionDBModel(body);
  return t.save();
}

/* helper list for selects / drop-downs */
async function getReferenceLists(){
  const acc   = await AccountDBModel.find().select('_id name');
  const cats  = await CategoryDBModel.find().select('_id title type');
  const types = await TransactionDBModel.distinct('type');
  const tags  = await TransactionDBModel.distinct('tags');
  return {accounts:acc, categories:cats, types, tags};
}

async function getTransactionsByPeriod(year, month) {
  const yearNum = Number.parseInt(year, 10);
  const monthNum = Number.parseInt(month, 10);
  if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error('Invalid year/month for transaction lookup');
  }
  const lower = yearNum * 10000 + monthNum * 100;
  const upper = lower + 32;

  const monthStart = new Date(yearNum, monthNum - 1, 1);
  const monthEnd = new Date(yearNum, monthNum, 1);

  const [transactions, accounts, receipts, payrolls] = await Promise.all([
    TransactionDBModel.find({ date: { $gte: lower, $lt: upper } }).sort({ date: 1, transaction_business: 1 }).lean(),
    AccountDBModel.find().select('_id name').lean(),
    Receipt.find({ date: { $gte: monthStart, $lt: monthEnd } }),
    Payroll.find({ payDate: { $gte: monthStart, $lt: monthEnd } }),
  ]);

  const receiptLookup = {};
  receipts.forEach(receipt => {
    const dateNumber = Number.parseInt(receipt.date.toISOString().slice(0, 10).replace(/-/g, ''), 10);
    if (!Number.isFinite(dateNumber)) {
      return;
    }
    if (!receiptLookup[dateNumber]) {
      receiptLookup[dateNumber] = {};
    }
    receiptLookup[dateNumber][receipt.amount] = receipt._id.toString();
  });

  const payrollLookup = {};
  payrolls.forEach(payroll => {
    const dateNumber = Number.parseInt(payroll.payDate.toISOString().slice(0, 10).replace(/-/g, ''), 10);
    if (!Number.isFinite(dateNumber)) {
      return;
    }
    if (!payrollLookup[dateNumber]) {
      payrollLookup[dateNumber] = {};
    }
    payrollLookup[dateNumber][payroll.bankTransferAmount] = payroll._id.toString();
  });

  const accountMap = accounts.reduce((acc, account) => {
    acc[account._id.toString()] = account.name;
    return acc;
  }, {});

  const formatted = transactions.map(t => {
    const id = t._id.toString();
    const dateStr = t.date.toString().padStart(8, '0');
    const displayDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    const receiptId = receiptLookup[t.date] && receiptLookup[t.date][t.amount] ? receiptLookup[t.date][t.amount] : null;
    const payrollId = payrollLookup[t.date] && payrollLookup[t.date][t.amount] ? payrollLookup[t.date][t.amount] : null;
    return {
      ...t,
      _id: id,
      id,
      displayDate,
      fromAccountName: accountMap[t.from_account] || t.from_account,
      toAccountName: accountMap[t.to_account] || t.to_account,
      linkedReceiptId: receiptId,
      linkedPayrollId: payrollId,
      hasLinkedReceipt: Boolean(receiptId),
      hasLinkedPayroll: Boolean(payrollId),
    };
  });

  const totalAmount = formatted.reduce((sum, t) => sum + (t.amount || 0), 0);

  return {
    transactions: formatted,
    summary: {
      totalAmount,
      count: formatted.length,
      year: yearNum,
      month: monthNum,
    },
  };
}

async function buildCategoryLookup() {
  const categories = await CategoryDBModel.find().select('_id title').lean();
  return categories.reduce((acc, category) => {
    acc[category._id.toString()] = category.title;
    return acc;
  }, {});
}

function categoryLabel(rawValue, categoryMap = {}) {
  if (!rawValue) return 'Uncategorised';
  const [categoryId, fallback] = rawValue.split('@');
  if (categoryId && categoryMap[categoryId]) {
    return categoryMap[categoryId];
  }
  if (fallback) return fallback;
  return rawValue;
}

function extractYearMonth(dateInt) {
  const normalized = Number.parseInt(dateInt, 10);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return { year: null, month: null, label: null };
  }
  const year = Math.floor(normalized / 10000);
  const month = Math.floor((normalized % 10000) / 100);
  if (!year || !month) {
    return { year: null, month: null, label: null };
  }
  return { year, month, label: finance.monthKey(year, month) };
}

function transactionTotal(doc) {
  return (doc.amount || 0) + (doc.from_fee || 0) + (doc.to_fee || 0);
}

async function getSummary(options = {}) {
  const months = Math.max(1, Math.min(24, Number(options.months) || 6));
  const categoryLimit = Math.max(3, Math.min(12, Number(options.categoryLimit) || 5));
  const periods = finance.buildRecentPeriods(months);
  const earliest = periods[0].range.start;
  const latestPeriod = periods[periods.length - 1];
  const latestRangeEnd = latestPeriod.range.end;

  const [dashboardData, categoryMap, monthlyAgg, latestCategories] = await Promise.all([
    budgetService.getDashboardData(),
    buildCategoryLookup(),
    TransactionDBModel.aggregate([
      { $match: { date: { $gte: earliest, $lt: latestRangeEnd } } },
      { $project: {
        amount: { $add: ['$amount', '$from_fee', '$to_fee'] },
        year: { $floor: { $divide: ['$date', 10000] } },
        month: { $floor: { $divide: [{ $mod: ['$date', 10000] }, 100] } },
      } },
      { $group: {
        _id: { year: '$year', month: '$month' },
        totalSpent: { $sum: '$amount' },
        transactionCount: { $sum: 1 },
      } },
    ]),
    TransactionDBModel.aggregate([
      { $match: { date: { $gte: latestPeriod.range.start, $lt: latestPeriod.range.end } } },
      { $group: {
        _id: '$categories',
        totalSpent: { $sum: { $add: ['$amount', '$from_fee', '$to_fee'] } },
        transactionCount: { $sum: 1 },
      } },
      { $sort: { totalSpent: -1 } },
      { $limit: categoryLimit },
    ]),
  ]);

  const monthlyMap = new Map();
  monthlyAgg.forEach((row) => {
    const label = finance.monthKey(row._id.year, row._id.month);
    monthlyMap.set(label, {
      total: row.totalSpent || 0,
      transactionCount: row.transactionCount || 0,
    });
  });

  const monthlyTrend = [];
  periods.forEach((period) => {
    const base = monthlyMap.get(period.label) || { total: 0, transactionCount: 0 };
    const prev = monthlyTrend[monthlyTrend.length - 1] || null;
    monthlyTrend.push({
      label: period.label,
      total: base.total,
      transactionCount: base.transactionCount,
      delta: prev ? finance.delta(base.total, prev.total) : null,
      deltaPercent: prev ? finance.deltaPercent(base.total, prev.total) : null,
    });
  });

  const accounts = (dashboardData && dashboardData.accounts) || [];
  const totalBalance = accounts.reduce((sum, account) => sum + (account.balance || 0), 0);
  const currentTrend = monthlyTrend[monthlyTrend.length - 1] || null;
  const previousTrend = monthlyTrend.length > 1 ? monthlyTrend[monthlyTrend.length - 2] : null;

  const categories = latestCategories.map((row) => ({
    id: row._id,
    label: categoryLabel(row._id, categoryMap),
    total: row.totalSpent || 0,
    transactionCount: row.transactionCount || 0,
  }));

  return {
    accounts,
    totals: {
      balance: totalBalance,
      accountCount: accounts.length,
      periodLabel: latestPeriod.label,
    },
    monthlyTrend,
    topCategories: categories,
    cashflow: currentTrend
      ? {
        current: currentTrend.total,
        previous: previousTrend ? previousTrend.total : null,
        delta: previousTrend ? finance.delta(currentTrend.total, previousTrend.total) : null,
        deltaPercent: previousTrend ? finance.deltaPercent(currentTrend.total, previousTrend.total) : null,
      }
      : null,
  };
}

async function getTransactions(options = {}) {
  const limit = Math.max(5, Math.min(200, Number(options.limit) || 20));
  const periodInput = typeof options.period === 'string'
    ? { period: options.period }
    : options.period;
  const period = periodInput ? finance.resolvePeriod(periodInput) : null;
  const categoryMap = await buildCategoryLookup();

  if (period) {
    const periodData = await getTransactionsByPeriod(period.year, period.month);
    return {
      period,
      summary: periodData.summary,
      items: periodData.transactions.slice(0, limit).map((tx) => ({
        ...tx,
        categoryLabel: categoryLabel(tx.categories, categoryMap),
      })),
    };
  }

  const rows = await TransactionDBModel.find({})
    .sort({ date: -1, transaction_business: 1 })
    .limit(limit)
    .lean();

  const formatted = rows.map((row) => ({
    id: row._id.toString(),
    business: row.transaction_business,
    amount: row.amount,
    totalAmount: transactionTotal(row),
    categoryLabel: categoryLabel(row.categories, categoryMap),
    date: row.date,
    isoDate: finance.intDateToISO(row.date),
    fromAccount: row.from_account,
    toAccount: row.to_account,
  }));

  return {
    period: null,
    summary: {
      count: formatted.length,
      totalAmount: formatted.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0),
    },
    items: formatted,
  };
}

async function getAnomalies(options = {}) {
  const months = Math.max(2, Math.min(12, Number(options.months) || 3));
  const highValueThreshold = Math.max(50000, Number(options.highValueThreshold) || 200000);
  const periods = finance.buildRecentPeriods(months);
  const earliest = periods[0].range.start;
  const latestLabel = periods[periods.length - 1].label;
  const [categoryMap, transactions] = await Promise.all([
    buildCategoryLookup(),
    TransactionDBModel.find({ date: { $gte: earliest } }).lean(),
  ]);

  if (!transactions.length) {
    return {
      categoryAlerts: [],
      highValue: [],
      latestPeriod: latestLabel,
    };
  }

  const categorySeries = new Map();
  transactions.forEach((tx) => {
    const { label } = extractYearMonth(tx.date);
    if (!label) {
      return;
    }
    const categoryName = categoryLabel(tx.categories, categoryMap);
    if (!categorySeries.has(categoryName)) {
      categorySeries.set(categoryName, new Map());
    }
    const monthMap = categorySeries.get(categoryName);
    monthMap.set(label, (monthMap.get(label) || 0) + transactionTotal(tx));
  });

  const categoryAlerts = [];
  categorySeries.forEach((monthMap, label) => {
    const current = monthMap.get(latestLabel) || 0;
    const historical = periods.slice(0, -1)
      .map((period) => monthMap.get(period.label) || 0)
      .filter((value) => value > 0);
    if (!historical.length) return;
    const historicalAvg = historical.reduce((sum, value) => sum + value, 0) / historical.length;
    if (historicalAvg === 0) return;
    const increase = current - historicalAvg;
    if (increase > 0 && current >= historicalAvg * 1.35 && increase > 10000) {
      categoryAlerts.push({
        category: label,
        current,
        average: historicalAvg,
        delta: increase,
        deltaPercent: (increase / historicalAvg) * 100,
      });
    }
  });

  categoryAlerts.sort((a, b) => b.deltaPercent - a.deltaPercent);

  const highValue = transactions
    .map((tx) => ({
      id: tx._id.toString(),
      amount: transactionTotal(tx),
      business: tx.transaction_business,
      category: categoryLabel(tx.categories, categoryMap),
      date: tx.date,
      isoDate: finance.intDateToISO(tx.date),
    }))
    .filter((tx) => tx.amount >= highValueThreshold)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    categoryAlerts,
    highValue,
    latestPeriod: latestLabel,
  };
}

 /* ── export */
module.exports = {
  ...budgetService,                       // keep old public methods
  getCategoryMonthlyTotals : aggTotals,
  getCategoryBreakdown     : breakdown,
  searchBusiness,
  businessLastValues,
  insertTransaction,
  getReferenceLists,
  getTransactionsByPeriod,
  getSummary,
  getTransactions,
  getAnomalies,
};
