const BudgetService = require('../services/budgetService');

exports.index = async (req, res) => {
  const accounts = await BudgetService.getAccounts();
  res.render('budget_dashboard', {accounts});
};