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
};

module.exports = budgetService;