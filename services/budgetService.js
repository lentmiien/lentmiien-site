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
    const accounts1 = await AccountModel.find();
    const accounts2 = await AccountDBModel.find();
    accounts1.forEach(d => {
      const index = accountIndex.indexOf(d.account_name);
      if (index === -1) {
        accounts.push({
          name: d.account_name,
          balance: 0,
          balance_date: "2000-01-01"
        });
        accountIndex.push(d.account_name);
      }
    });
    accounts2.forEach(d => {
      const index = accountIndex.indexOf(d.name);
      if (index === -1) {
        accounts.push({
          name: d.name,
          balance: d.balance,
          balance_date: Date_int_to_str(d.balance_date)
        });
        accountIndex.push(d.name);
      } else {
        accounts[index].balance = d.balance;
        accounts[index].balance_date = Date_int_to_str(d.balance_date);
      }
    });
    // Load all new transactions after the `balance_date` date
    // Update `balance` in `accounts`
    return accounts;
  },
  async UpdateBalance() {
    // Load new accounts
    // Load all new transactions after the `balance_date` date
    // Update all transactions up to end of last month
  }
};

function Date_int_to_str(date_int) {
  let date_str = date_int.toString();
  return date_str.slice(0, 4) + "-" + date_str.slice(4, 6) + "-" + date_str.slice(6);
}

module.exports = budgetService;