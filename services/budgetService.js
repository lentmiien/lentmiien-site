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
    console.log(start);
    console.log(pays);
    console.log(payLookup);

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
    {$match:{categories:cat, date:{$gte:lower,$lt:upper}}},
    {$group:{_id:'$transaction_business', total:{$sum:'$amount'}}},
    {$sort:{total:-1}}
  ]);
  const numbers = rows.map(r=>r.total);
  const stats = {
    count: numbers.length,
    sum  : numbers.reduce((a,b)=>a+b,0),
    min  : Math.min(...numbers),
    max  : Math.max(...numbers),
    avg  : numbers.length? (numbers.reduce((a,b)=>a+b,0)/numbers.length):0
  };
  // very naive outlier:  > avg + 2*std
  const std = Math.sqrt(numbers.reduce((a,x)=>a+Math.pow(x-stats.avg,2),0)/numbers.length||1);
  stats.outlierThreshold = stats.avg + 2*std;
  stats.std = std;
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
  const cats  = await CategoryDBModel.find().select('_id title');
  const types = await TransactionDBModel.distinct('type');
  const tags  = await TransactionDBModel.distinct('tags');
  return {accounts:acc, categories:cats, types, tags};
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
};
