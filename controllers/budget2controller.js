const BudgetService = require('../services/budgetService');

exports.index = async (req, res) => {
  const data = await BudgetService.getDashboardData();
  res.render('budget_dashboard', {data});
};